import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { role } from "./schema";
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
    return users.map((u) => ({ _id: u._id, name: u.name ?? "", email: u.email ?? "", roles: u.roles ?? [], buildingScope: u.buildingScope ?? [], active: !!u.active }));
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
