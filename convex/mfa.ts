import { getAuthSessionId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { auditAccount, fail, getSetting, requireAccount, requireRole, resolveCompany } from "./lib/access";
import { newRecoveryCode, newSecret, otpauthUri, sha256Hex, verifyTotp } from "./lib/totp";

const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
/** 5 min, 10, 20, 40 … up to a day: a stolen password cannot be used to guess codes around the clock. */
export const lockDuration = (lockouts: number) => Math.min(LOCK_MS * 2 ** lockouts, MAX_LOCK_MS);

/** Does the company the person is working in require two-step sign-in for their role? */
async function orgRequires(ctx: QueryCtx | MutationCtx, u: Doc<"users">): Promise<boolean> {
  const c = await resolveCompany(ctx, u);
  if ("problem" in c || !c.membership) return false;
  if ((await getSetting(ctx, c.org._id, "mfa.required", 0)) !== 1) return false;
  return c.membership.roles.some((r) => ["approver", "financeOfficer", "accessAdmin", "superAdmin"].includes(r));
}

const mine = (ctx: MutationCtx, userId: Doc<"users">["_id"]) => ctx.db.query("mfaSecrets").withIndex("by_user", (q) => q.eq("userId", userId)).unique();

/** Whether this person has two-step sign-in, and whether their role must have it. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireAccount(ctx);
    const row = await ctx.db.query("mfaSecrets").withIndex("by_user", (q) => q.eq("userId", u._id)).unique();
    const required = await orgRequires(ctx, u);
    return { enabled: !!row?.enabled, recoveryLeft: row?.enabled ? row.recovery.length : 0, required };
  },
});

/** Start enrolment: a fresh secret that does nothing until a code from the app proves it works. */
export const begin = mutation({
  args: {},
  handler: async (ctx) => {
    const u = await requireAccount(ctx);
    const row = await mine(ctx, u._id);
    if (row?.enabled) return fail("mfa_already_enabled");
    const secret = newSecret();
    if (row) await ctx.db.patch(row._id, { secret, recovery: [], failures: 0, lockedUntil: undefined, lastStep: undefined });
    else await ctx.db.insert("mfaSecrets", { userId: u._id, secret, enabled: false, recovery: [], failures: 0 });
    return { secret, uri: otpauthUri(secret, u.email ?? u.name ?? "user") };
  },
});

async function markVerified(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const sid = await getAuthSessionId(ctx);
  if (!sid) return;
  // forget verifications for sign-ins that no longer exist
  for (const m of await ctx.db.query("mfaSessions").withIndex("by_user", (q) => q.eq("userId", userId)).take(50)) {
    if (m.sessionId !== sid && !(await ctx.db.system.get(m.sessionId as never).catch(() => null))) await ctx.db.delete(m._id);
  }
  if (!(await ctx.db.query("mfaSessions").withIndex("by_session", (q) => q.eq("sessionId", sid)).first())) await ctx.db.insert("mfaSessions", { sessionId: sid, userId });
}

/** Finish enrolment with the first code. Returns the one-time recovery codes: show them once. */
export const enable = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const u = await requireAccount(ctx);
    const row = await mine(ctx, u._id);
    if (!row || row.enabled) return fail("mfa_not_started");
    const step = await verifyTotp(row.secret, code);
    if (step === null) return { ok: false as const };
    const codes = Array.from({ length: 8 }, newRecoveryCode);
    await ctx.db.patch(row._id, { enabled: true, lastStep: step, recovery: await Promise.all(codes.map((c) => sha256Hex(c.replace("-", "")))), failures: 0 });
    await markVerified(ctx, u._id);
    await auditAccount(ctx, u, "mfa.enable", "users", u._id);
    return { ok: true as const, recoveryCodes: codes };
  },
});

/** Second step at sign-in: an authenticator code, or one recovery code. Five misses lock it for five minutes. */
export const verify = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const u = await requireAccount(ctx);
    const row = await mine(ctx, u._id);
    if (!row?.enabled) return { ok: true as const };
    if (row.lockedUntil && row.lockedUntil > Date.now()) return { ok: false as const, locked: true as const };
    const step = await verifyTotp(row.secret, code);
    let used: Partial<Doc<"mfaSecrets">> | null = null;
    if (step !== null && step !== row.lastStep && (row.lastStep === undefined || step > row.lastStep)) used = { lastStep: step };
    else if (step === null) {
      const h = await sha256Hex(code.replace(/[\s-]/g, "").toUpperCase());
      if (row.recovery.includes(h)) { used = { recovery: row.recovery.filter((x) => x !== h) }; await auditAccount(ctx, u, "mfa.recoveryUsed", "users", u._id); }
    }
    if (!used) {
      const failures = row.failures + 1;
      await ctx.db.patch(row._id, failures >= MAX_FAILURES ? { failures: 0, lockouts: (row.lockouts ?? 0) + 1, lockedUntil: Date.now() + lockDuration(row.lockouts ?? 0) } : { failures });
      return { ok: false as const, locked: failures >= MAX_FAILURES };
    }
    await ctx.db.patch(row._id, { ...used, failures: 0, lockedUntil: undefined, lockouts: 0 });
    await markVerified(ctx, u._id);
    return { ok: true as const };
  },
});

/** Turn 2FA off for yourself (needs a current code). Not allowed while the organisation requires it for your role. */
export const disable = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const u = await requireAccount(ctx);
    const row = await mine(ctx, u._id);
    if (!row?.enabled) return { ok: true as const };
    if (await orgRequires(ctx, u)) return fail("mfa_required_for_role");
    if ((await verifyTotp(row.secret, code)) === null) return { ok: false as const };
    await ctx.db.delete(row._id);
    await auditAccount(ctx, u, "mfa.disable", "users", u._id);
    return { ok: true as const };
  },
});

/** Lost phone and lost recovery codes: an access admin clears someone else's 2FA so they can enrol again. */
export const reset = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const admin = await requireRole(ctx, "accessAdmin");
    // only people in the same company
    if (!(await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", admin.orgId).eq("userId", userId)).unique())) return fail("not_found");
    if (userId === admin._id) return fail("cannot_reset_own_mfa");
    const row = await mine(ctx, userId);
    if (row) await ctx.db.delete(row._id);
    for (const m of await ctx.db.query("mfaSessions").withIndex("by_user", (q) => q.eq("userId", userId)).take(50)) await ctx.db.delete(m._id);
    await auditAccount(ctx, admin, "mfa.reset", "users", userId);
  },
});
