import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getSetting } from "./access";
import { DEFAULT_TEMPLATES, PLACEHOLDERS, renderTemplate, smsSegments, type Lang, type TemplateKind } from "./smsTemplates";
import { isPhone } from "./validate";

type Ctx = QueryCtx | MutationCtx;

/** The rules for when and how often messages go out, all editable in Settings (hours are Ethiopian local time). */
export type SmsRules = { before: number; overdue: number[]; quietStart: number; quietEnd: number; dailyCap: number; receipts: boolean; issued: boolean };

export const SMS_DEFAULTS = { before: 3, overdue1: 1, overdue2: 7, overdue3: 30, quietStart: 20, quietEnd: 8, dailyCap: 2, receipts: 1, issued: 0 };
export const SMS_SETTING_KEYS = { before: "dueReminderDays", overdue1: "sms.overdue1", overdue2: "sms.overdue2", overdue3: "sms.overdue3", quietStart: "sms.quietStart", quietEnd: "sms.quietEnd", dailyCap: "sms.dailyCap", receipts: "sms.receipts", issued: "sms.issued" } as const;

export async function smsRules(ctx: Ctx, orgId: Id<"organizations">): Promise<SmsRules> {
  const g = (k: keyof typeof SMS_SETTING_KEYS) => getSetting(ctx, orgId, SMS_SETTING_KEYS[k], SMS_DEFAULTS[k]);
  return {
    before: await g("before"), overdue: [await g("overdue1"), await g("overdue2"), await g("overdue3")].filter((n) => n > 0).sort((a, b) => a - b),
    quietStart: await g("quietStart"), quietEnd: await g("quietEnd"), dailyCap: await g("dailyCap"), receipts: (await g("receipts")) === 1, issued: (await g("issued")) === 1,
  };
}

/** The hour of the day in the company's own timezone (hours ahead of UTC; Ethiopia is 3 all year). */
export const localHour = (ms: number, tzOffsetHours: number) => (((new Date(ms).getUTCHours() + tzOffsetHours) % 24) + 24) % 24;
export function inQuietHours(ms: number, start: number, end: number, tzOffsetHours = 3): boolean {
  if (start === end) return false;
  const h = localHour(ms, tzOffsetHours);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** The text of a template in a language: the edited version if there is one, else the built-in one. */
export async function loadTemplate(ctx: Ctx, orgId: Id<"organizations">, kind: TemplateKind, lang: Lang): Promise<{ body: string; enabled: boolean; edited: boolean }> {
  const row = await ctx.db.query("smsTemplates").withIndex("by_kind_lang", (q) => q.eq("orgId", orgId).eq("kind", kind).eq("lang", lang)).first();
  return row ? { body: row.body, enabled: row.enabled, edited: true } : { body: DEFAULT_TEMPLATES[kind][lang], enabled: true, edited: false };
}

/** The company's name as printed on messages and bills: its legal name if filled in, else its platform name. */
export async function orgName(ctx: Ctx, orgId: Id<"organizations">): Promise<string> {
  const profile = await ctx.db.query("organization").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  return profile?.name ?? (await ctx.db.get(orgId))?.name ?? "";
}

export type QueueResult = "queued" | "duplicate" | "disabled" | "opted_out" | "no_phone" | "limit";

/** Messages this company has made since the start of the (UTC) month, against its plan: 0 limit means unlimited. */
export async function smsQuota(ctx: Ctx, orgId: Id<"organizations">): Promise<{ used: number; limit: number }> {
  const org = await ctx.db.get(orgId);
  const d = new Date(); const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const rows = await ctx.db.query("smsMessages").withIndex("by_org", (q) => q.eq("orgId", orgId).gte("_creationTime", monthStart)).collect();
  return { used: rows.filter((m) => m.status !== "cancelled").length, limit: org?.limits.smsPerMonth ?? 0 };
}

const KIND_OF: Record<TemplateKind, Doc<"smsMessages">["kind"]> = { billIssued: "billIssued", dueSoon: "dueReminder", overdue: "dueReminder", paymentReceived: "paymentAck", leaseEnding: "expiryWarning" };

/**
 * Make one automatic message from its template, in the renter's language, and put it in the queue. Nothing is queued for a
 * renter who opted out or has no valid phone number, for a template that has been switched off, or twice for the same
 * dedupe key (so a daily job can run again without sending again).
 */
export async function queueTemplated(
  ctx: MutationCtx,
  o: { orgId: Id<"organizations">; renterId: Id<"renters">; template: TemplateKind; vars: Record<string, string | number | undefined>; dedupeKey: string; invoiceId?: Id<"invoices">; agreementId?: Id<"agreements">; renter?: Doc<"renters"> | null; org?: string },
): Promise<QueueResult> {
  if (await ctx.db.query("smsMessages").withIndex("by_dedupe", (q) => q.eq("orgId", o.orgId).eq("dedupeKey", o.dedupeKey)).first()) return "duplicate";
  const renter = o.renter ?? (await ctx.db.get(o.renterId));
  if (!renter || renter.orgId !== o.orgId) return "no_phone";
  if (renter.smsOptOut) return "opted_out";
  if (!renter.phone || !isPhone(renter.phone)) return "no_phone";
  const lang: Lang = renter.smsLanguage ?? "en";
  const tpl = await loadTemplate(ctx, o.orgId, o.template, lang);
  if (!tpl.enabled) return "disabled";
  { const q = await smsQuota(ctx, o.orgId); if (q.limit > 0 && q.used >= q.limit) return "limit"; }
  const org = o.org ?? (await orgName(ctx, o.orgId));
  const body = renderTemplate(tpl.body, { renter: renter.name, org, ...o.vars });
  await ctx.db.insert("smsMessages", {
    orgId: o.orgId, renterId: o.renterId, kind: KIND_OF[o.template], template: o.template, lang, body, status: "queued", dedupeKey: o.dedupeKey, segments: smsSegments(body).segments,
    ...(o.invoiceId ? { invoiceId: o.invoiceId } : {}), ...(o.agreementId ? { agreementId: o.agreementId } : {}),
  });
  return "queued";
}

export { PLACEHOLDERS };
