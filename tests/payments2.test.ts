import { describe, expect, it } from "vitest";
import { etb, utc, world } from "./helpers";

/** Two issued bills (Sep and Oct, 10,000 each) for one renter. */
async function withBills() {
  const w = await world();
  const unitId = await w.unit("A-101", 100);
  const renterId = await w.renter("Abebe");
  await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(10000) });
  for (const period of ["2026-09", "2026-10"]) {
    await w.fin.mutation(w.api.billing.generate, { period });
    const rows = await w.fin.query(w.api.billing.list, { period });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: rows.map((r) => r._id) });
  }
  return { ...w, renterId, unitId };
}
const record = (w: Awaited<ReturnType<typeof withBills>>, amount: number, extra: object = {}) =>
  w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(amount), method: "transfer", reference: `R-${Math.random()}`, receivedAt: utc(2026, 10, 3), ...extra });

describe("payment details and trail", () => {
  it("keeps who paid, notes, and who did each step and when", async () => {
    const w = await withBills();
    const id = await record(w, 12000, { payerName: " Almaz (accountant) ", notes: "  paid at the branch  " });
    let g = await w.fin.query(w.api.payments.get, { paymentId: id });
    expect(g.payment).toMatchObject({ payerName: "Almaz (accountant)", notes: "paid at the branch", status: "recorded" });
    expect(g.timeline).toMatchObject({ recordedByName: "fin" });
    expect(g.timeline.confirmedByName).toBeUndefined();
    await w.ap.mutation(w.api.payments.confirm, { paymentId: id });
    await w.fin.mutation(w.api.payments.apply, { paymentId: id });
    g = await w.fin.query(w.api.payments.get, { paymentId: id });
    expect(g.timeline).toMatchObject({ recordedByName: "fin", confirmedByName: "ap", appliedByName: "fin" });
    expect(g.timeline.confirmedAt).toBeGreaterThan(0); expect(g.timeline.appliedAt).toBeGreaterThanOrEqual(g.timeline.confirmedAt!);
    expect(g.payment.receiptNumber).toMatch(/^RCT-2026-/);

    const v = await record(w, 500);
    await w.ap.mutation(w.api.payments.voidPayment, { paymentId: v, reason: "Entered twice" });
    const gv = await w.fin.query(w.api.payments.get, { paymentId: v });
    expect(gv.timeline).toMatchObject({ voidedByName: "ap", voidReason: "Entered twice" });
  });

  it("lists the renter's open bills oldest first, and applies a payment to the bills that were chosen", async () => {
    const w = await withBills();
    const open = await w.fin.query(w.api.payments.openBills, { renterId: w.renterId });
    expect(open.map((b) => [b.period, b.due])).toEqual([["2026-09", etb(10000)], ["2026-10", etb(10000)]]);
    const id = await record(w, 12000);
    await w.ap.mutation(w.api.payments.confirm, { paymentId: id });
    // pay October in full and part of September, leaving 2,000 as credit-free remainder
    const [sep, oct] = open;
    const res = await w.fin.mutation(w.api.payments.apply, { paymentId: id, allocations: [{ invoiceId: oct!.invoiceId, amount: etb(10000) }, { invoiceId: sep!.invoiceId, amount: etb(1000) }] });
    expect(res).toEqual({ applied: etb(11000), credit: etb(1000) });
    const after = await w.fin.query(w.api.payments.openBills, { renterId: w.renterId });
    expect(after.map((b) => [b.period, b.due])).toEqual([["2026-09", etb(9000)]]);
    expect(await w.fin.query(w.api.payments.credit, { renterId: w.renterId })).toBe(etb(1000));
  });

  it("summarises payments by status for a date range, only counting what the user may see", async () => {
    const w = await withBills();
    const a = await record(w, 1000), b = await record(w, 2000), c = await record(w, 4000, { receivedAt: utc(2026, 8, 1) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: b });
    void a; void c;
    const all = await w.fin.query(w.api.payments.summary, {});
    expect(all).toMatchObject({ recorded: { n: 2, amount: etb(5000) }, confirmed: { n: 1, amount: etb(2000) }, applied: { n: 0 }, voided: { n: 0 } });
    const oct = await w.fin.query(w.api.payments.summary, { from: utc(2026, 10), to: utc(2026, 11) });
    expect(oct).toMatchObject({ recorded: { n: 1, amount: etb(1000) }, confirmed: { n: 1 } });
    const other = await w.t.run((ctx) => ctx.db.insert("buildings", { name: "Other" }));
    const lim = w.as(await w.mk("lim", ["financeOfficer"], [other]));
    expect(await lim.query(w.api.payments.summary, {})).toMatchObject({ recorded: { n: 0 }, confirmed: { n: 0 } });
    await expect(lim.query(w.api.payments.openBills, { renterId: w.renterId })).rejects.toThrow(/forbidden/);
  });
});
