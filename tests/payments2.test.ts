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

describe("possible duplicate payments", () => {
  it("warns when the same renter pays the same amount within two weeks, unless it is said to be different", async () => {
    const w = await withBills();
    const first = await record(w, 5000, { method: "cash", reference: "C-1", receivedAt: utc(2026, 10, 3) });
    const d = await w.fin.query(w.api.payments.possibleDuplicates, { renterId: w.renterId, amount: etb(5000), receivedAt: utc(2026, 10, 10) });
    expect(d).toEqual([expect.objectContaining({ paymentId: first, method: "cash", reference: "C-1", status: "recorded" })]);
    // the bank deposit of that same cash is exactly the case to catch
    await expect(w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(5000), method: "bankDeposit", reference: "B-9", receivedAt: utc(2026, 10, 10) })).rejects.toThrow(/possible_duplicate/);
    await w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(5000), method: "bankDeposit", reference: "B-9", receivedAt: utc(2026, 10, 10), notDuplicate: true });
  });

  it("stays quiet for a different amount, a different renter, an old payment, or a voided one", async () => {
    const w = await withBills();
    const first = await record(w, 5000, { receivedAt: utc(2026, 10, 3) });
    const q = (amount: number, receivedAt: number, renterId = w.renterId) => w.fin.query(w.api.payments.possibleDuplicates, { renterId, amount: etb(amount), receivedAt });
    expect(await q(5001, utc(2026, 10, 3))).toEqual([]);
    expect(await q(5000, utc(2026, 11, 1))).toEqual([]); // more than two weeks apart
    const other = await w.renter("Selam");
    expect(await q(5000, utc(2026, 10, 3), other)).toEqual([]);
    await w.ap.mutation(w.api.payments.voidPayment, { paymentId: first, reason: "Entered by mistake" });
    expect(await q(5000, utc(2026, 10, 3))).toEqual([]);
    await record(w, 5000, { receivedAt: utc(2026, 10, 3) }); // allowed again once the first is voided
  });
});
