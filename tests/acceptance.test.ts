import { describe, expect, it } from "vitest";
import { etb, formatEtb, splitProportional } from "../convex/lib/money";
import { allocateSharedCost, ageArrears, applyPayment, monthlyRent, rangesOverlap, utilityCharge } from "../convex/lib/billing";
import { ethiopianToGregorian, gregorianToEthiopian, formatEthiopian } from "../convex/lib/ethiopianCalendar";

describe("proposal acceptance examples", () => {
  it("1. 150 m² × 2,300 ETB = 345,000 ETB/month", () => {
    expect(monthlyRent({ kind: "perM2", areaM2: 150, ratePerM2: etb(2300) })).toBe(etb(345000));
  });
  it("2. partial payment 200,000 on 345,000 leaves 145,000", () => {
    expect(applyPayment(etb(345000), etb(200000))).toEqual({ applied: etb(200000), remainingDue: etb(145000), credit: 0 });
  });
  it("3. overpayment 360,000 on 345,000 leaves 15,000 credit", () => {
    expect(applyPayment(etb(345000), etb(360000))).toEqual({ applied: etb(345000), remainingDue: 0, credit: etb(15000) });
  });
  it("4. 150 kWh × 6 ETB = 900 ETB", () => {
    expect(utilityCharge(1000, 1150, etb(6))).toBe(etb(900));
  });
  it("4b. backwards reading requires review", () => {
    expect(() => utilityCharge(1000, 900, etb(6))).toThrow();
  });
  it("5. shared 12,000 over 150/100/50 → 6,000/4,000/2,000; vacant share to owner", () => {
    const units = [
      { unitId: "a", areaM2: 150, occupied: true },
      { unitId: "b", areaM2: 100, occupied: true },
      { unitId: "c", areaM2: 50, occupied: false },
    ];
    const r = allocateSharedCost(etb(12000), units);
    expect(r.shares).toEqual({ a: etb(6000), b: etb(4000) });
    expect(r.ownerShare).toBe(etb(2000));
  });
  it("7. overlapping agreements detected", () => {
    expect(rangesOverlap([0, 10], [5, 15])).toBe(true);
    expect(rangesOverlap([0, 10], [10, 20])).toBe(false);
  });
});

describe("money invariants", () => {
  it("split always sums exactly", () => {
    const parts = splitProportional(etb(100), [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(etb(100));
  });
  it("formats ETB", () => expect(formatEtb(etb(345000))).toBe("ETB 345,000.00"));
  it("ages arrears into buckets", () => {
    const b = ageArrears([{ due: 100, daysOverdue: 0 }, { due: 200, daysOverdue: 15 }, { due: 300, daysOverdue: 45 }, { due: 400, daysOverdue: 75 }, { due: 500, daysOverdue: 120 }]);
    expect(b).toEqual({ current: 100, d1_30: 200, d31_60: 300, d61_90: 400, d90plus: 500 });
  });
});

describe("Ethiopian calendar", () => {
  it("Meskerem 6, 2019 E.C. = 16 Sep 2026 (as in the Sey proposal)", () => {
    expect(ethiopianToGregorian({ year: 2019, month: 1, day: 6 })).toEqual({ year: 2026, month: 9, day: 16 });
    expect(gregorianToEthiopian(2026, 9, 16)).toEqual({ year: 2019, month: 1, day: 6 });
  });
  it("Meskerem 1, 2018 = 11 Sep 2025", () => {
    expect(gregorianToEthiopian(2025, 9, 11)).toEqual({ year: 2018, month: 1, day: 1 });
  });
  it("round-trips across years", () => {
    for (let y = 2000; y < 2030; y++) for (const [m, d] of [[1, 1], [5, 30], [13, 5]] as const) {
      const g = ethiopianToGregorian({ year: y, month: m, day: d });
      expect(gregorianToEthiopian(g.year, g.month, g.day)).toEqual({ year: y, month: m, day: d });
    }
  });
  it("formats in Amharic", () => expect(formatEthiopian({ year: 2019, month: 1, day: 6 }, "am")).toBe("መስከረም 6, 2019"));
});
