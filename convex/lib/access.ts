import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = NonNullable<Doc<"users">["roles"]>[number];
type Ctx = QueryCtx | MutationCtx;

export const fail = (code: string): never => {
  throw new ConvexError(code);
};

/** Roles that must use two-step sign-in once the company turns the requirement on. */
const PRIVILEGED: Role[] = ["approver", "financeOfficer", "accessAdmin", "superAdmin"];

/**
 * The signed-in person acting inside one company. It is the user record with that company's membership laid over it: `roles`
 * and `buildingScope` are the ones the person holds in `orgId`, so the rest of the code keeps asking `u.roles` and `canSeeBuilding`.
 */
export type Principal = Doc<"users"> & { orgId: Id<"organizations">; org: Doc<"organizations">; membershipId?: Id<"memberships">; support?: boolean };

const isMutation = (ctx: Ctx) => (ctx as { scheduler?: unknown }).scheduler !== undefined;

/** "verify": has 2FA but this sign-in is not verified yet. "setup": 2FA is required for the role but not set up. */
export async function mfaState(ctx: Ctx, user: Doc<"users">, orgId?: Id<"organizations">): Promise<"ok" | "verify" | "setup"> {
  const row = await ctx.db.query("mfaSecrets").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
  if (row?.enabled) {
    const sid = await getAuthSessionId(ctx);
    const ok = sid ? await ctx.db.query("mfaSessions").withIndex("by_session", (q) => q.eq("sessionId", sid)).first() : null;
    return ok ? "ok" : "verify";
  }
  // the platform team holds the keys to every company, so their second step is switched on with PLATFORM_REQUIRE_MFA=1
  if (user.platformRole === "platformAdmin" && process.env.PLATFORM_REQUIRE_MFA === "1") return "setup";
  if (!orgId) return "ok";
  const required = (await getSetting(ctx, orgId, "mfa.required", 0)) === 1;
  return required && (user.roles ?? []).some((r) => PRIVILEGED.includes(r)) ? "setup" : "ok";
}

/** The signed-in account, whether or not it belongs to a company yet. Throws only if signed out or switched off by the platform. */
export async function requireAccount(ctx: Ctx): Promise<Doc<"users">> {
  const id = await getAuthUserId(ctx);
  if (!id) return fail("unauthenticated");
  const user = await ctx.db.get(id);
  if (!user || user.active === false) return fail("inactive");
  return user;
}

/** Everything about where this person may work: their memberships, and the company they have open now. */
export async function resolveCompany(ctx: Ctx, user: Doc<"users">): Promise<{ org: Doc<"organizations">; membership?: Doc<"memberships">; support?: boolean } | { problem: "no_company" | "choose_company" }> {
  if (user.platformRole === "platformAdmin") {
    const open = (await ctx.db.query("supportSessions").withIndex("by_user", (q) => q.eq("platformUserId", user._id)).order("desc").take(5)).find((x) => !x.endedAt && x.expiresAt > Date.now());
    if (open) { const org = await ctx.db.get(open.orgId); if (org) return { org, support: true }; }
  }
  const mine = (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).filter((m) => m.status === "active");
  const chosen = mine.find((m) => m.orgId === user.activeOrgId) ?? (mine.length === 1 ? mine[0] : undefined);
  if (!chosen) return { problem: mine.length === 0 ? "no_company" : "choose_company" };
  const org = await ctx.db.get(chosen.orgId);
  return org ? { org, membership: chosen } : { problem: "no_company" };
}

/** A company that has not paid, was suspended or was cancelled can still be read, but nothing in it can be changed. */
export function orgIsFrozen(org: Doc<"organizations">): "org_suspended" | "org_cancelled" | "org_trial_ended" | null {
  if (org.status === "cancelled") return "org_cancelled";
  if (org.status === "suspended" || org.status === "past_due") return "org_suspended";
  if (org.status === "trial" && org.trialEndsAt && org.trialEndsAt < Date.now()) return "org_trial_ended";
  return null;
}

/** The signed-in, active staff member, acting in their company. Throws if signed out, without a company, or the second step is pending. */
export async function requireUser(ctx: Ctx, opts: { skipMfa?: boolean; allowFrozen?: boolean } = {}): Promise<Principal> {
  const user = await requireAccount(ctx);
  const c = await resolveCompany(ctx, user);
  if ("problem" in c) return fail(c.problem);
  const p: Principal = c.support
    ? { ...user, roles: ["auditor"], buildingScope: "all", orgId: c.org._id, org: c.org, support: true }
    : { ...user, roles: c.membership!.roles, buildingScope: c.membership!.buildingScope, orgId: c.org._id, org: c.org, membershipId: c.membership!._id };
  if (!opts.skipMfa) {
    const s = await mfaState(ctx, p, p.orgId);
    if (s === "verify") return fail("mfa_required");
    if (s === "setup") return fail("mfa_setup_required");
  }
  const frozen = orgIsFrozen(c.org);
  if (frozen && isMutation(ctx) && !opts.allowFrozen) return fail(frozen);
  return p;
}

/** A member of the platform team (they run every company). Nothing here touches a company's business data. */
export async function requirePlatform(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireAccount(ctx);
  if (user.platformRole !== "platformAdmin") return fail("forbidden");
  if ((await mfaState(ctx, user)) !== "ok") return fail("mfa_required");
  return user;
}

export const hasRole = (u: Pick<Doc<"users">, "roles">, ...roles: Role[]) =>
  (u.roles ?? []).includes("superAdmin") || roles.some((r) => (u.roles ?? []).includes(r));

export async function requireRole(ctx: Ctx, ...roles: Role[]): Promise<Principal> {
  const u = await requireUser(ctx);
  if (!hasRole(u, ...roles)) return fail("forbidden");
  return u;
}

/** Read access for any staff role (auditor and management included). */
export const READ_ROLES: Role[] = ["propertyManager", "financeOfficer", "approver", "auditor"];

export const canSeeBuilding = (u: Pick<Doc<"users">, "buildingScope">, buildingId: Id<"buildings">) =>
  u.buildingScope === "all" || (Array.isArray(u.buildingScope) && u.buildingScope.includes(buildingId));

export function assertBuilding(u: Pick<Doc<"users">, "buildingScope">, buildingId: Id<"buildings">) {
  if (!canSeeBuilding(u, buildingId)) fail("forbidden_building");
}

/** Maker-checker: the person who prepared an item may not approve it. */
export function assertDifferentPerson(a: Id<"users">, b: Id<"users">) {
  if (a === b) fail("same_person_cannot_approve");
}

export async function audit(ctx: MutationCtx, actor: Principal, action: string, entity: string, entityId: string, detail = "") {
  await ctx.db.insert("auditLog", { orgId: actor.orgId, actorId: actor._id, action, entity, entityId, detail });
}

/** For things a person does to their own account (two-step sign-in): recorded in their company's history if they have one, else the platform's. */
export async function auditAccount(ctx: MutationCtx, user: Doc<"users">, action: string, entity: string, entityId: string, detail = "") {
  const c = await resolveCompany(ctx, user);
  if ("problem" in c) await ctx.db.insert("platformAudit", { actorId: user._id, action, detail: `${entity} ${entityId} ${detail}`.trim() });
  else await ctx.db.insert("auditLog", { orgId: c.org._id, actorId: user._id, action, entity, entityId, detail });
}

/** Platform-level actions (creating or suspending a company, starting a support session) go in the platform's own log. */
export async function platformAudit(ctx: MutationCtx, actor: Doc<"users">, action: string, orgId: Id<"organizations"> | undefined, detail = "") {
  await ctx.db.insert("platformAudit", { actorId: actor._id, action, ...(orgId ? { orgId } : {}), detail });
}

export async function getSetting(ctx: Ctx, orgId: Id<"organizations">, key: string, fallback: number): Promise<number> {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("orgId", orgId).eq("key", key)).unique();
  return row?.value ?? fallback;
}

export async function setSetting(ctx: MutationCtx, orgId: Id<"organizations">, key: string, value: number) {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("orgId", orgId).eq("key", key)).unique();
  if (row) await ctx.db.patch(row._id, { value }); else await ctx.db.insert("settings", { orgId, key, value });
}

/** Counters (bill numbers, receipt numbers) belong to one company: two companies can each have INV-2026-10-0001. */
export async function nextSeq(ctx: MutationCtx, orgId: Id<"organizations">, key: string): Promise<number> {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("orgId", orgId).eq("key", key)).unique();
  if (row) {
    await ctx.db.patch(row._id, { value: row.value + 1 });
    return row.value + 1;
  }
  await ctx.db.insert("settings", { orgId, key, value: 1 });
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
