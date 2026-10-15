import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, fail, requireRole, requireUser } from "./lib/access";
import { isEmail, isPhone, isTin, normalizePhone } from "./lib/validate";

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

/** The business details printed on bills, receipts and contracts. */
export const org = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const row = await ctx.db.query("organization").first();
    return row ?? { _id: null, name: "Dire Mall" };
  },
});

export const setOrg = mutation({
  args: {
    name: v.string(), tin: v.optional(v.string()), vatNumber: v.optional(v.string()), address: v.optional(v.string()), city: v.optional(v.string()),
    phone: v.optional(v.string()), email: v.optional(v.string()), bankAccounts: v.optional(v.string()), invoiceNote: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "approver");
    const t = (x?: string) => (x && x.trim() ? x.trim() : undefined);
    if (!a.name.trim()) fail("name_required");
    if (t(a.tin) && !isTin(a.tin!)) fail("invalid_tin");
    if (t(a.vatNumber) && !/^\d{6,15}$/.test(a.vatNumber!.replace(/\s/g, ""))) fail("invalid_vat");
    if (t(a.phone) && !isPhone(a.phone!)) fail("invalid_phone");
    if (t(a.email) && !isEmail(a.email!)) fail("invalid_email");
    const doc = {
      name: a.name.trim(), tin: t(a.tin)?.replace(/\s/g, ""), vatNumber: t(a.vatNumber)?.replace(/\s/g, ""), address: t(a.address), city: t(a.city),
      phone: t(a.phone) ? normalizePhone(a.phone!) : undefined, email: t(a.email), bankAccounts: t(a.bankAccounts), invoiceNote: t(a.invoiceNote),
    };
    const row = await ctx.db.query("organization").first();
    if (row) await ctx.db.replace(row._id, doc); else await ctx.db.insert("organization", doc);
    await audit(ctx, u, "organization.update", "organization", "org", doc.name);
  },
});
