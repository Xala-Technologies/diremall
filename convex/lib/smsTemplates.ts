import { ETH_MONTHS_AM, gregorianToEthiopian } from "./ethiopianCalendar";
import { smsSegments } from "./smsText";

/**
 * The messages the system sends on its own. Each has an English and an Amharic text that staff can edit; the placeholders
 * in {braces} are filled in per renter and per bill when the message is made.
 */
export const TEMPLATE_KINDS = ["billIssued", "dueSoon", "overdue", "paymentReceived", "leaseEnding"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type Lang = "en" | "am";

export const PLACEHOLDERS: Record<TemplateKind, readonly string[]> = {
  billIssued: ["renter", "bill", "amount", "due", "unit", "org"],
  dueSoon: ["renter", "bill", "amount", "due", "days", "unit", "org"],
  overdue: ["renter", "bill", "amount", "due", "days", "unit", "org"],
  paymentReceived: ["renter", "amount", "receipt", "org"],
  leaseEnding: ["renter", "unit", "end", "days", "org"],
};
/** Free-text announcements may use these. */
export const BROADCAST_PLACEHOLDERS = ["renter", "unit", "org"] as const;

export const DEFAULT_TEMPLATES: Record<TemplateKind, Record<Lang, string>> = {
  billIssued: {
    en: "Dear {renter}, your bill {bill} of {amount} for unit {unit} is ready. Please pay by {due}. {org}",
    am: "ውድ {renter}፣ ለክፍል {unit} የ{amount} ደረሰኝ {bill} ተዘጋጅቷል። እባክዎ እስከ {due} ይክፈሉ። {org}",
  },
  dueSoon: {
    en: "Dear {renter}, bill {bill} of {amount} is due on {due} ({days} days). Please pay on time. {org}",
    am: "ውድ {renter}፣ የ{amount} ደረሰኝ {bill} የመክፈያ ጊዜው {due} ነው ({days} ቀን ቀርቷል)። እባክዎ በጊዜ ይክፈሉ። {org}",
  },
  overdue: {
    en: "Dear {renter}, bill {bill} of {amount} was due on {due} and is {days} days overdue. Please pay as soon as possible. {org}",
    am: "ውድ {renter}፣ የ{amount} ደረሰኝ {bill} የመክፈያ ጊዜው {due} ነበር፤ {days} ቀን አልፏል። እባክዎ በተቻለ ፍጥነት ይክፈሉ። {org}",
  },
  paymentReceived: {
    en: "Dear {renter}, we received your payment of {amount}. Receipt {receipt}. Thank you. {org}",
    am: "ውድ {renter}፣ የ{amount} ክፍያዎ ደርሶናል። የደረሰኝ ቁጥር {receipt}። እናመሰግናለን። {org}",
  },
  leaseEnding: {
    en: "Dear {renter}, your lease for unit {unit} ends on {end} ({days} days). Please contact the office to renew. {org}",
    am: "ውድ {renter}፣ የክፍል {unit} ውልዎ በ{end} ያበቃል ({days} ቀን ቀርቷል)። ለማደስ እባክዎ ቢሮውን ያነጋግሩ። {org}",
  },
};

export const MAX_TEMPLATE_CHARS = 480;

/** Fill the placeholders. A placeholder with no value becomes empty, and stray spaces left behind are tidied. */
export function renderTemplate(body: string, vars: Record<string, string | number | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")).replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?።፣])/g, "$1").trim();
}

/** Problems with a template text: unknown placeholders, too long, empty. */
export function checkTemplate(allowed: readonly string[], body: string): { ok: boolean; problems: { code: "empty" | "too_long" | "unknown_placeholder" | "stray_brace"; detail?: string }[] } {
  const problems: { code: "empty" | "too_long" | "unknown_placeholder" | "stray_brace"; detail?: string }[] = [];
  const text = body.trim();
  if (!text) problems.push({ code: "empty" });
  if ([...text].length > MAX_TEMPLATE_CHARS) problems.push({ code: "too_long" });
  const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  for (const u of new Set(used)) if (!allowed.includes(u)) problems.push({ code: "unknown_placeholder", detail: u });
  if (text.replace(/\{\w+\}/g, "").match(/[{}]/)) problems.push({ code: "stray_brace" });
  return { ok: problems.length === 0, problems };
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 5 Oct 2026 for English readers; 24 መስከረም 2019 (Ethiopian calendar) for Amharic readers. */
export function smsDate(ms: number, lang: Lang): string {
  const d = new Date(ms);
  if (lang === "am") { const e = gregorianToEthiopian(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); return `${e.day} ${ETH_MONTHS_AM[e.month - 1]} ${e.year}`; }
  return `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const smsMoney = (santim: number) => `ETB ${(santim / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What a preview uses so staff see a realistic message while editing. */
export function sampleVars(kind: TemplateKind | "custom", lang: Lang, org: string): Record<string, string> {
  const now = Date.now();
  return {
    renter: lang === "am" ? "አበበ ትሬዲንግ" : "Abebe Trading PLC", org, unit: "G-01", bill: "INV-2026-10-0001", amount: smsMoney(34500000), receipt: "RCT-2026-0001",
    due: smsDate(now + (kind === "overdue" ? -12 : 5) * 86_400_000, lang), days: kind === "overdue" ? "12" : kind === "leaseEnding" ? "45" : "5", end: smsDate(now + 45 * 86_400_000, lang),
  };
}

export const templateKey = (kind: TemplateKind, lang: Lang) => `${kind}:${lang}`;
export { smsSegments };
