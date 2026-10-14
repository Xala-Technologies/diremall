import { type Santim, splitProportional } from "./money";

export type RentBasis =
  | { kind: "perM2"; areaM2: number; ratePerM2: Santim }
  | { kind: "fixed"; amount: Santim };

export function monthlyRent(basis: RentBasis): Santim {
  return basis.kind === "fixed" ? basis.amount : Math.round(basis.areaM2 * basis.ratePerM2);
}

/** Electricity/water: difference of two approved readings × tariff. */
export function utilityCharge(prev: number, curr: number, tariff: Santim): Santim {
  if (curr < prev) throw new Error("reading went backwards: needs meter-reset review");
  return Math.round((curr - prev) * tariff);
}

export type PaymentApplication = { applied: Santim; remainingDue: Santim; credit: Santim };

/** Apply a confirmed payment to a bill's outstanding balance. */
export function applyPayment(due: Santim, paid: Santim): PaymentApplication {
  if (due < 0 || paid < 0) throw new Error("amounts must be non-negative");
  const applied = Math.min(due, paid);
  return { applied, remainingDue: due - applied, credit: paid - applied };
}

export type SharedUnit = { unitId: string; areaM2: number; occupied: boolean };
export type SharedCostResult = { shares: Record<string, Santim>; ownerShare: Santim };

/**
 * Split a shared cost by floor area across ALL units (occupied or not).
 * Vacant units' shares are carried by the owner (default policy, configurable later).
 */
export function allocateSharedCost(total: Santim, units: SharedUnit[]): SharedCostResult {
  const parts = splitProportional(total, units.map((u) => u.areaM2));
  const shares: Record<string, Santim> = {};
  let owner = 0;
  units.forEach((u, i) => {
    if (u.occupied) shares[u.unitId] = parts[i]!;
    else owner += parts[i]!;
  });
  return { shares, ownerShare: owner };
}

export type AgingBuckets = { current: Santim; d1_30: Santim; d31_60: Santim; d61_90: Santim; d90plus: Santim };

export function ageArrears(items: { due: Santim; daysOverdue: number }[]): AgingBuckets {
  const b: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const { due, daysOverdue: d } of items) {
    if (due <= 0) continue;
    if (d <= 0) b.current += due;
    else if (d <= 30) b.d1_30 += due;
    else if (d <= 60) b.d31_60 += due;
    else if (d <= 90) b.d61_90 += due;
    else b.d90plus += due;
  }
  return b;
}

/** Two [start,end) date ranges (ms epoch) overlap? Used to block overlapping active agreements. */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

export type Escalation = { percent: number; everyMonths: number };

/** Whole months from `from` to `to` (UTC), never negative. */
export function monthsBetween(from: number, to: number): number {
  const a = new Date(from), b = new Date(to);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

/** Rent after yearly (or other interval) increases: monthly × (1 + percent)^steps, rounded to whole santim. */
export function escalatedRent(monthly: Santim, esc: Escalation | undefined, effectiveFrom: number, periodStart: number): { amount: Santim; steps: number } {
  if (!esc) return { amount: monthly, steps: 0 };
  const steps = Math.floor(monthsBetween(effectiveFrom, periodStart) / esc.everyMonths);
  return { amount: steps === 0 ? monthly : Math.round(monthly * Math.pow(1 + esc.percent / 100, steps)), steps };
}
