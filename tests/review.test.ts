import { describe, expect, it } from "vitest";
import { etb, utc, world } from "./helpers";

async function issuedInvoice(w: Awaited<ReturnType<typeof world>>, rent = 100000, area = 10) {
  const unitId = await w.unit("A-1", area);
  const renterId = await w.renter("Renter");
  const agreementId = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(rent) });
  await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
  const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
  await w.fin.mutation(w.api.billing.issue, { invoiceIds: [d!._id] });
  return { unitId, renterId, agreementId, invoiceId: d!._id };
}
const pay = async (w: Awaited<ReturnType<typeof world>>, renterId: any, amount: number, ref: string) => {
  const id = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(amount), method: "transfer", reference: ref, receivedAt: utc(2026, 9, 4) });
  await w.ap.mutation(w.api.payments.confirm, { paymentId: id });
  return id;
};

describe("review fixes: money", () => {
  it("a terminated lease is not billed after its termination date", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const renterId = await w.renter("R");
    const agreementId = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(1000) });
    await w.ap.mutation(w.api.agreements.terminate, { agreementId, reason: "left", effectiveAt: utc(2026, 9, 30) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-10" });
    expect(await w.fin.query(w.api.billing.list, { period: "2026-10" })).toHaveLength(0);
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    expect(await w.fin.query(w.api.billing.list, { period: "2026-09" })).toHaveLength(1);
  });

  it("repeating an invoice id in allocations cannot over-apply a payment", async () => {
    const w = await world();
    const { renterId, invoiceId } = await issuedInvoice(w, 100);
    const paymentId = await pay(w, renterId, 200, "P1");
    await expect(w.fin.mutation(w.api.payments.apply, { paymentId, allocations: [{ invoiceId, amount: etb(100) }, { invoiceId, amount: etb(100) }] })).rejects.toThrow(/allocation_exceeds_balance/);
    expect(await w.fin.mutation(w.api.payments.apply, { paymentId })).toEqual({ applied: etb(100), credit: etb(100) });
    expect((await w.fin.query(w.api.billing.list, { period: "2026-09" }))[0]!.due).toBe(0);
  });

  it("rejects fractional, NaN and negative money; same bank reference cannot be booked to two renters", async () => {
    const w = await world();
    const { renterId } = await issuedInvoice(w, 100);
    const other = await w.renter("Other");
    const rec = (amount: number, reference: string, r = renterId) => w.fin.mutation(w.api.payments.record, { renterId: r, amount, method: "transfer", reference, receivedAt: utc(2026, 9, 4) });
    await expect(rec(10.5, "a")).rejects.toThrow(/invalid_amount/);
    await expect(rec(NaN, "b")).rejects.toThrow();
    await expect(rec(-5, "c")).rejects.toThrow(/invalid_amount/);
    await rec(etb(5), "SAME");
    await expect(rec(etb(5), "SAME", other)).rejects.toThrow(/duplicate_payment_reference/);
  });

  it("manual bill lines cannot be negative discounts", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const renterId = await w.renter("R");
    await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(1000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await expect(w.fin.mutation(w.api.billing.addDraftLine, { invoiceId: d!._id, kind: "other", description: "discount", amount: -etb(500), calcNote: "" })).rejects.toThrow(/invalid_amount/);
  });

  it("two leases in one period do not both carry the month's electricity", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const r1 = await w.renter("First"); const r2 = await w.renter("Second");
    const f = () => w.t.run((c) => c.storage.store(new Blob(["s"])));
    const lease = async (renterId: any, from: number, to: number) => {
      const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: from, endsAt: to, rent: { kind: "fixed", amount: etb(3000) }, dueDay: 5, depositAmount: 0 });
      await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: await f() });
      await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id });
      await w.ap.mutation(w.api.agreements.approve, { agreementId: id });
      return id;
    };
    await lease(r1, utc(2026, 9), utc(2026, 9, 11));
    await lease(r2, utc(2026, 9, 11), utc(2027, 9));
    const meterId = await w.pm.mutation(w.api.utilities.addMeter, { unitId, kind: "electricity", serial: "M" });
    for (const [v, at] of [[100, utc(2026, 8, 31)], [200, utc(2026, 9, 30)]] as const) {
      const r = await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: v, readAt: at });
      await w.fin.mutation(w.api.utilities.approveReading, { readingId: r.id });
    }
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const invs = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    const withElec = [];
    for (const i of invs) if ((await w.fin.query(w.api.billing.get, { invoiceId: i._id })).lines.some((l) => l.kind === "electricity")) withElec.push(i);
    expect(withElec).toHaveLength(1);
  });

  it("deposit is refunded only after the tenancy ends, and never above what is held", async () => {
    const w = await world();
    const { agreementId } = await issuedInvoice(w);
    await w.fin.mutation(w.api.deposits.receive, { agreementId, amount: etb(50000) });
    await expect(w.fin.mutation(w.api.deposits.receive, { agreementId, amount: etb(1) })).rejects.toThrow(/exceeds_required_deposit/);
    await expect(w.ap.mutation(w.api.deposits.refund, { agreementId, amount: etb(100) })).rejects.toThrow(/agreement_still_active/);
    await w.ap.mutation(w.api.agreements.terminate, { agreementId, reason: "end" });
    await expect(w.ap.mutation(w.api.deposits.refund, { agreementId, amount: etb(60000) })).rejects.toThrow(/exceeds_deposit/);
    await w.ap.mutation(w.api.deposits.refund, { agreementId, amount: etb(50000) });
  });

  it("dashboard: billed = applied + outstanding; old unconfirmed payments still show as attention", async () => {
    const w = await world();
    const { renterId } = await issuedInvoice(w, 1000);
    const id = await pay(w, renterId, 400, "P");
    await w.fin.mutation(w.api.payments.apply, { paymentId: id });
    await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(10), method: "cash", reference: "old", receivedAt: utc(2026, 7, 1) });
    const d = await w.fin.query(w.api.reports.dashboard, { period: "2026-09" });
    expect(d.billed).toBe(d.appliedToBills + d.outstanding);
    expect(d.attention.paymentsToConfirm).toBe(1);
  });
});

describe("review fixes: access", () => {
  it("an access admin cannot grant themselves powers, touch a super admin, or lock out the last one", async () => {
    const w = await world();
    const admin = await w.mk("admin", ["accessAdmin"]); const boss = await w.mk("boss", ["superAdmin"]);
    const a = w.as(admin);
    await expect(a.mutation(w.api.users.setAccess, { userId: admin, roles: ["accessAdmin", "financeOfficer", "approver"], buildingScope: "all", active: true })).rejects.toThrow(/cannot_change_own_access/);
    await expect(a.mutation(w.api.users.setAccess, { userId: boss, roles: [], buildingScope: "all", active: true })).rejects.toThrow(/forbidden/);
    await expect(w.as(boss).mutation(w.api.users.setAccess, { userId: boss, roles: ["propertyManager"], buildingScope: "all", active: true })).rejects.toThrow(/last_super_admin/);
    const pmId = w.pmId;
    await a.mutation(w.api.users.setAccess, { userId: pmId, roles: ["propertyManager", "financeOfficer"], buildingScope: "all", active: true }); // normal job still works
  });

  it("a building-limited user cannot see another building's bills via a shared renter", async () => {
    const w = await world();
    const b2 = await w.pm.mutation(w.api.properties.createBuilding, { name: "Second" });
    const f2 = await w.pm.mutation(w.api.properties.addFloor, { buildingId: b2, label: "G" });
    const u2 = await w.pm.mutation(w.api.properties.createUnit, { buildingId: b2, floorId: f2, number: "S-1", areaM2: 10, category: "retail", ratePerM2: etb(100) });
    const u1 = await w.unit("A-1", 10); const renterId = await w.renter("Shared");
    await w.activeAgreement(u1, renterId, { kind: "fixed", amount: etb(1000) });
    await w.activeAgreement(u2, renterId, { kind: "fixed", amount: etb(5000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const all = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: all.map((i) => i._id) });

    const scopedId = await w.mk("scoped", ["financeOfficer", "propertyManager"], [w.buildingId]);
    const s = w.as(scopedId);
    const ledger = await s.query(w.api.reports.tenantLedger, { renterId });
    expect(ledger.map((l) => l.debit)).toEqual([etb(1000)]); // not the 5,000 from the other building
    const rec = await s.query(w.api.renters.get, { renterId });
    expect(rec.agreements).toHaveLength(1);
    // auto-apply cannot spill onto the other building's bill
    const p = await s.mutation(w.api.payments.record, { renterId, amount: etb(6000), method: "cash", reference: "X", receivedAt: utc(2026, 9, 4) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p });
    expect(await s.mutation(w.api.payments.apply, { paymentId: p })).toEqual({ applied: etb(1000), credit: etb(5000) });
    await expect(s.query(w.api.bank.unmatched, {})).rejects.toThrow(/forbidden_building/);
  });

  it("assorted state guards: signed copy locked after activation, termination keeps unit status right, meter reset needs review", async () => {
    const w = await world();
    const { agreementId, unitId } = await issuedInvoice(w);
    const f = await w.t.run((c) => c.storage.store(new Blob(["x"])));
    await expect(w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId, fileId: f })).rejects.toThrow(/signed_copy_locked/);
    expect((await w.pm.query(w.api.properties.getUnit, { unitId })).unit.status).toBe("occupied");
    await w.ap.mutation(w.api.agreements.terminate, { agreementId, reason: "x" });
    expect((await w.pm.query(w.api.properties.getUnit, { unitId })).unit.status).toBe("vacant");
    const meterId = await w.pm.mutation(w.api.utilities.addMeter, { unitId, kind: "water", serial: "W" });
    expect((await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: 5, readAt: utc(2026, 9, 1), isReset: true })).status).toBe("flagged");
  });
});
