import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { sha256Hex } from "./totp";

export const normalizeInviteCode = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const normalizeCompanyCode = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** More waiting requests than this (per company) stops further ones, so nobody can flood a company's administrators with sign-ups. */
export const MAX_PENDING = 100;

/**
 * Who becomes the first platform admin. With BOOTSTRAP_PLATFORM_EMAIL set, only that address, and only while no platform admin
 * exists (so someone else signing up first cannot block it). Without it, only the very first account ever created.
 */
export function shouldBootstrap(o: { only?: string; email?: string; userCount: number; hasPlatformAdmin: boolean }): boolean {
  if (o.hasPlatformAdmin) return false;
  if (o.only) return (o.email ?? "").trim().toLowerCase() === o.only;
  return o.userCount === 1;
}

/** Join a company with an invitation: the person gets the roles and buildings the invitation names, at once. */
export async function redeemInvite(ctx: MutationCtx, userId: Id<"users">, email: string, code: string): Promise<Id<"organizations">> {
  const hash = await sha256Hex(normalizeInviteCode(code));
  const mine = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.usedAt && i.expiresAt > Date.now() && i.codeHash === hash);
  if (!mine) throw new Error("invite_invalid");
  const org = await ctx.db.get(mine.orgId);
  if (!org || org.status === "cancelled") throw new Error("invite_invalid");
  await ctx.db.patch(mine._id, { usedAt: Date.now() });
  const had = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", mine.orgId).eq("userId", userId)).unique();
  if (had) await ctx.db.patch(had._id, { roles: mine.roles, buildingScope: mine.buildingScope, status: "active" });
  else await ctx.db.insert("memberships", { orgId: mine.orgId, userId, roles: mine.roles, buildingScope: mine.buildingScope, status: "active", invitedBy: mine.createdBy });
  await ctx.db.patch(userId, { activeOrgId: mine.orgId });
  return mine.orgId;
}

/** Ask to join a company with its join code. The company's access managers decide. */
export async function requestToJoin(ctx: MutationCtx, userId: Id<"users">, code: string, note?: string): Promise<Id<"organizations">> {
  const wanted = normalizeCompanyCode(code);
  const org = wanted ? await ctx.db.query("organizations").withIndex("by_join_code", (q) => q.eq("joinCode", wanted)).first() : null;
  if (!org || org.status === "cancelled" || org.status === "suspended") throw new Error("company_code_invalid");
  if (await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", userId)).unique()) throw new Error("already_a_member");
  const waiting = await ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", org._id).eq("status", "pending")).collect();
  if (waiting.some((r) => r.userId === userId)) return org._id; // already asked
  if (waiting.length >= MAX_PENDING) throw new Error("too_many_requests");
  const rejected = await ctx.db.query("accessRequests").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  const old = rejected.find((r) => r.orgId === org._id);
  const n = note?.trim() ? note.trim().slice(0, 500) : undefined;
  if (old) await ctx.db.patch(old._id, { status: "pending", requestedAt: Date.now(), decisionReason: undefined, decidedAt: undefined, ...(n ? { note: n } : {}) });
  else await ctx.db.insert("accessRequests", { orgId: org._id, userId, status: "pending", requestedAt: Date.now(), ...(n ? { note: n } : {}) });
  return org._id;
}

/**
 * Runs when a new account has just been created.
 *  - The first platform admin (see shouldBootstrap) is set up directly: they run the platform, not a company.
 *  - A valid invitation for exactly this email address puts the person in that company with the invited roles.
 *  - A wrong invitation code is refused.
 *  - A company join code makes a pending request for that company.
 *  - Anyone else just has an account with no company yet; they can enter a company code or invitation later.
 */
export async function applySignup(ctx: MutationCtx, userId: Id<"users">, bootstrapEmail?: string) {
  const me = await ctx.db.get(userId);
  const code = me?.inviteCode ?? "";
  const joinCode = (me as { companyCode?: string } | null)?.companyCode ?? "";
  const note = me?.accessNote;
  await ctx.db.patch(userId, { inviteCode: undefined, accessNote: undefined, active: true, lang: me?.lang ?? "en", ...(joinCode ? { companyCode: undefined } : {}) } as never); // never keep what was typed
  const users = await ctx.db.query("users").take(500);
  const first = shouldBootstrap({ only: bootstrapEmail?.trim().toLowerCase(), email: me?.email, userCount: users.length, hasPlatformAdmin: users.some((u) => u.platformRole === "platformAdmin") });
  if (first) { await ctx.db.patch(userId, { platformRole: "platformAdmin" }); return; }
  const email = (me?.email ?? "").trim().toLowerCase();
  if (code) { await redeemInvite(ctx, userId, email, code); return; }
  if (joinCode) await requestToJoin(ctx, userId, joinCode, note);
}
