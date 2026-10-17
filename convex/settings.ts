import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, fail, requireRole, requireUser, setSetting } from "./lib/access";
import { inOrg } from "./lib/tenant";
import { isEmail, isPhone, isTin, normalizePhone } from "./lib/validate";

const ALLOWED = ["mfa.required", "tariff.electricity", "tariff.water", "expiryWarnDays", "dueReminderDays"];

export const get = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    const rows = await inOrg(ctx, "settings", u.orgId).collect();
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
    await setSetting(ctx, u.orgId, key, value);
    await audit(ctx, u, "settings.set", "settings", key, String(value));
  },
});

/** The business details printed on bills, receipts and contracts. */
export const org = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    const row = await ctx.db.query("organization").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).first();
    return row ?? { _id: null, name: u.org.name };
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
    const row = await ctx.db.query("organization").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).first();
    if (row) await ctx.db.replace(row._id, { orgId: u.orgId, ...doc }); else await ctx.db.insert("organization", { orgId: u.orgId, ...doc });
    await audit(ctx, u, "organization.update", "organization", "org", doc.name);
  },
});


/** The company as the screens need it: its name, plan and standing, and the formats everything is shown in. */
export const company = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx, { skipMfa: true });
    const o = u.org;
    return { _id: o._id, name: o.name, slug: o.slug, status: o.status, plan: o.plan, currency: o.currency, tzOffsetHours: o.tzOffsetHours, defaultLang: o.defaultLang, defaultCalendar: o.defaultCalendar, trialEndsAt: o.trialEndsAt, support: !!u.support };
  },
});

/** The formats a company works in. Approvers set them; the platform sets the plan and limits. */
export const setCompany = mutation({
  args: { currency: v.string(), tzOffsetHours: v.number(), defaultLang: v.union(v.literal("en"), v.literal("am")), defaultCalendar: v.union(v.literal("gregorian"), v.literal("ethiopian")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "approver");
    if (!/^[A-Z]{3}$/.test(a.currency)) fail("invalid_currency");
    if (!Number.isInteger(a.tzOffsetHours) || a.tzOffsetHours < -12 || a.tzOffsetHours > 14) fail("invalid_timezone");
    await ctx.db.patch(u.orgId, a);
    await audit(ctx, u, "company.formats", "organizations", u.orgId, JSON.stringify(a));
  },
});

/** When the platform team has looked at this company's records, and why. Companies can always see this. */
export const supportAccess = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "approver");
    const rows = await ctx.db.query("supportSessions").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).order("desc").take(30);
    return Promise.all(rows.map(async (s) => ({ _id: s._id, by: (await ctx.db.get(s.platformUserId))?.name || (await ctx.db.get(s.platformUserId))?.email || "", reason: s.reason, startedAt: s.startedAt, expiresAt: s.expiresAt, endedAt: s.endedAt ?? null, open: !s.endedAt && s.expiresAt > Date.now() })));
  },
});

/** Is the platform team looking at this company right now? Shown as a banner to everyone in the company. */
export const supportOpen = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx, { skipMfa: true });
    const open = (await ctx.db.query("supportSessions").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).order("desc").take(5)).find((s) => !s.endedAt && s.expiresAt > Date.now());
    return open ? { until: open.expiresAt } : null;
  },
});
