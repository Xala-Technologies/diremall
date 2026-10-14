/** Small form checks. Each returns an error message key, or null when the value is fine. */
import { isEmail, isPhone, isTin, normalizePhone } from "../../convex/lib/validate";

type T = (key: string) => string;

export const req = (v: string | number | null | undefined, t: T) => (v == null || String(v).trim() === "" ? t("v.required") : null);
export const phone = (v: string, t: T) => (isPhone(v) ? null : t("v.phone"));
export const tin = (v: string, t: T) => (isTin(v) ? null : t("v.tin"));
export const email = (v: string, t: T) => (v.trim() === "" || isEmail(v) ? null : t("v.email"));
export const positive = (v: number | null, t: T) => (v == null || !(v > 0) ? t("v.positive") : null);
export const nonNegative = (v: number | null, t: T) => (v == null || v < 0 ? t("v.nonneg") : null);
export const inRange = (v: number, lo: number, hi: number, msg: string) => (Number.isFinite(v) && v >= lo && v <= hi ? null : msg);

export { normalizePhone };

/** Keep only the failures: { name: "…", phone: null } → { name: "…" } */
export function failures(checks: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(checks).filter(([, m]) => m)) as Record<string, string>;
}
