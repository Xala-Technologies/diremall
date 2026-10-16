import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { READ_ROLES, audit, canSeeBuilding, fail, requireRole } from "./lib/access";
import { invoiceBalance } from "./lib/ledger";
import { assertRenterVisible } from "./lib/scope";
import { SMS_DEFAULTS, SMS_SETTING_KEYS, inQuietHours, loadTemplate, orgName, queueTemplated, smsRules } from "./lib/sms";
import { BROADCAST_PLACEHOLDERS, DEFAULT_TEMPLATES, PLACEHOLDERS, TEMPLATE_KINDS, checkTemplate, renderTemplate, smsDate, smsMoney, smsSegments, type Lang, type TemplateKind } from "./lib/smsTemplates";
import { refreshUnitStatus } from "./lib/units";
import { isPhone, normalizePhone } from "./lib/validate";

const DAY = 86_400_000;
const BACKOFF_MS = [15 * 60_000, 60 * 60_000, 3 * 60 * 60_000]; // waits before the 2nd, 3rd and 4th try after a "slow down" reply
const MAX_ATTEMPTS = 3;

// The daily jobs below walk a whole table. Convex allows 4,096 lookups per call, so each job handles one page
// of PAGE rows and schedules itself for the next page until the table is done.
const PAGE = 250;
const cursorArg = { cursor: v.optional(v.union(v.string(), v.null())) };

/**
 * Daily: remind about bills falling due, and chase bills that are past due on the schedule set in Settings (for example
 * after 1, 7 and 30 days). A bill gets only the latest step it has reached, so an old overdue bill is chased once, not
 * three times on the first run. Paid bills never trigger a message.
 */
export const queueDueReminders = internalMutation({
  args: cursorArg,
  handler: async (ctx, { cursor }): Promise<number> => {
    const rules = await smsRules(ctx);
    const org = await orgName(ctx);
    const now = Date.now();
    let queued = 0;
    // only bills that still owe money
    const page = await ctx.db.query("invoices").withIndex("by_status_due", (q) => q.eq("status", "issued").gt("due", 0)).paginate({ numItems: PAGE, cursor: cursor ?? null });
    for (const inv of page.page) {
      const bal = await invoiceBalance(ctx, inv);
      if (bal.due <= 0) continue;
      const unit = (await ctx.db.get(inv.unitId))?.number ?? "";
      const base = { renterId: inv.renterId, invoiceId: inv._id, org };
      const vars = (lang: Lang, days: number) => ({ bill: inv.number, amount: smsMoney(bal.due), due: smsDate(inv.dueAt, lang), days, unit });
      const lateDays = Math.floor((now - inv.dueAt) / DAY);
      if (inv.dueAt >= now && rules.before > 0 && inv.dueAt - now <= rules.before * DAY) {
        const days = Math.ceil((inv.dueAt - now) / DAY);
        const r = await queueTemplatedFor(ctx, { ...base, template: "dueSoon", dedupeKey: `dueSoon:${inv._id}`, varsFor: (lang) => vars(lang, days) });
        if (r === "queued") queued++;
      } else if (lateDays >= 1) {
        const step = rules.overdue.filter((s) => s <= lateDays).at(-1);
        if (step) {
          const r = await queueTemplatedFor(ctx, { ...base, template: "overdue", dedupeKey: `overdue${step}:${inv._id}`, varsFor: (lang) => vars(lang, lateDays) });
          if (r === "queued") queued++;
        }
      }
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.smsQueue.queueDueReminders, { cursor: page.continueCursor });
    return queued;
  },
});

/** queueTemplated needs the values in the renter's language (dates differ), so they are made once the language is known. */
async function queueTemplatedFor(ctx: MutationCtx, o: { renterId: Id<"renters">; template: TemplateKind; dedupeKey: string; invoiceId?: Id<"invoices">; agreementId?: Id<"agreements">; org: string; varsFor: (lang: Lang) => Record<string, string | number> }) {
  const renter = await ctx.db.get(o.renterId);
  const lang: Lang = renter?.smsLanguage ?? "en";
  return queueTemplated(ctx, { renterId: o.renterId, template: o.template, vars: o.varsFor(lang), dedupeKey: o.dedupeKey, invoiceId: o.invoiceId, agreementId: o.agreementId, renter, org: o.org });
}

export const queueExpiryWarnings = internalMutation({
  args: cursorArg,
  handler: async (ctx, { cursor }): Promise<number> => {
    const days = (await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "expiryWarnDays")).unique())?.value ?? 60;
    const org = await orgName(ctx);
    const now = Date.now();
    const horizon = now + days * DAY;
    let queued = 0;
    const page = await ctx.db.query("agreements").withIndex("by_status", (q) => q.eq("status", "active")).paginate({ numItems: PAGE, cursor: cursor ?? null });
    for (const ag of page.page) {
      if (ag.endsAt > horizon || ag.endsAt <= now) continue;
      const unit = (await ctx.db.get(ag.unitId))?.number ?? "";
      const left = Math.ceil((ag.endsAt - now) / DAY);
      const r = await queueTemplatedFor(ctx, { renterId: ag.renterId, template: "leaseEnding", agreementId: ag._id, org, dedupeKey: `expiry:${ag._id}:${ag.endsAt}`, varsFor: (lang) => ({ unit, end: smsDate(ag.endsAt - DAY, lang), days: left }) });
      if (r === "queued") queued++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.smsQueue.queueExpiryWarnings, { cursor: page.continueCursor });
    return queued;
  },
});

/** Expire agreements whose end date has passed and free the unit. */
export const expireAgreements = internalMutation({
  args: cursorArg,
  handler: async (ctx, { cursor }): Promise<number> => {
    let n = 0;
    const now = Date.now();
    const page = await ctx.db.query("agreements").withIndex("by_status", (q) => q.eq("status", "active")).paginate({ numItems: PAGE / 2, cursor: cursor ?? null });
    for (const ag of page.page) {
      if (ag.endsAt >= now) continue;
      await ctx.db.patch(ag._id, { status: "expired" });
      await refreshUnitStatus(ctx, ag.unitId);
      n++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.smsQueue.expireAgreements, { cursor: page.continueCursor });
    return n;
  },
});

/** Turn reserved units occupied once their lease starts. */
export const refreshUnits = internalMutation({
  args: cursorArg,
  handler: async (ctx, { cursor }): Promise<void> => {
    const page = await ctx.db.query("units").paginate({ numItems: PAGE, cursor: cursor ?? null });
    for (const u of page.page) await refreshUnitStatus(ctx, u._id);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.smsQueue.refreshUnits, { cursor: page.continueCursor });
  },
});

const SENT_STATES = ["sending", "accepted", "delivered", "uncertain"];

/**
 * Messages that may be handed to the gateway right now. Messages wait (and stay queued) during quiet hours, while a retry
 * back-off runs, and when the renter has already had their daily limit. A reminder whose bill has since been paid is
 * cancelled, and so is one for a renter who opted out after it was queued.
 */
export const claimQueued = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rules = await smsRules(ctx);
    const quiet = inQuietHours(now, rules.quietStart, rules.quietEnd);
    const rows = await ctx.db.query("smsMessages").withIndex("by_status", (q) => q.eq("status", "queued")).take(300);
    const out: { id: Id<"smsMessages">; to: string; body: string }[] = [];
    for (const m of rows) {
      if (out.length >= 50) break;
      if (m.sendAfter && m.sendAfter > now) continue;
      if (quiet && !m.urgent) continue;
      if (m.kind === "dueReminder" && m.invoiceId) {
        const inv = await ctx.db.get(m.invoiceId);
        if (!inv || (await invoiceBalance(ctx, inv)).due <= 0) { await ctx.db.patch(m._id, { status: "cancelled" }); continue; }
      }
      let to = m.to;
      if (m.renterId) {
        const renter = await ctx.db.get(m.renterId);
        if (!renter || (renter.smsOptOut && !m.urgent)) { await ctx.db.patch(m._id, { status: "cancelled", lastError: "opted_out" }); continue; }
        to = renter.phone;
        // the daily limit protects renters from too many automatic messages; announcements and tests are exempt
        if (!m.urgent && m.kind !== "custom" && rules.dailyCap > 0) {
          const mine = await ctx.db.query("smsMessages").withIndex("by_renter", (q) => q.eq("renterId", m.renterId!)).collect();
          if (mine.filter((x) => x._id !== m._id && x.kind !== "custom" && SENT_STATES.includes(x.status) && (x.sentAt ?? x._creationTime) > now - DAY).length >= rules.dailyCap) continue;
        }
      }
      if (!to || !isPhone(to)) { await ctx.db.patch(m._id, { status: "failed", lastError: "no_valid_phone" }); continue; }
      await ctx.db.patch(m._id, { status: "sending", attempts: (m.attempts ?? 0) + 1, sentAt: now }); // claimed: an overlapping run cannot send it again
      out.push({ id: m._id, to: normalizePhone(to), body: m.body });
    }
    return out;
  },
});

/** What the gateway said. A "slow down" reply is retried after a wait (up to three times); other refusals are final; no answer is left "uncertain" because it may have been delivered. */
export const finish = internalMutation({
  args: { id: v.id("smsMessages"), outcome: v.union(v.literal("accepted"), v.literal("rate_limited"), v.literal("rejected"), v.literal("unsure")), error: v.optional(v.string()) },
  handler: async (ctx, { id, outcome, error }) => {
    const m = await ctx.db.get(id);
    if (!m) return;
    if (outcome === "accepted") { await ctx.db.patch(id, { status: "accepted", lastError: undefined }); return; }
    if (outcome === "rate_limited" && (m.attempts ?? 1) < MAX_ATTEMPTS) { await ctx.db.patch(id, { status: "queued", sendAfter: Date.now() + BACKOFF_MS[(m.attempts ?? 1) - 1]!, lastError: error ?? "rate_limited" }); return; }
    await ctx.db.patch(id, { status: outcome === "unsure" ? "uncertain" : "failed", lastError: error ?? outcome });
  },
});

/** Gateway delivery receipt. Only messages already handed to the gateway can change, and a delivered message never goes back. */
export const deliveryReceipt = internalMutation({
  args: { id: v.id("smsMessages"), status: v.union(v.literal("delivered"), v.literal("failed")) },
  handler: async (ctx, { id, status }) => {
    const m = await ctx.db.get(id);
    if (!m || !["accepted", "uncertain", "sending"].includes(m.status)) return false;
    await ctx.db.patch(id, { status });
    return true;
  },
});

export const list = query({
  args: { renterId: v.optional(v.id("renters")) },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const rows = renterId ? await ctx.db.query("smsMessages").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect() : await ctx.db.query("smsMessages").order("desc").take(1500);
    const out = [];
    for (const m of rows) {
      let name = m.to ?? "";
      if (m.renterId) {
        try { await assertRenterVisible(ctx, u, m.renterId); } catch { continue; }
        name = (await ctx.db.get(m.renterId))?.name ?? "";
      } else if (u.buildingScope !== "all") continue; // a test to a typed number belongs to no building
      out.push({ ...m, renterName: name });
    }
    return out.sort((a, b) => b._creationTime - a._creationTime).slice(0, 200);
  },
});

export const retry = mutation({
  args: { id: v.id("smsMessages") },
  handler: async (ctx, { id }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const m = (await ctx.db.get(id)) ?? fail("not_found");
    if (m.renterId) await assertRenterVisible(ctx, u, m.renterId);
    if (m.status !== "failed" && m.status !== "uncertain") fail("not_retryable");
    await ctx.db.patch(id, { status: "queued", attempts: 0, sendAfter: undefined, lastError: undefined });
    await audit(ctx, u, "sms.retry", "smsMessages", id);
  },
});

/** Whether an SMS gateway is connected. Without one, messages are prepared and simply wait in the queue. */
export const gateway = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ...READ_ROLES);
    return { configured: !!process.env.SMS_API_URL && !!process.env.SMS_API_KEY, sender: process.env.SMS_SENDER ?? "DireMall" };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Rules and wording, editable by staff
// ---------------------------------------------------------------------------------------------------------------

export const rules = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ...READ_ROLES);
    const r = await smsRules(ctx);
    const raw = async (k: keyof typeof SMS_SETTING_KEYS) => (await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", SMS_SETTING_KEYS[k])).unique())?.value ?? SMS_DEFAULTS[k];
    return {
      before: r.before, overdue1: await raw("overdue1"), overdue2: await raw("overdue2"), overdue3: await raw("overdue3"),
      quietStart: r.quietStart, quietEnd: r.quietEnd, dailyCap: r.dailyCap, receipts: r.receipts, issued: r.issued,
    };
  },
});

const wholeNumber = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

export const saveRules = mutation({
  args: { before: v.number(), overdue1: v.number(), overdue2: v.number(), overdue3: v.number(), quietStart: v.number(), quietEnd: v.number(), dailyCap: v.number(), receipts: v.boolean(), issued: v.boolean() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "approver");
    if (!wholeNumber(a.before, 0, 30)) fail("invalid_days_before");
    for (const n of [a.overdue1, a.overdue2, a.overdue3]) if (!wholeNumber(n, 0, 365)) fail("invalid_overdue_days");
    const on = [a.overdue1, a.overdue2, a.overdue3].filter((n) => n > 0);
    if (new Set(on).size !== on.length) fail("overdue_days_must_differ");
    if (!wholeNumber(a.quietStart, 0, 23) || !wholeNumber(a.quietEnd, 0, 23)) fail("invalid_hours");
    if (!wholeNumber(a.dailyCap, 0, 10)) fail("invalid_daily_limit");
    const values: Record<string, number> = {
      [SMS_SETTING_KEYS.before]: a.before, [SMS_SETTING_KEYS.overdue1]: a.overdue1, [SMS_SETTING_KEYS.overdue2]: a.overdue2, [SMS_SETTING_KEYS.overdue3]: a.overdue3,
      [SMS_SETTING_KEYS.quietStart]: a.quietStart, [SMS_SETTING_KEYS.quietEnd]: a.quietEnd, [SMS_SETTING_KEYS.dailyCap]: a.dailyCap, [SMS_SETTING_KEYS.receipts]: a.receipts ? 1 : 0, [SMS_SETTING_KEYS.issued]: a.issued ? 1 : 0,
    };
    for (const [key, value] of Object.entries(values)) {
      const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (row) await ctx.db.patch(row._id, { value }); else await ctx.db.insert("settings", { key, value });
    }
    await audit(ctx, u, "sms.rules", "settings", "sms", JSON.stringify(a));
  },
});

/** Every automatic message in both languages: the text in use, the built-in original, and whether it is switched on. */
export const templates = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ...READ_ROLES);
    const out = [];
    for (const kind of TEMPLATE_KINDS) {
      const langs: Record<string, { body: string; enabled: boolean; edited: boolean; original: string }> = {};
      for (const lang of ["en", "am"] as const) { const t = await loadTemplate(ctx, kind, lang); langs[lang] = { ...t, original: DEFAULT_TEMPLATES[kind][lang] }; }
      out.push({ kind, placeholders: PLACEHOLDERS[kind], langs });
    }
    return { templates: out, org: await orgName(ctx), broadcastPlaceholders: BROADCAST_PLACEHOLDERS };
  },
});

export const saveTemplate = mutation({
  args: { kind: v.string(), lang: v.union(v.literal("en"), v.literal("am")), body: v.string(), enabled: v.boolean() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer", "approver");
    if (!(TEMPLATE_KINDS as readonly string[]).includes(a.kind)) fail("unknown_template");
    const check = checkTemplate(PLACEHOLDERS[a.kind as TemplateKind], a.body);
    if (!check.ok) fail(`template_${check.problems[0]!.code}`);
    const body = a.body.trim();
    const row = await ctx.db.query("smsTemplates").withIndex("by_kind_lang", (q) => q.eq("kind", a.kind).eq("lang", a.lang)).first();
    if (row) await ctx.db.patch(row._id, { body, enabled: a.enabled, updatedBy: u._id });
    else await ctx.db.insert("smsTemplates", { kind: a.kind, lang: a.lang, body, enabled: a.enabled, updatedBy: u._id });
    await audit(ctx, u, "sms.template", "smsTemplates", `${a.kind}:${a.lang}`, a.enabled ? "on" : "off");
  },
});

export const resetTemplate = mutation({
  args: { kind: v.string(), lang: v.union(v.literal("en"), v.literal("am")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer", "approver");
    const row = await ctx.db.query("smsTemplates").withIndex("by_kind_lang", (q) => q.eq("kind", a.kind).eq("lang", a.lang)).first();
    if (row) await ctx.db.delete(row._id);
    await audit(ctx, u, "sms.templateReset", "smsTemplates", `${a.kind}:${a.lang}`);
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Announcements and the gateway test
// ---------------------------------------------------------------------------------------------------------------

const audienceArg = v.object({ kind: v.union(v.literal("activeLeases"), v.literal("overdue"), v.literal("building"), v.literal("renters")), buildingId: v.optional(v.id("buildings")), renterIds: v.optional(v.array(v.id("renters"))) });
const MAX_RECIPIENTS = 500;

type Recipient = { renterId: Id<"renters">; name: string; unit: string; lang: Lang; state: "ok" | "opted_out" | "no_phone" };

async function audience(ctx: QueryCtx, u: Doc<"users">, a: typeof audienceArg.type): Promise<Recipient[]> {
  const units = new Map((await ctx.db.query("units").collect()).map((x) => [x._id, x]));
  const active = await ctx.db.query("agreements").withIndex("by_status", (q) => q.eq("status", "active")).collect();
  const unitOf = new Map<Id<"renters">, string>(); const buildingOf = new Map<Id<"renters">, Set<Id<"buildings">>>();
  for (const ag of active) {
    const un = units.get(ag.unitId);
    if (!un || !canSeeBuilding(u, un.buildingId)) continue;
    if (!unitOf.has(ag.renterId)) unitOf.set(ag.renterId, un.number);
    buildingOf.set(ag.renterId, new Set([...(buildingOf.get(ag.renterId) ?? []), un.buildingId]));
  }
  let ids: Id<"renters">[];
  if (a.kind === "activeLeases") ids = [...unitOf.keys()];
  else if (a.kind === "building") ids = [...unitOf.keys()].filter((id) => !!a.buildingId && buildingOf.get(id)?.has(a.buildingId));
  else if (a.kind === "overdue") {
    const open = await ctx.db.query("invoices").withIndex("by_status_due", (q) => q.eq("status", "issued").gt("due", 0)).take(5000);
    ids = [...new Set(open.filter((i) => i.dueAt < Date.now()).map((i) => i.renterId))].filter((id) => unitOf.has(id));
  } else ids = (a.renterIds ?? []).filter((id) => unitOf.has(id));
  const out: Recipient[] = [];
  for (const id of ids) {
    const r = await ctx.db.get(id);
    if (!r) continue;
    out.push({ renterId: id, name: r.name, unit: unitOf.get(id) ?? "", lang: r.smsLanguage ?? "en", state: r.smsOptOut ? "opted_out" : !r.phone || !isPhone(r.phone) ? "no_phone" : "ok" });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/** Who an announcement would reach, who would be left out and why, before anything is sent. */
export const audiencePreview = query({
  args: { audience: audienceArg },
  handler: async (ctx, { audience: a }) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer", "approver");
    if (a.kind === "building" && a.buildingId && !canSeeBuilding(u, a.buildingId)) fail("forbidden_building");
    const all = await audience(ctx, u, a);
    return {
      recipients: all.filter((r) => r.state === "ok").slice(0, 200), count: all.filter((r) => r.state === "ok").length,
      optedOut: all.filter((r) => r.state === "opted_out").length, noPhone: all.filter((r) => r.state === "no_phone").length,
      amharic: all.filter((r) => r.state === "ok" && r.lang === "am").length, tooMany: all.length > MAX_RECIPIENTS,
    };
  },
});

/**
 * Send one announcement (maintenance, a closure, a notice) to a group. The text may use {renter}, {unit} and {org}. Renters
 * whose language is Amharic get the Amharic text when one is written, otherwise the English one. Renters who opted out, or
 * have no valid phone, are left out and counted.
 */
export const sendBroadcast = mutation({
  args: { audience: audienceArg, body: v.string(), bodyAm: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer", "approver");
    if (a.audience.kind === "building" && a.audience.buildingId && !canSeeBuilding(u, a.audience.buildingId)) fail("forbidden_building");
    const en = checkTemplate(BROADCAST_PLACEHOLDERS, a.body);
    if (!en.ok) fail(`template_${en.problems[0]!.code}`);
    const amText = a.bodyAm && a.bodyAm.trim() ? a.bodyAm : undefined;
    if (amText) { const am = checkTemplate(BROADCAST_PLACEHOLDERS, amText); if (!am.ok) fail(`template_${am.problems[0]!.code}`); }
    const all = await audience(ctx, u, a.audience);
    if (all.length > MAX_RECIPIENTS) fail("too_many_recipients");
    const org = await orgName(ctx);
    const batch = `bc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    let queued = 0;
    for (const r of all) {
      if (r.state !== "ok") continue;
      const lang: Lang = r.lang === "am" && amText ? "am" : "en";
      const body = renderTemplate(lang === "am" ? amText! : a.body, { renter: r.name, unit: r.unit, org });
      await ctx.db.insert("smsMessages", { renterId: r.renterId, kind: "custom", template: "broadcast", lang, batch, body, status: "queued", dedupeKey: `${batch}:${r.renterId}`, segments: smsSegments(body).segments });
      queued++;
    }
    await audit(ctx, u, "sms.broadcast", "smsMessages", batch, `queued=${queued} optedOut=${all.filter((r) => r.state === "opted_out").length} noPhone=${all.filter((r) => r.state === "no_phone").length}`);
    return { batch, queued, optedOut: all.filter((r) => r.state === "opted_out").length, noPhone: all.filter((r) => r.state === "no_phone").length };
  },
});

/** Send a test message to a number typed in, now, to check the gateway works. Limited to a few per hour. */
export const sendTest = mutation({
  args: { phone: v.string(), lang: v.union(v.literal("en"), v.literal("am")) },
  handler: async (ctx, { phone, lang }) => {
    const u = await requireRole(ctx, "financeOfficer", "approver");
    if (!isPhone(phone)) fail("invalid_phone");
    const recent = (await ctx.db.query("smsMessages").order("desc").take(200)).filter((m) => m.template === "test" && m._creationTime > Date.now() - 60 * 60_000);
    if (recent.length >= 5) fail("too_many_tests");
    const org = await orgName(ctx);
    const body = lang === "am" ? `ከ${org} የሙከራ መልዕክት፦ የSMS መተላለፊያዎ በትክክል እየሰራ ነው።` : `Test message from ${org}: your SMS gateway is working.`;
    const to = normalizePhone(phone);
    await ctx.db.insert("smsMessages", { kind: "custom", template: "test", lang, to, body, status: "queued", urgent: true, segments: smsSegments(body).segments });
    await ctx.scheduler.runAfter(0, internal.smsSend.dispatch, {});
    await audit(ctx, u, "sms.test", "smsMessages", to);
    return { to };
  },
});
