/** Small form checks. Each returns an error message key, or null when the value is fine. */
type T = (key: string) => string;

export const req = (v: string | number | null | undefined, t: T) => (v == null || String(v).trim() === "" ? t("v.required") : null);
export const phone = (v: string, t: T) => (/^(\+?251|0)?[1-9]\d{8}$/.test(v.replace(/[\s-]/g, "")) ? null : t("v.phone"));
export const tin = (v: string, t: T) => (/^\d{10}$/.test(v.replace(/\s/g, "")) ? null : t("v.tin"));
export const email = (v: string, t: T) => (v.trim() === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : t("v.email"));
export const positive = (v: number | null, t: T) => (v == null || !(v > 0) ? t("v.positive") : null);
export const nonNegative = (v: number | null, t: T) => (v == null || v < 0 ? t("v.nonneg") : null);
export const inRange = (v: number, lo: number, hi: number, msg: string) => (Number.isFinite(v) && v >= lo && v <= hi ? null : msg);

/** "0911 20 01 01" or "911200101" → "+251911200101" */
export function normalizePhone(v: string): string {
  const d = v.replace(/[\s-]/g, "").replace(/^\+/, "");
  if (d.startsWith("251")) return `+${d}`;
  if (d.startsWith("0")) return `+251${d.slice(1)}`;
  return `+251${d}`;
}

/** Keep only the failures: { name: "…", phone: null } → { name: "…" } */
export function failures(checks: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(Object.entries(checks).filter(([, m]) => m)) as Record<string, string>;
}
