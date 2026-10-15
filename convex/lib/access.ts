import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = NonNullable<Doc<"users">["roles"]>[number];
type Ctx = QueryCtx | MutationCtx;

export const fail = (code: string): never => {
  throw new ConvexError(code);
};

/** Roles that must use two-step sign-in once the organisation turns the requirement on. */
const PRIVILEGED: Role[] = ["approver", "financeOfficer", "accessAdmin", "superAdmin"];

/** "verify": has 2FA but this sign-in is not verified yet. "setup": 2FA is required for the role but not set up. */
export async function mfaState(ctx: Ctx, user: Doc<"users">): Promise<"ok" | "verify" | "setup"> {
  const row = await ctx.db.query("mfaSecrets").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
  if (row?.enabled) {
    const sid = await getAuthSessionId(ctx);
    const ok = sid ? await ctx.db.query("mfaSessions").withIndex("by_session", (q) => q.eq("sessionId", sid)).first() : null;
    return ok ? "ok" : "verify";
  }
  const required = (await getSetting(ctx, "mfa.required", 0)) === 1;
  return required && (user.roles ?? []).some((r) => PRIVILEGED.includes(r)) ? "setup" : "ok";
}

/** The signed-in, active staff member. Throws if signed out, deactivated, or the second step is pending. */
export async function requireUser(ctx: Ctx, opts: { skipMfa?: boolean } = {}): Promise<Doc<"users">> {
  const id = await getAuthUserId(ctx);
  if (!id) return fail("unauthenticated");
  const user = await ctx.db.get(id);
  if (!user || !user.active) return fail("inactive");
  if (!opts.skipMfa) {
    const s = await mfaState(ctx, user);
    if (s === "verify") return fail("mfa_required");
    if (s === "setup") return fail("mfa_setup_required");
  }
  return user;
}

export const hasRole = (u: Doc<"users">, ...roles: Role[]) =>
  (u.roles ?? []).includes("superAdmin") || roles.some((r) => (u.roles ?? []).includes(r));

export async function requireRole(ctx: Ctx, ...roles: Role[]): Promise<Doc<"users">> {
  const u = await requireUser(ctx);
  if (!hasRole(u, ...roles)) return fail("forbidden");
  return u;
}

/** Read access for any staff role (auditor and management included). */
export const READ_ROLES: Role[] = ["propertyManager", "financeOfficer", "approver", "auditor"];

export const canSeeBuilding = (u: Doc<"users">, buildingId: Id<"buildings">) =>
  u.buildingScope === "all" || (Array.isArray(u.buildingScope) && u.buildingScope.includes(buildingId));

export function assertBuilding(u: Doc<"users">, buildingId: Id<"buildings">) {
  if (!canSeeBuilding(u, buildingId)) fail("forbidden_building");
}

/** Maker-checker: the person who prepared an item may not approve it. */
export function assertDifferentPerson(a: Id<"users">, b: Id<"users">) {
  if (a === b) fail("same_person_cannot_approve");
}

export async function audit(ctx: MutationCtx, actor: Doc<"users">, action: string, entity: string, entityId: string, detail = "") {
  await ctx.db.insert("auditLog", { actorId: actor._id, action, entity, entityId, detail });
}

export async function getSetting(ctx: Ctx, key: string, fallback: number): Promise<number> {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return row?.value ?? fallback;
}

export async function nextSeq(ctx: MutationCtx, key: string): Promise<number> {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (row) {
    await ctx.db.patch(row._id, { value: row.value + 1 });
    return row.value + 1;
  }
  await ctx.db.insert("settings", { key, value: 1 });
  return 1;
}

/** Money arguments are whole santim. Rejects NaN, Infinity and fractions before they reach the ledger. */
export function assertSantim(n: number, opts: { allowZero?: boolean; allowNegative?: boolean } = {}) {
  if (!Number.isSafeInteger(n)) fail("invalid_amount");
  if (!opts.allowNegative && (opts.allowZero ? n < 0 : n <= 0)) fail("invalid_amount");
}

export function assertPeriod(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail("invalid_period");
}
