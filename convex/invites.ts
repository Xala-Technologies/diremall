import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { role } from "./schema";
import { audit, fail, requireRole } from "./lib/access";
import { normalizeInviteCode } from "./lib/signup";
import { newRecoveryCode, sha256Hex } from "./lib/totp";

const DAY = 24 * 60 * 60 * 1000;
export const INVITE_DAYS = 7;

/** Invite someone by email. Returns the one-time code to hand to them in person or by phone. It is shown only now. */
export const create = mutation({
  args: { email: v.string(), roles: v.array(role), buildingScope: v.union(v.literal("all"), v.array(v.id("buildings"))) },
  handler: async (ctx, a) => {
    const admin = await requireRole(ctx, "accessAdmin");
    const email = a.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("invalid_email");
    if (a.roles.length === 0) return fail("roles_required");
    if (!(admin.roles ?? []).includes("superAdmin") && a.roles.includes("superAdmin")) return fail("forbidden");
    const existing = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
    if (existing) return fail("email_already_registered");
    // a newer invite replaces any unused older one for the same address
    for (const old of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()) if (!old.usedAt) await ctx.db.delete(old._id);
    const code = newRecoveryCode();
    await ctx.db.insert("invites", { email, codeHash: await sha256Hex(normalizeInviteCode(code)), roles: a.roles, buildingScope: a.buildingScope, createdBy: admin._id, expiresAt: Date.now() + INVITE_DAYS * DAY });
    await audit(ctx, admin, "invite.create", "invites", email, JSON.stringify({ roles: a.roles }));
    return { code, email, expiresAt: Date.now() + INVITE_DAYS * DAY };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "accessAdmin");
    const all = await ctx.db.query("invites").order("desc").take(100);
    return all.filter((i) => !i.usedAt && i.expiresAt > Date.now()).map((i) => ({ _id: i._id, email: i.email, roles: i.roles, expiresAt: i.expiresAt }));
  },
});

export const revoke = mutation({
  args: { id: v.id("invites") },
  handler: async (ctx, { id }) => {
    const admin = await requireRole(ctx, "accessAdmin");
    const inv = (await ctx.db.get(id)) ?? fail("not_found");
    if (!inv.usedAt) await ctx.db.delete(id);
    await audit(ctx, admin, "invite.revoke", "invites", inv.email);
  },
});
