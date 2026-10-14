/** "2026-09" → [start, end) in ms (UTC), plus number of days. */
export function periodRange(period: string): { start: number; end: number; days: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new Error("invalid period, expected YYYY-MM");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const start = Date.UTC(y, mo, 1);
  const end = Date.UTC(y, mo + 1, 1);
  return { start, end, days: Math.round((end - start) / 86_400_000) };
}

export const periodOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Fraction of the period [start,end) covered by [from,to), in whole days. */
export function coveredDays(period: string, from: number, to: number): number {
  const { start, end, days } = periodRange(period);
  const a = Math.max(start, from);
  const b = Math.min(end, to);
  if (b <= a) return 0;
  return Math.min(days, Math.round((b - a) / 86_400_000));
}
