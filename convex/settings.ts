import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, requireRole, requireUser } from "./lib/access";

const ALLOWED = ["mfa.required", "tariff.electricity", "tariff.water", "expiryWarnDays", "dueReminderDays"];

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("settings").collect();
    return Object.fromEntries(rows.filter((r) => ALLOWED.includes(r.key)).map((r) => [r.key, r.value]));
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.number() },
  handler: async (ctx, { key, value }) => {
    if (!ALLOWED.includes(key)) throw new Error("unknown_setting");
    const u = await requireRole(ctx, key === "mfa.required" ? "accessAdmin" : "approver");
    if (key === "mfa.required") {
      if (value !== 0 && value !== 1) throw new Error("invalid_value");
      // turning it on while you have no authenticator would lock you out
      const mine = await ctx.db.query("mfaSecrets").withIndex("by_user", (q) => q.eq("userId", u._id)).unique();
      if (value === 1 && !mine?.enabled) throw new ConvexError("mfa_enroll_first");
    }
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key, value });
    await audit(ctx, u, "settings.set", "settings", key, String(value));
  },
});
