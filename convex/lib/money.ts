// Money is always integer santim (1 ETB = 100 santim). Never floats.
export type Santim = number;

export const etb = (birr: number): Santim => Math.round(birr * 100);

export function formatEtb(s: Santim): string {
  const neg = s < 0;
  const abs = Math.abs(s);
  const birr = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}ETB ${birr}.${cents}`;
}

/** Split `total` across `weights` so parts sum exactly to total (largest remainder). */
export function splitProportional(total: Santim, weights: number[]): Santim[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("weights must sum to > 0");
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i]! += 1;
    left--;
  }
  return parts;
}
