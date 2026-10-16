import { describe, expect, it } from "vitest";
import { etb, storePdf, utc, world } from "./helpers";

/**
 * Two buildings, each with a lease, a bill, a payment, a deposit, a meter and a shared cost. A member of staff who may only see
 * building A (with every working role) calls every screen's query: nothing that belongs to building B may come back, by id or by name.
 * Then the same person tries to change B's records by id: every attempt must be refused.
 */
async function setup() {
  const w = await world();
  const api = w.api;
  const build = async (name: string, buildingId: any, floorId: any, unitNo: string) => {
    const unitId = await w.pm.mutation(api.properties.createUnit, { buildingId, floorId, number: unitNo, areaM2: 100, category: "retail", ratePerM2: etb(2000) });
    const renterId = await w.renter(`Renter ${name}`);
    const agreementId = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(20000) });
    const meterId = await w.pm.mutation(api.utilities.addMeter, { unitId, kind: "electricity", serial: `M-${name}` });
    const rd = await w.pm.mutation(api.utilities.enterReading, { meterId, value: 10, readAt: utc(2026, 9, 30) });
    await w.fin.mutation(api.utilities.approveReading, { readingId: rd.id });
    const cost = await w.fin.mutation(api.utilities.createSharedCost, { buildingId, kind: "cleaning", period: "2026-09", total: etb(900) });
    await w.ap.mutation(api.utilities.approveSharedCost, { sharedCostId: cost.id });
    return { unitId, renterId, agreementId, meterId, readingId: rd.id, costId: cost.id };
  };
  const A = { buildingId: w.buildingId, ...(await build("Alpha", w.buildingId, w.floorId, "A-1")) };
  const bId = await w.pm.mutation(api.properties.createBuilding, { name: "Beta Tower" });
  const bFloor = await w.pm.mutation(api.properties.addFloor, { buildingId: bId, label: "Ground" });
  const B = { buildingId: bId, ...(await build("Beta", bId, bFloor, "B-1")) };
  await w.fin.mutation(api.billing.generate, { period: "2026-09" });
  const invs = await w.fin.query(api.billing.list, { period: "2026-09" });
  await w.fin.mutation(api.billing.issue, { invoiceIds: invs.map((i) => i._id) });
  const invB = invs.find((i) => i.renterId === B.renterId)!._id;
  const pay = await w.fin.mutation(api.payments.record, { renterId: B.renterId, amount: etb(500), method: "cash", reference: "B-PAY", receivedAt: utc(2026, 9, 20) });
  await w.ap.mutation(api.payments.confirm, { paymentId: pay });
  const pendingPay = await w.fin.mutation(api.payments.record, { renterId: B.renterId, amount: etb(700), method: "cash", reference: "B-PAY2", receivedAt: utc(2026, 9, 21) });
  const adj = await w.fin.mutation(api.billing.requestAdjustment, { invoiceId: invB, delta: etb(10), reason: "x" });
  await w.fin.mutation(api.deposits.receive, { agreementId: B.agreementId, amount: etb(1000), method: "cash", reference: "B-DEP" });
  // building A's only person: every role except administrator, scope = A only
  const sId = await w.mk("scoped", ["propertyManager", "financeOfficer", "approver", "auditor", "accessAdmin"], [A.buildingId]);
  return { w, A, B, invB, pay, pendingPay, adj, s: w.as(sId) };
}

describe("building access", () => {
  it("never returns another building's records or names from any query", async () => {
    const { w, A, B, invB, pay, s } = await setup();
    const api = w.api;
    const results: Record<string, unknown> = {
      buildings: await s.query(api.properties.listBuildings, {}), overview: await s.query(api.properties.buildingOverview, {}), units: await s.query(api.properties.listUnits, {}),
      renters: await s.query(api.renters.list, {}), agreements: await s.query(api.agreements.list, {}), expiring: await s.query(api.agreements.expiring, { withinDays: 900 }).catch(() => null),
      bills: await s.query(api.billing.list, {}), billsP: await s.query(api.billing.list, { period: "2026-09" }), adjustments: await s.query(api.billing.pendingAdjustments, {}),
      payments: await s.query(api.payments.list, {}), paymentsIn: await s.query(api.payments.inPeriod, { period: "2026-09" }), pSummary: await s.query(api.payments.summary, {}),
      dash: await s.query(api.reports.dashboard, { period: "2026-09" }), rentRoll: await s.query(api.reports.rentRoll, {}), vacancy: await s.query(api.reports.vacancy, {}), aging: await s.query(api.reports.aging, {}),
      revenue: await s.query(api.reports.revenue, { fromPeriod: "2026-01", toPeriod: "2026-12" }), expiry: await s.query(api.reports.leaseExpiry, { withinDays: 900 }), depositsRep: await s.query(api.reports.deposits, {}),
      pendingReadings: await s.query(api.utilities.pendingReadings, {}), register: await s.query(api.utilities.register, { period: "2026-09" }),
      sms: await s.query(api.smsQueue.list, {}).catch(() => null), audience: await s.query(api.smsQueue.audiencePreview, { audience: { kind: "activeLeases" } }),
    };
    const hidden = [B.buildingId, B.unitId, B.renterId, B.agreementId, B.meterId, B.readingId, B.costId, invB, pay, "Beta Tower", "Renter Beta", "B-1", "M-Beta"];
    for (const [name, data] of Object.entries(results)) {
      const text = JSON.stringify(data);
      for (const h of hidden) expect(text.includes(String(h)), `${name} leaked ${h}`).toBe(false);
    }
    // and building A is still there
    expect(JSON.stringify(results.units)).toContain(A.unitId);
    expect(JSON.stringify(results.agreements)).toContain(A.agreementId);
    // direct lookups by id
    await expect(s.query(api.properties.getUnit, { unitId: B.unitId })).rejects.toThrow();
    await expect(s.query(api.renters.get, { renterId: B.renterId })).rejects.toThrow();
    await expect(s.query(api.agreements.get, { agreementId: B.agreementId })).rejects.toThrow();
    await expect(s.query(api.billing.get, { invoiceId: invB })).rejects.toThrow();
    await expect(s.query(api.payments.get, { paymentId: pay })).rejects.toThrow();
    await expect(s.query(api.deposits.get, { agreementId: B.agreementId })).rejects.toThrow();
    await expect(s.query(api.payments.openBills, { renterId: B.renterId })).rejects.toThrow();
    await expect(s.query(api.payments.credit, { renterId: B.renterId })).rejects.toThrow();
    await expect(s.query(api.reports.tenantLedger, { renterId: B.renterId })).rejects.toThrow();
    await expect(s.query(api.utilities.meters, { unitId: B.unitId })).rejects.toThrow();
    await expect(s.query(api.utilities.readings, { meterId: B.meterId })).rejects.toThrow();
    await expect(s.query(api.utilities.sharedCosts, { buildingId: B.buildingId })).rejects.toThrow();
    await expect(s.query(api.properties.listFloors, { buildingId: B.buildingId })).rejects.toThrow();
    await expect(s.query(api.bank.batches, {})).rejects.toThrow(); // bank statements are mall-wide
  });

  it("refuses every attempt to change another building's records by id", async () => {
    const { w, B, invB, pay, pendingPay, adj, s } = await setup();
    const api = w.api; const fileId = await w.t.run((c) => storePdf(c as never));
    const attempts: [string, () => Promise<unknown>][] = [
      ["update unit", async () => s.mutation(api.properties.updateUnit, { unitId: B.unitId, number: "HACK", floorId: (await w.pm.query(api.properties.listFloors, { buildingId: B.buildingId }))[0]!._id, category: "retail", notes: "" })],
      ["unit availability", () => s.mutation(api.properties.setUnitAvailability, { unitId: B.unitId, status: "maintenance" })],
      ["add floor", () => s.mutation(api.properties.addFloor, { buildingId: B.buildingId, label: "Roof" })],
      ["edit building", () => s.mutation(api.properties.updateBuilding, { buildingId: B.buildingId, name: "Mine now" })],
      ["archive building", () => s.mutation(api.properties.setBuildingArchived, { buildingId: B.buildingId, archived: true })],
      ["delete building", () => s.mutation(api.removals.deleteBuilding, { buildingId: B.buildingId })],
      ["delete unit", () => s.mutation(api.removals.deleteUnit, { unitId: B.unitId })],
      ["new lease on its unit", () => s.mutation(api.agreements.createDraft, { unitId: B.unitId, renterId: B.renterId, startsAt: utc(2027, 1), endsAt: utc(2028, 1), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0 })],
      ["terminate lease", () => s.mutation(api.agreements.terminate, { agreementId: B.agreementId, reason: "x" })],
      ["renew lease", () => s.mutation(api.agreements.addTerm, { agreementId: B.agreementId, effectiveFrom: utc(2027, 1), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0 })],
      ["attach copy", () => s.mutation(api.agreements.attachSignedCopy, { agreementId: B.agreementId, fileId })],
      ["handover", () => s.mutation(api.agreements.recordHandover, { agreementId: B.agreementId, kind: "moveOut", keys: 1, condition: "x" })],
      ["issue bill", () => s.mutation(api.billing.issue, { invoiceIds: [invB] })],
      ["adjust bill", () => s.mutation(api.billing.requestAdjustment, { invoiceId: invB, delta: -1, reason: "x" })],
      ["approve adjustment", () => s.mutation(api.billing.approveAdjustment, { adjustmentId: adj })],
      ["remind", () => s.mutation(api.billing.sendReminders, { invoiceIds: [invB] })],
      ["record payment", () => s.mutation(api.payments.record, { renterId: B.renterId, amount: etb(1), method: "cash", reference: "HACK", receivedAt: utc(2026, 9, 1) })],
      ["confirm payment", () => s.mutation(api.payments.confirm, { paymentId: pendingPay })],
      ["void payment", () => s.mutation(api.payments.voidPayment, { paymentId: pendingPay, reason: "x" })],
      ["apply payment", () => s.mutation(api.payments.apply, { paymentId: pay })],
      ["use credit", () => s.mutation(api.payments.useCredit, { invoiceId: invB })],
      ["deposit receive", () => s.mutation(api.deposits.receive, { agreementId: B.agreementId, amount: 1, method: "cash", reference: "HACK" })],
      ["deposit deduct", () => s.mutation(api.deposits.requestDeduction, { agreementId: B.agreementId, amount: 1, reason: "x" })],
      ["deposit refund", () => s.mutation(api.deposits.refund, { agreementId: B.agreementId, amount: 1 })],
      ["add meter", () => s.mutation(api.utilities.addMeter, { unitId: B.unitId, kind: "water", serial: "HACK" })],
      ["enter reading", () => s.mutation(api.utilities.enterReading, { meterId: B.meterId, value: 99, readAt: utc(2026, 10, 1) })],
      ["shared cost", () => s.mutation(api.utilities.createSharedCost, { buildingId: B.buildingId, kind: "security", period: "2026-09", total: 1 })],
      ["renter edit", () => s.mutation(api.renters.update, { renterId: B.renterId, patch: { notes: "HACK" } })],
      ["renter document", () => s.mutation(api.renters.addDocument, { renterId: B.renterId, kind: "x", fileId })],
      ["renter delete", () => s.mutation(api.removals.deleteRenter, { renterId: B.renterId })],
      ["draft line", () => s.mutation(api.billing.addDraftLine, { invoiceId: invB, kind: "other", description: "x", amount: 1, calcNote: "x" })],
    ];
    for (const [name, fn] of attempts) {
      const ok = await fn().then(() => true, () => false);
      expect(ok, `"${name}" on another building was allowed`).toBe(false);
    }
    // nothing changed
    expect((await w.fin.query(api.billing.get, { invoiceId: invB })).invoice.status).toBe("issued");
    expect((await w.pm.query(api.properties.listBuildings, {})).some((b) => b.name === "Mine now")).toBe(false);
  });
});
