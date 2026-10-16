import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { role } from "./schema";
import { getAuthUserId } from "@convex-dev/auth/server";
import { audit, fail, hasRole, mfaState, requireRole, requireUser } from "./lib/access";

export const me = query({
  args: {},
  handler: async (ctx) => {
    try {
      const u = await requireUser(ctx, { skipMfa: true });
      const mfa = await mfaState(ctx, u);
      return { _id: u._id, name: u.name ?? "", email: u.email ?? "", roles: u.roles ?? [], buildingScope: u.buildingScope ?? [], lang: u.lang ?? "en", mfa };
    } catch {
      return null; // signed out, or account not yet activated
    }
  },
});

export const setLang = mutation({
  args: { lang: v.union(v.literal("en"), v.literal("am")) },
  handler: async (ctx, { lang }) => {
    const u = await requireUser(ctx);
    await ctx.db.patch(u._id, { lang });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "accessAdmin");
    const users = await ctx.db.query("users").collect();
    return users.filter((u) => !u.accessStatus).map((u) => ({ _id: u._id, name: u.name ?? "", email: u.email ?? "", roles: u.roles ?? [], buildingScope: u.buildingScope ?? [], active: !!u.active }));
  },
});

/** Grant/revoke access. Access admins manage access but gain no financial powers unless given the role explicitly. */
export const setAccess = mutation({
  args: {
    userId: v.id("users"),
    roles: v.array(role),
    buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))),
    active: v.boolean(),
  },
  handler: async (ctx, a) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const target = (await ctx.db.get(a.userId)) ?? fail("not_found");
    const actorIsSuper = (actor.roles ?? []).includes("superAdmin");
    const targetIsSuper = (target.roles ?? []).includes("superAdmin");
    if (a.userId === actor._id && !a.active) fail("cannot_deactivate_self");
    // Access admins manage other people's access. They cannot change their own roles, touch a super admin, or create one.
    if (!actorIsSuper) {
      if (a.userId === actor._id) fail("cannot_change_own_access");
      if (targetIsSuper || a.roles.includes("superAdmin")) fail("forbidden");
    }
    // The last super admin cannot be demoted or deactivated.
    if (targetIsSuper && (!a.roles.includes("superAdmin") || !a.active)) {
      const supers = (await ctx.db.query("users").collect()).filter((u) => u.active && (u.roles ?? []).includes("superAdmin"));
      if (supers.length <= 1) fail("last_super_admin");
    }
    await ctx.db.patch(a.userId, { roles: a.roles, buildingScope: a.buildingScope, active: a.active });
    if (!a.active) {
      // A departed member loses existing sessions immediately.
      const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", a.userId)).collect();
      for (const s of sessions) {
        const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect();
        for (const t of tokens) await ctx.db.delete(t._id);
        await ctx.db.delete(s._id);
      }
    }
    await audit(ctx, actor, "user.setAccess", "users", a.userId, JSON.stringify({ roles: a.roles, active: a.active }));
  },
});


/** Where the signed-in person stands, for the waiting screen. Works for accounts that are not active yet. */
export const myAccess = query({
  args: {},
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    const u = id ? await ctx.db.get(id) : null;
    if (!u) return null;
    if (u.active) return { status: "active" as const };
    if (u.accessStatus === "pending") return { status: "pending" as const, requestedAt: u.requestedAt ?? 0 };
    if (u.accessStatus === "rejected") return { status: "rejected" as const, reason: u.decisionReason ?? "" };
    return { status: "deactivated" as const };
  },
});

/** Requests for access: waiting ones first, then the ones that were declined. */
export const requests = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "accessAdmin");
    const all = (await ctx.db.query("users").collect()).filter((u) => u.accessStatus);
    const row = (u: (typeof all)[number]) => ({ _id: u._id, name: u.name ?? "", email: u.email ?? "", note: u.accessNote ?? "", requestedAt: u.requestedAt ?? u._creationTime, reason: u.decisionReason ?? "", decidedAt: u.decidedAt ?? 0 });
    return {
      pending: all.filter((u) => u.accessStatus === "pending").sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0)).map(row),
      declined: all.filter((u) => u.accessStatus === "rejected").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, 50).map(row),
    };
  },
});

/** How many requests are waiting, for the badge on the menu. Zero for anyone who cannot decide them. */
export const pendingCount = query({
  args: {},
  handler: async (ctx) => {
    try { await requireRole(ctx, "accessAdmin"); } catch { return 0; }
    return (await ctx.db.query("users").collect()).filter((u) => u.accessStatus === "pending").length;
  },
});

/** Say yes: the person gets the roles and buildings chosen here and can sign in from now on. */
export const approveRequest = mutation({
  args: { userId: v.id("users"), roles: v.array(role), buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))) },
  handler: async (ctx, a) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const target = (await ctx.db.get(a.userId)) ?? fail("not_found");
    if (!target.accessStatus) fail("not_a_request");
    if (a.roles.length === 0) fail("roles_required");
    if (!(actor.roles ?? []).includes("superAdmin") && a.roles.includes("superAdmin")) fail("forbidden");
    if (Array.isArray(a.buildingScope) && a.buildingScope.length === 0) fail("scope_required");
    await ctx.db.patch(a.userId, { roles: a.roles, buildingScope: a.buildingScope, active: true, accessStatus: undefined, decisionReason: undefined, decidedAt: Date.now() });
    await audit(ctx, actor, "access.approve", "users", a.userId, JSON.stringify({ email: target.email, roles: a.roles }));
  },
});

/** Say no, with a reason the person will read when they sign in. They stay out until an administrator changes their mind. */
export const rejectRequest = mutation({
  args: { userId: v.id("users"), reason: v.string() },
  handler: async (ctx, { userId, reason }) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const target = (await ctx.db.get(userId)) ?? fail("not_found");
    if (!target.accessStatus) fail("not_a_request");
    const why = reason.trim().slice(0, 300);
    if (!why) fail("reason_required");
    await ctx.db.patch(userId, { accessStatus: "rejected", decisionReason: why, decidedAt: Date.now(), active: false, roles: [] });
    await audit(ctx, actor, "access.reject", "users", userId, JSON.stringify({ email: target.email, reason: why }));
  },
});

/** Put a declined request back in the waiting list. */
export const reopenRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const target = (await ctx.db.get(userId)) ?? fail("not_found");
    if (target.accessStatus !== "rejected") fail("not_a_request");
    await ctx.db.patch(userId, { accessStatus: "pending", decisionReason: undefined, requestedAt: Date.now() });
    await audit(ctx, actor, "access.reopen", "users", userId, String(target.email));
  },
});

/** Remove a request completely (a mistake or spam). Only for people who never had access. */
export const deleteRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const actor = await requireRole(ctx, "accessAdmin");
    const target = (await ctx.db.get(userId)) ?? fail("not_found");
    if (!target.accessStatus) fail("not_a_request");
    for (const s of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
      for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(t._id);
      await ctx.db.delete(s._id);
    }
    for (const acc of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(acc._id);
    await ctx.db.delete(userId);
    await audit(ctx, actor, "access.delete", "users", userId, String(target.email));
  },
});
