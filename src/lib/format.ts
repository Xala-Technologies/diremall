import { formatEtb } from "../../convex/lib/money";
import { ETH_MONTHS_AM, ETH_MONTHS_EN, gregorianToEthiopian } from "../../convex/lib/ethiopianCalendar";
import type { Calendar, Lang } from "./i18n";

export { formatEtb };

/** ETB text → santim. "12,500.50" → 1250050. Returns null when not a valid amount. */
export function parseEtb(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export function formatDate(ms: number | null | undefined, calendar: Calendar, lang: Lang): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  if (calendar === "ethiopian") {
    const e = gregorianToEthiopian(y, m, day);
    return `${(lang === "am" ? ETH_MONTHS_AM : ETH_MONTHS_EN)[e.month - 1]} ${e.day}, ${e.year}`;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatPeriod(period: string, calendar: Calendar, lang: Lang): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  if (calendar === "ethiopian") {
    // a billing period is a Gregorian month; show the Ethiopian month that contains its 15th
    const e = gregorianToEthiopian(y, m, 15);
    return `${(lang === "am" ? ETH_MONTHS_AM : ETH_MONTHS_EN)[e.month - 1]} ${e.year}`;
  }
  return period;
}

export const currentPeriod = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "2026-09" shifted by n months. */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A bill period for people: "2026-09" as is, the carried-in balances as "Opening balance". */
export const periodText = (p: string, t: (k: string) => string) => (p === "opening" ? t("bill.opening") : p);
