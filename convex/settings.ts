import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, requireRole, requireUser } from "./lib/access";

const ALLOWED = ["tariff.electricity", "tariff.water", "expiryWarnDays", "dueReminderDays"];

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
    const u = await requireRole(ctx, "approver");
    if (!ALLOWED.includes(key)) throw new Error("unknown_setting");
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key, value });
    await audit(ctx, u, "settings.set", "settings", key, String(value));
  },
});
