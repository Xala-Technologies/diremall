import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { role } from "./schema";
import { audit, fail, requireAccount, requireRole } from "./lib/access";
import { assertBuildingIn } from "./lib/scope";
import { inOrg, owned } from "./lib/tenant";
import { assertSeatFree } from "./lib/plan";
import { normalizeInviteCode, redeemInvite } from "./lib/signup";
import { newRecoveryCode, sha256Hex } from "./lib/totp";

const DAY = 24 * 60 * 60 * 1000;
export const INVITE_DAYS = 7;

/** Invite someone by email into this company. Returns the one-time code to hand to them in person or by phone. It is shown only now. */
export const create = mutation({
  args: { email: v.string(), roles: v.array(role), buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))) },
  handler: async (ctx, a) => {
    const admin = await requireRole(ctx, "accessAdmin");
    const email = a.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid_email");
    if (a.roles.length === 0) return fail("roles_required");
    if (!(admin.roles ?? []).includes("superAdmin") && a.roles.includes("superAdmin")) return fail("forbidden");
    if (Array.isArray(a.buildingScope)) { if (a.buildingScope.length === 0) return fail("scope_required"); for (const b of a.buildingScope) await assertBuildingIn(ctx, admin, b); }
    // someone who already works here is changed under Staff access, not invited again
    const existing = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
    if (existing && (await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", admin.orgId).eq("userId", existing._id)).unique())) return fail("already_a_member");
    await assertSeatFree(ctx, admin.orgId);
    // a newer invite replaces any unused older one for the same address in this company
    for (const old of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()) if (old.orgId === admin.orgId && !old.usedAt) await ctx.db.delete(old._id);
    const code = newRecoveryCode();
    await ctx.db.insert("invites", { orgId: admin.orgId, email, codeHash: await sha256Hex(normalizeInviteCode(code)), roles: a.roles, buildingScope: a.buildingScope, createdBy: admin._id, expiresAt: Date.now() + INVITE_DAYS * DAY });
    await audit(ctx, admin, "invite.create", "invites", email, JSON.stringify({ roles: a.roles }));
    return { code, email, expiresAt: Date.now() + INVITE_DAYS * DAY };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "accessAdmin");
    const all = await inOrg(ctx, "invites", u.orgId).order("desc").take(100);
    return all.filter((i) => !i.usedAt && i.expiresAt > Date.now()).map((i) => ({ _id: i._id, email: i.email, roles: i.roles, expiresAt: i.expiresAt }));
  },
});

export const revoke = mutation({
  args: { id: v.id("invites") },
  handler: async (ctx, { id }) => {
    const admin = await requireRole(ctx, "accessAdmin");
    const inv = await owned(ctx, admin.orgId, id);
    if (!inv.usedAt) await ctx.db.delete(id);
    await audit(ctx, admin, "invite.revoke", "invites", inv.email);
  },
});

/** A signed-in person who already has an account uses an invitation code to join another company. */
export const accept = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireAccount(ctx);
    try { const orgId = await redeemInvite(ctx, user._id, (user.email ?? "").trim().toLowerCase(), code); return { orgId }; } catch { return fail("invite_invalid"); }
  },
});
