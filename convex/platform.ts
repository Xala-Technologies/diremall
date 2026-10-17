import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { platformAudit, requirePlatform } from "./lib/access";
import { fail } from "./lib/access";
import { PLANS, usage } from "./lib/plan";
import { normalizeInviteCode } from "./lib/signup";
import { newRecoveryCode, sha256Hex } from "./lib/totp";
import { scan } from "./integrity";

/**
 * The platform console: everything the platform team does across companies. It shows counts, standing and health, never a company's
 * line items. To look at a company's own records the team starts a support session (reason, read only, limited time, visible to the company).
 */

const DAY = 86_400_000;
const status = v.union(v.literal("trial"), v.literal("active"), v.literal("past_due"), v.literal("suspended"), v.literal("cancelled"));
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

async function lastActivity(ctx: import("./_generated/server").QueryCtx, orgId: Id<"organizations">) {
  const row = await ctx.db.query("auditLog").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").first();
  return row?._creationTime ?? null;
}

async function summary(ctx: import("./_generated/server").QueryCtx, o: Doc<"organizations">) {
  const u = await usage(ctx, o._id);
  const members = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", o._id)).collect();
  const admins = [];
  for (const m of members.filter((x) => x.roles.includes("superAdmin") && x.status === "active").slice(0, 3)) { const p = await ctx.db.get(m.userId); admins.push({ name: p?.name ?? "", email: p?.email ?? "" }); }
  const month = new Date(); const from = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1);
  const sms = (await ctx.db.query("smsMessages").withIndex("by_org", (q) => q.eq("orgId", o._id).gte("_creationTime", from)).collect()).filter((m) => m.status !== "cancelled").length;
  return { _id: o._id, name: o.name, slug: o.slug, status: o.status, plan: o.plan, limits: o.limits, trialEndsAt: o.trialEndsAt ?? null, country: o.country ?? "", currency: o.currency, createdAt: o._creationTime, units: u.units, seats: u.seats, smsThisMonth: sms, admins, lastActivity: await lastActivity(ctx, o._id) };
}

export const companies = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    const all = await ctx.db.query("organizations").collect();
    return Promise.all(all.sort((a, b) => b._creationTime - a._creationTime).map((o) => summary(ctx, o)));
  },
});

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    const all = await ctx.db.query("organizations").collect();
    const by = (s: string) => all.filter((o) => o.status === s).length;
    const rows = await Promise.all(all.map((o) => summary(ctx, o)));
    const people = new Set((await ctx.db.query("memberships").collect()).filter((m) => m.status === "active").map((m) => m.userId));
    return {
      companies: all.length, trial: by("trial"), active: by("active"), pastDue: by("past_due"), suspended: by("suspended"), cancelled: by("cancelled"),
      units: rows.reduce((a, r) => a + r.units, 0), people: people.size, smsThisMonth: rows.reduce((a, r) => a + r.smsThisMonth, 0),
      endingTrials: all.filter((o) => o.status === "trial" && o.trialEndsAt && o.trialEndsAt < Date.now() + 7 * DAY).map((o) => ({ _id: o._id, name: o.name, trialEndsAt: o.trialEndsAt! })),
      plans: Object.keys(PLANS).map((p) => ({ plan: p, label: PLANS[p]!.label, count: all.filter((o) => o.plan === p).length })),
    };
  },
});

export const company = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requirePlatform(ctx);
    const o = (await ctx.db.get(orgId)) ?? fail("not_found");
    const members = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const people = [];
    for (const m of members) { const p = await ctx.db.get(m.userId); people.push({ membershipId: m._id, name: p?.name ?? "", email: p?.email ?? "", roles: m.roles, active: m.status === "active" }); }
    const log = await ctx.db.query("platformAudit").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(50);
    const sessions = await ctx.db.query("supportSessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(20);
    const who = async (id: Id<"users">) => (await ctx.db.get(id))?.email ?? "";
    return {
      ...(await summary(ctx, o)), people, joinCode: o.joinCode ?? null, tzOffsetHours: o.tzOffsetHours, defaultLang: o.defaultLang, defaultCalendar: o.defaultCalendar, statusReason: o.statusReason ?? "",
      log: await Promise.all(log.map(async (l) => ({ at: l._creationTime, action: l.action, detail: l.detail, by: await who(l.actorId) }))),
      sessions: await Promise.all(sessions.map(async (s) => ({ _id: s._id, by: await who(s.platformUserId), reason: s.reason, startedAt: s.startedAt, expiresAt: s.expiresAt, endedAt: s.endedAt ?? null }))),
    };
  },
});

/** Make a new company and the invitation for its first administrator. The code is shown once, to hand to that person. */
export const createCompany = mutation({
  args: {
    name: v.string(), slug: v.string(), adminEmail: v.string(), plan: v.string(), country: v.optional(v.string()), currency: v.optional(v.string()),
    tzOffsetHours: v.optional(v.number()), defaultLang: v.optional(v.union(v.literal("en"), v.literal("am"))), defaultCalendar: v.optional(v.union(v.literal("gregorian"), v.literal("ethiopian"))),
  },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const name = a.name.trim(); const slug = a.slug.trim().toLowerCase(); const email = a.adminEmail.trim().toLowerCase();
    if (!name) fail("name_required");
    if (!SLUG.test(slug)) fail("invalid_slug");
    if (await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", slug)).first()) fail("slug_taken");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("invalid_email");
    const plan = PLANS[a.plan]; if (!plan) fail("unknown_plan");
    const currency = (a.currency ?? "ETB").toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) fail("invalid_currency");
    const tz = a.tzOffsetHours ?? 3; if (!Number.isInteger(tz) || tz < -12 || tz > 14) fail("invalid_timezone");
    const p = plan!;
    const orgId = await ctx.db.insert("organizations", {
      name, slug, status: a.plan === "trial" ? "trial" : "active", plan: a.plan, limits: { units: p.units, seats: p.seats, smsPerMonth: p.smsPerMonth },
      ...(p.trialDays ? { trialEndsAt: Date.now() + p.trialDays * DAY } : {}), currency, tzOffsetHours: tz, defaultLang: a.defaultLang ?? "en", defaultCalendar: a.defaultCalendar ?? "gregorian",
      ...(a.country ? { country: a.country.trim().toUpperCase().slice(0, 2) } : {}), createdBy: me._id,
    });
    const code = newRecoveryCode();
    await ctx.db.insert("invites", { orgId, email, codeHash: await sha256Hex(normalizeInviteCode(code)), roles: ["superAdmin"], buildingScope: "all", createdBy: me._id, expiresAt: Date.now() + 14 * DAY });
    await platformAudit(ctx, me, "company.create", orgId, `${name} (${slug}), plan ${a.plan}, first administrator ${email}`);
    return { orgId, code, email, expiresAt: Date.now() + 14 * DAY };
  },
});

/** Another invitation for a company's first administrator (the first one expired or was lost). */
export const reinviteAdmin = mutation({
  args: { orgId: v.id("organizations"), email: v.string() },
  handler: async (ctx, { orgId, email }) => {
    const me = await requirePlatform(ctx);
    (await ctx.db.get(orgId)) ?? fail("not_found");
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) fail("invalid_email");
    for (const old of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", e)).collect()) if (old.orgId === orgId && !old.usedAt) await ctx.db.delete(old._id);
    const code = newRecoveryCode();
    await ctx.db.insert("invites", { orgId, email: e, codeHash: await sha256Hex(normalizeInviteCode(code)), roles: ["superAdmin"], buildingScope: "all", createdBy: me._id, expiresAt: Date.now() + 14 * DAY });
    await platformAudit(ctx, me, "company.reinvite", orgId, e);
    return { code, email: e };
  },
});

export const updatePlan = mutation({
  args: { orgId: v.id("organizations"), plan: v.string(), units: v.number(), seats: v.number(), smsPerMonth: v.number(), trialEndsAt: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    (await ctx.db.get(a.orgId)) ?? fail("not_found");
    for (const n of [a.units, a.seats, a.smsPerMonth]) if (!Number.isInteger(n) || n < 0 || n > 10_000_000) fail("invalid_limit");
    await ctx.db.patch(a.orgId, { plan: a.plan.trim() || "custom", limits: { units: a.units, seats: a.seats, smsPerMonth: a.smsPerMonth }, ...(a.trialEndsAt === undefined ? {} : { trialEndsAt: a.trialEndsAt ?? undefined }) });
    await platformAudit(ctx, me, "company.plan", a.orgId, `${a.plan}: ${a.units} units, ${a.seats} seats, ${a.smsPerMonth} sms`);
  },
});

/** Suspend (read only), mark past due, cancel, or bring a company back. A reason is recorded and shown to the company. */
export const setStatus = mutation({
  args: { orgId: v.id("organizations"), status, reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const o = (await ctx.db.get(a.orgId)) ?? fail("not_found");
    if ((a.status === "suspended" || a.status === "cancelled" || a.status === "past_due") && !a.reason?.trim()) fail("reason_required");
    await ctx.db.patch(a.orgId, { status: a.status, statusReason: a.reason?.trim() || undefined, ...(a.status === "cancelled" ? { cancelledAt: Date.now() } : { cancelledAt: undefined }) });
    await platformAudit(ctx, me, "company.status", a.orgId, `${o.status} → ${a.status}${a.reason ? `: ${a.reason.trim()}` : ""}`);
  },
});

/** Health of a company's books, as counts per kind of problem only (no names, no figures). */
export const health = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requirePlatform(ctx);
    (await ctx.db.get(orgId)) ?? fail("not_found");
    const r = await scan(ctx, orgId);
    const by = new Map<string, number>(); for (const f of r.findings) by.set(f.code, (by.get(f.code) ?? 0) + 1);
    return { checked: r.checked, truncated: r.truncated, problems: [...by].map(([code, n]) => ({ code, n })) };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Support sessions
// ---------------------------------------------------------------------------------------------------------------

/** Open a company's records, read only, for a limited time, with a reason. The company can see this in its Settings. */
export const startSupport = mutation({
  args: { orgId: v.id("organizations"), reason: v.string(), minutes: v.number() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    (await ctx.db.get(a.orgId)) ?? fail("not_found");
    const why = a.reason.trim();
    if (why.length < 10) fail("support_reason_required");
    if (!Number.isInteger(a.minutes) || a.minutes < 5 || a.minutes > 120) fail("invalid_minutes");
    for (const s of await ctx.db.query("supportSessions").withIndex("by_user", (q) => q.eq("platformUserId", me._id)).collect()) if (!s.endedAt && s.expiresAt > Date.now()) await ctx.db.patch(s._id, { endedAt: Date.now() });
    const id = await ctx.db.insert("supportSessions", { platformUserId: me._id, orgId: a.orgId, reason: why, startedAt: Date.now(), expiresAt: Date.now() + a.minutes * 60_000 });
    await platformAudit(ctx, me, "support.start", a.orgId, `${a.minutes} min: ${why}`);
    return { sessionId: id };
  },
});

export const endSupport = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requirePlatform(ctx);
    for (const s of await ctx.db.query("supportSessions").withIndex("by_user", (q) => q.eq("platformUserId", me._id)).collect()) {
      if (!s.endedAt && s.expiresAt > Date.now()) { await ctx.db.patch(s._id, { endedAt: Date.now() }); await platformAudit(ctx, me, "support.end", s.orgId); }
    }
  },
});

export const mySupport = query({
  args: {},
  handler: async (ctx) => {
    const me = await requirePlatform(ctx);
    const open = (await ctx.db.query("supportSessions").withIndex("by_user", (q) => q.eq("platformUserId", me._id)).order("desc").take(5)).find((s) => !s.endedAt && s.expiresAt > Date.now());
    if (!open) return null;
    return { orgId: open.orgId, company: (await ctx.db.get(open.orgId))?.name ?? "", reason: open.reason, expiresAt: open.expiresAt };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// The platform team
// ---------------------------------------------------------------------------------------------------------------

export const team = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    const users = (await ctx.db.query("users").collect()).filter((u) => u.platformRole === "platformAdmin");
    return users.map((u) => ({ _id: u._id, name: u.name ?? "", email: u.email ?? "" }));
  },
});

/** Make an existing account part of the platform team, or take it out. The team always keeps at least one person. */
export const setTeamMember = mutation({
  args: { email: v.string(), on: v.boolean() },
  handler: async (ctx, { email, on }) => {
    const me = await requirePlatform(ctx);
    const e = email.trim().toLowerCase();
    const target = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).first();
    if (!target) return fail("not_found");
    if (!on) {
      const team = (await ctx.db.query("users").collect()).filter((u) => u.platformRole === "platformAdmin");
      if (team.length <= 1) fail("last_platform_admin");
    }
    await ctx.db.patch(target._id, { platformRole: on ? "platformAdmin" : undefined });
    await platformAudit(ctx, me, on ? "team.add" : "team.remove", undefined, e);
  },
});

export const auditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatform(ctx);
    const rows = await ctx.db.query("platformAudit").order("desc").take(Math.min(limit ?? 100, 300));
    return Promise.all(rows.map(async (l) => ({ at: l._creationTime, action: l.action, detail: l.detail, company: l.orgId ? (await ctx.db.get(l.orgId))?.name ?? "" : "", by: (await ctx.db.get(l.actorId))?.email ?? "" })));
  },
});

/** Delete a cancelled company and everything in it, for good. The company's name must be typed to confirm. */
export const deleteCompany = mutation({
  args: { orgId: v.id("organizations"), confirmSlug: v.string() },
  handler: async (ctx, { orgId, confirmSlug }) => {
    const me = await requirePlatform(ctx);
    const o = (await ctx.db.get(orgId)) ?? fail("not_found");
    if (o.status !== "cancelled") fail("cancel_first");
    if (confirmSlug.trim().toLowerCase() !== o.slug) fail("confirmation_does_not_match");
    await platformAudit(ctx, me, "company.delete", orgId, `${o.name} (${o.slug})`);
    await ctx.scheduler.runAfter(0, internal.tenancy.purge, { orgId });
  },
});
