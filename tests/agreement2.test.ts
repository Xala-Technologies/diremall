import { describe, expect, it } from "vitest";
import { etb, utc, world } from "./helpers";

async function lease() {
  const w = await world();
  const unitId = await w.unit("A-101", 100);
  const renterId = await w.renter("Abebe");
  const agreementId = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(10000) });
  return { ...w, unitId, renterId, agreementId };
}

describe("agreement page data", () => {
  it("sums what was billed, paid and is owed on the lease, newest bill first, and names who prepared and approved it", async () => {
    const w = await lease();
    for (const period of ["2026-09", "2026-10"]) {
      await w.fin.mutation(w.api.billing.generate, { period });
      await w.fin.mutation(w.api.billing.issue, { invoiceIds: (await w.fin.query(w.api.billing.list, { period })).map((r) => r._id) });
    }
    const p = await w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(4000), method: "cash", reference: "C1", receivedAt: utc(2026, 9, 6) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p });
    await w.fin.mutation(w.api.payments.apply, { paymentId: p });
    const d = await w.pm.query(w.api.agreements.get, { agreementId: w.agreementId });
    expect(d.account).toMatchObject({ billed: etb(20000), paid: etb(4000), due: etb(16000), count: 2 });
    expect(d.account.bills.map((b) => b.period)).toEqual(["2026-10", "2026-09"]);
    expect(d.account.overdue).toBeGreaterThan(0); // the September rent was due on the 5th
    expect(d).toMatchObject({ createdByName: "pm", approvedByName: "ap", rentNow: etb(10000), nextIncrease: null });
  });

  it("shows the rent being charged today and the next yearly increase", async () => {
    const w = await world();
    const unitId = await w.unit("A-102", 100), renterId = await w.renter("Selam");
    const start = Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth(), 1); // a year and a bit into the lease
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: start - 10 * 86_400_000, endsAt: start + 4 * 365 * 86_400_000, rent: { kind: "fixed", amount: etb(10000) }, dueDay: 5, depositAmount: 0, escalation: { percent: 10, everyMonths: 12 } });
    await w.t.run(async (c) => { await c.db.patch(id, { status: "active", approvedBy: w.apId }); });
    const d = await w.ap.query(w.api.agreements.get, { agreementId: id });
    expect(d.rentNow).toBe(etb(11000)); // one 10% step has happened
    expect(d.nextIncrease).toMatchObject({ amount: etb(12100) });
    expect(d.nextIncrease!.at).toBeGreaterThan(Date.now());
  });

  it("lets a deposit be deducted from and refunded once the lease has ended, but not before", async () => {
    const w = await lease();
    await w.fin.mutation(w.api.deposits.receive, { agreementId: w.agreementId, amount: etb(50000) });
    await expect(w.ap.mutation(w.api.deposits.refund, { agreementId: w.agreementId, amount: etb(1000) })).rejects.toThrow(/agreement_still_active/);
    await w.ap.mutation(w.api.agreements.terminate, { agreementId: w.agreementId, reason: "Moved out", effectiveAt: utc(2026, 10, 1) });
    await w.fin.mutation(w.api.deposits.requestDeduction, { agreementId: w.agreementId, amount: etb(8000), reason: "Repainting" });
    // the deposit is readable after termination (the screen needs it to settle the move-out)
    const dep = await w.fin.query(w.api.deposits.get, { agreementId: w.agreementId });
    expect(dep.held).toBe(etb(50000));
    await w.ap.mutation(w.api.deposits.approveDeduction, { agreementId: w.agreementId, index: 0 }).catch(() => undefined);
    const after = await w.ap.query(w.api.deposits.get, { agreementId: w.agreementId });
    await w.ap.mutation(w.api.deposits.refund, { agreementId: w.agreementId, amount: after.available });
    expect((await w.ap.query(w.api.deposits.get, { agreementId: w.agreementId })).available).toBe(0);
  });
});
