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

export async function smsRules(ctx: Ctx): Promise<SmsRules> {
  const g = (k: keyof typeof SMS_SETTING_KEYS) => getSetting(ctx, SMS_SETTING_KEYS[k], SMS_DEFAULTS[k]);
  return {
    before: await g("before"), overdue: [await g("overdue1"), await g("overdue2"), await g("overdue3")].filter((n) => n > 0).sort((a, b) => a - b),
    quietStart: await g("quietStart"), quietEnd: await g("quietEnd"), dailyCap: await g("dailyCap"), receipts: (await g("receipts")) === 1, issued: (await g("issued")) === 1,
  };
}

/** Ethiopia is UTC+3 all year. */
export const eatHour = (ms: number) => (new Date(ms).getUTCHours() + 3) % 24;
export function inQuietHours(ms: number, start: number, end: number): boolean {
  if (start === end) return false;
  const h = eatHour(ms);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** The text of a template in a language: the edited version if there is one, else the built-in one. */
export async function loadTemplate(ctx: Ctx, kind: TemplateKind, lang: Lang): Promise<{ body: string; enabled: boolean; edited: boolean }> {
  const row = await ctx.db.query("smsTemplates").withIndex("by_kind_lang", (q) => q.eq("kind", kind).eq("lang", lang)).first();
  return row ? { body: row.body, enabled: row.enabled, edited: true } : { body: DEFAULT_TEMPLATES[kind][lang], enabled: true, edited: false };
}

export async function orgName(ctx: Ctx): Promise<string> {
  return (await ctx.db.query("organization").first())?.name ?? "Dire Mall";
}

export type QueueResult = "queued" | "duplicate" | "disabled" | "opted_out" | "no_phone";

const KIND_OF: Record<TemplateKind, Doc<"smsMessages">["kind"]> = { billIssued: "billIssued", dueSoon: "dueReminder", overdue: "dueReminder", paymentReceived: "paymentAck", leaseEnding: "expiryWarning" };

/**
 * Make one automatic message from its template, in the renter's language, and put it in the queue. Nothing is queued for a
 * renter who opted out or has no valid phone number, for a template that has been switched off, or twice for the same
 * dedupe key (so a daily job can run again without sending again).
 */
export async function queueTemplated(
  ctx: MutationCtx,
  o: { renterId: Id<"renters">; template: TemplateKind; vars: Record<string, string | number | undefined>; dedupeKey: string; invoiceId?: Id<"invoices">; agreementId?: Id<"agreements">; renter?: Doc<"renters"> | null; org?: string },
): Promise<QueueResult> {
  if (await ctx.db.query("smsMessages").withIndex("by_dedupe", (q) => q.eq("dedupeKey", o.dedupeKey)).first()) return "duplicate";
  const renter = o.renter ?? (await ctx.db.get(o.renterId));
  if (!renter) return "no_phone";
  if (renter.smsOptOut) return "opted_out";
  if (!renter.phone || !isPhone(renter.phone)) return "no_phone";
  const lang: Lang = renter.smsLanguage ?? "en";
  const tpl = await loadTemplate(ctx, o.template, lang);
  if (!tpl.enabled) return "disabled";
  const org = o.org ?? (await orgName(ctx));
  const body = renderTemplate(tpl.body, { renter: renter.name, org, ...o.vars });
  await ctx.db.insert("smsMessages", {
    renterId: o.renterId, kind: KIND_OF[o.template], template: o.template, lang, body, status: "queued", dedupeKey: o.dedupeKey, segments: smsSegments(body).segments,
    ...(o.invoiceId ? { invoiceId: o.invoiceId } : {}), ...(o.agreementId ? { agreementId: o.agreementId } : {}),
  });
  return "queued";
}

export { PLACEHOLDERS };
