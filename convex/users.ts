import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { role } from "./schema";
import { audit, fail, mfaState, orgIsFrozen, requireAccount, requireRole, resolveCompany } from "./lib/access";
import { assertBuildingIn } from "./lib/scope";
import { assertSeatFree } from "./lib/plan";
import { normalizeCompanyCode, requestToJoin as requestToJoinCompany } from "./lib/signup";
import { newRecoveryCode } from "./lib/totp";

/**
 * The signed-in person and where they stand. Never throws for a person who has no company yet: the screens use `ready` and `problem`
 * to show the right page (join a company, waiting for approval, choose a company).
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    const user = id ? await ctx.db.get(id) : null;
    if (!user || user.active === false) return null;
    const memberships = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const companies = [];
    for (const m of memberships) { const o = await ctx.db.get(m.orgId); if (o) companies.push({ orgId: o._id, name: o.name, slug: o.slug, roles: m.roles, status: m.status, active: user.activeOrgId === o._id }); }
    const base = { _id: user._id, name: user.name ?? "", email: user.email ?? "", lang: user.lang ?? "en", platformAdmin: user.platformRole === "platformAdmin", companies };
    const c = await resolveCompany(ctx, user);
    if ("problem" in c) {
      const mfa = await mfaState(ctx, user);
      return { ...base, ready: false as const, problem: c.problem, roles: [] as string[], buildingScope: [] as Id<"buildings">[] | "all", mfa, org: null, support: false };
    }
    const roles = c.support ? ["auditor"] : c.membership!.roles;
    const scope = c.support ? ("all" as const) : c.membership!.buildingScope;
    const mfa = await mfaState(ctx, { ...user, roles, buildingScope: scope } as Doc<"users">, c.org._id);
    return {
      ...base, ready: true as const, problem: null, roles, buildingScope: scope, mfa, support: !!c.support,
      org: { _id: c.org._id, name: c.org.name, slug: c.org.slug, status: c.org.status, plan: c.org.plan, currency: c.org.currency, tzOffsetHours: c.org.tzOffsetHours, defaultLang: c.org.defaultLang, defaultCalendar: c.org.defaultCalendar, frozen: orgIsFrozen(c.org) },
    };
  },
});

export const setLang = mutation({
  args: { lang: v.union(v.literal("en"), v.literal("am")) },
  handler: async (ctx, { lang }) => {
    const u = await requireAccount(ctx);
    await ctx.db.patch(u._id, { lang });
  },
});

/** Open another company the person belongs to. */
export const switchCompany = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const u = await requireAccount(ctx);
    const m = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", u._id)).unique();
    if (!m || m.status !== "active") return fail("forbidden");
    await ctx.db.patch(u._id, { activeOrgId: orgId });
  },
});

/** Where a person without access to any company stands: waiting, declined, or nowhere yet. */
export const myAccess = query({
  args: {},
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    const u = id ? await ctx.db.get(id) : null;
    if (!u) return null;
    if (u.active === false) return { status: "deactivated" as const };
    const c = await resolveCompany(ctx, u);
    if (!("problem" in c)) return { status: "active" as const };
    if (c.problem === "choose_company") return { status: "choose" as const };
    const reqs = await ctx.db.query("accessRequests").withIndex("by_user", (q) => q.eq("userId", u._id)).collect();
    const pending = reqs.find((r) => r.status === "pending");
    const nameOf = async (orgId: Id<"organizations">) => (await ctx.db.get(orgId))?.name ?? "";
    if (pending) return { status: "pending" as const, requestedAt: pending.requestedAt, company: await nameOf(pending.orgId) };
    const rejected = reqs.find((r) => r.status === "rejected");
    if (rejected) return { status: "rejected" as const, reason: rejected.decisionReason ?? "", company: await nameOf(rejected.orgId) };
    const suspended = (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", u._id)).collect()).find((m) => m.status === "suspended");
    if (suspended) return { status: "deactivated" as const, company: await nameOf(suspended.orgId) };
    return { status: "none" as const, platformAdmin: u.platformRole === "platformAdmin" };
  },
});

/** Use a company join code (or ask again) from the "join a company" screen. The company's access managers decide. */
export const requestToJoin = mutation({
  args: { code: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { code, note }) => {
    const u = await requireAccount(ctx);
    try { await requestToJoinCompany(ctx, u._id, code, note); } catch (e) { return fail(e instanceof Error ? e.message : "company_code_invalid"); }
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Staff of the company, and requests to join it
// ---------------------------------------------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "accessAdmin");
    const ms = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).collect();
    const out = [];
    for (const m of ms) { const p = await ctx.db.get(m.userId); out.push({ _id: m._id, userId: m.userId, name: p?.name ?? "", email: p?.email ?? "", roles: m.roles, buildingScope: m.buildingScope, active: m.status === "active" }); }
    return out;
  },
});

/** Grant, change or revoke access in this company. Access managers cannot change their own access, touch an administrator, or create one. */
export const setAccess = mutation({
  args: { membershipId: v.id("memberships"), roles: v.array(role), buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))), active: v.boolean() },
  handler: async (ctx, a) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const target = await ctx.db.get(a.membershipId);
    if (!target || target.orgId !== actor.orgId) return fail("not_found");
    const actorIsSuper = (actor.roles ?? []).includes("superAdmin");
    const targetIsSuper = target.roles.includes("superAdmin");
    if (target.userId === actor._id && !a.active) fail("cannot_deactivate_self");
    if (!actorIsSuper) {
      if (target.userId === actor._id) fail("cannot_change_own_access");
      if (targetIsSuper || a.roles.includes("superAdmin")) fail("forbidden");
    }
    if (Array.isArray(a.buildingScope)) for (const b of a.buildingScope) await assertBuildingIn(ctx, actor, b);
    // the company's last administrator cannot be demoted or switched off
    if (targetIsSuper && (!a.roles.includes("superAdmin") || !a.active)) {
      const supers = (await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", actor.orgId)).collect()).filter((m) => m.status === "active" && m.roles.includes("superAdmin"));
      if (supers.length <= 1) fail("last_super_admin");
    }
    if (a.active && target.status !== "active") await assertSeatFree(ctx, actor.orgId);
    await ctx.db.patch(a.membershipId, { roles: a.roles, buildingScope: a.buildingScope, status: a.active ? "active" : "suspended" });
    if (!a.active) await endSessionsIfNoCompany(ctx, target.userId);
    await audit(ctx, actor, "user.setAccess", "memberships", a.membershipId, JSON.stringify({ roles: a.roles, active: a.active }));
  },
});

/** A person who now belongs to no company loses their sign-ins at once. (Someone with another company keeps theirs.) */
async function endSessionsIfNoCompany(ctx: import("./_generated/server").MutationCtx, userId: Id<"users">) {
  const left = (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).some((m) => m.status === "active");
  if (left) return;
  const user = await ctx.db.get(userId);
  if (user?.platformRole === "platformAdmin") return;
  for (const s of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
    for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(s._id);
  }
}

/** Requests to join this company: waiting ones first, then the ones that were declined. */
export const requests = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "accessAdmin");
    const all = await ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", u.orgId)).collect();
    const row = async (r: Doc<"accessRequests">) => { const p = await ctx.db.get(r.userId); return { _id: r._id, userId: r.userId, name: p?.name ?? "", email: p?.email ?? "", note: r.note ?? "", requestedAt: r.requestedAt, reason: r.decisionReason ?? "", decidedAt: r.decidedAt ?? 0 }; };
    const pending = await Promise.all(all.filter((r) => r.status === "pending").sort((a, b) => a.requestedAt - b.requestedAt).map(row));
    const declined = await Promise.all(all.filter((r) => r.status === "rejected").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, 50).map(row));
    return { pending, declined };
  },
});

/** How many requests are waiting, for the badge on the menu. Zero for anyone who cannot decide them. */
export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    try {
      const u = await requireRole(ctx, "accessAdmin");
      return (await ctx.db.query("accessRequests").withIndex("by_org_status", (q) => q.eq("orgId", u.orgId).eq("status", "pending")).collect()).length;
    } catch { return 0; }
  },
});

async function loadRequest(ctx: import("./_generated/server").QueryCtx, orgId: Id<"organizations">, id: Id<"accessRequests">) {
  const r = await ctx.db.get(id);
  if (!r || r.orgId !== orgId) return fail("not_found");
  return r;
}

/** Say yes: the person joins with the roles and buildings chosen here. */
export const approveRequest = mutation({
  args: { requestId: v.id("accessRequests"), roles: v.array(role), buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))) },
  handler: async (ctx, a) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const r = await loadRequest(ctx, actor.orgId, a.requestId);
    if (a.roles.length === 0) fail("roles_required");
    if (!(actor.roles ?? []).includes("superAdmin") && a.roles.includes("superAdmin")) fail("forbidden");
    if (Array.isArray(a.buildingScope)) { if (a.buildingScope.length === 0) fail("scope_required"); for (const b of a.buildingScope) await assertBuildingIn(ctx, actor, b); }
    await assertSeatFree(ctx, actor.orgId);
    const had = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", actor.orgId).eq("userId", r.userId)).unique();
    if (had) await ctx.db.patch(had._id, { roles: a.roles, buildingScope: a.buildingScope, status: "active" });
    else await ctx.db.insert("memberships", { orgId: actor.orgId, userId: r.userId, roles: a.roles, buildingScope: a.buildingScope, status: "active", invitedBy: actor._id });
    const person = await ctx.db.get(r.userId);
    if (person && !person.activeOrgId) await ctx.db.patch(r.userId, { activeOrgId: actor.orgId });
    await ctx.db.delete(r._id);
    await audit(ctx, actor, "access.approve", "users", r.userId, JSON.stringify({ email: person?.email, roles: a.roles }));
  },
});

/** Say no, with a reason the person will read when they sign in. */
export const rejectRequest = mutation({
  args: { requestId: v.id("accessRequests"), reason: v.string() },
  handler: async (ctx, { requestId, reason }) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const r = await loadRequest(ctx, actor.orgId, requestId);
    const why = reason.trim().slice(0, 300);
    if (!why) fail("reason_required");
    await ctx.db.patch(r._id, { status: "rejected", decisionReason: why, decidedAt: Date.now() });
    await audit(ctx, actor, "access.reject", "users", r.userId, why);
  },
});

export const reopenRequest = mutation({
  args: { requestId: v.id("accessRequests") },
  handler: async (ctx, { requestId }) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const r = await loadRequest(ctx, actor.orgId, requestId);
    if (r.status !== "rejected") fail("not_a_request");
    await ctx.db.patch(r._id, { status: "pending", decisionReason: undefined, requestedAt: Date.now() });
    await audit(ctx, actor, "access.reopen", "users", r.userId);
  },
});

/** Remove a request (a mistake or spam). The person's account stays; they can ask again. */
export const deleteRequest = mutation({
  args: { requestId: v.id("accessRequests") },
  handler: async (ctx, { requestId }) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const r = await loadRequest(ctx, actor.orgId, requestId);
    await ctx.db.delete(r._id);
    await audit(ctx, actor, "access.delete", "users", r.userId);
  },
});

// ---------------------------------------------------------------------------------------------------------------
// The company's join code
// ---------------------------------------------------------------------------------------------------------------

export const joinCode = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "accessAdmin");
    return { code: u.org.joinCode ?? null, slug: u.org.slug };
  },
});

/** Make (or replace) the code people use to ask to join this company. The old code stops working. */
export const rotateJoinCode = mutation({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "accessAdmin");
    let code = normalizeCompanyCode(newRecoveryCode()).slice(0, 8);
    while (await ctx.db.query("organizations").withIndex("by_join_code", (q) => q.eq("joinCode", code)).first()) code = normalizeCompanyCode(newRecoveryCode()).slice(0, 8);
    await ctx.db.patch(u.orgId, { joinCode: code });
    await audit(ctx, u, "company.joinCode", "organizations", u.orgId, "rotated");
    return { code };
  },
});

export const disableJoinCode = mutation({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "accessAdmin");
    await ctx.db.patch(u.orgId, { joinCode: undefined });
    await audit(ctx, u, "company.joinCode", "organizations", u.orgId, "off");
  },
});

