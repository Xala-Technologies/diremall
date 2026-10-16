import { describe, expect, it } from "vitest";
import { etb, utc, world, storePdf } from "./helpers";

describe("rental cycle", () => {
  it("bills 150 m² × 2,300 = 345,000, is idempotent, and applies partial payment", async () => {
    const w = await world();
    const unitId = await w.unit("A-101", 150);
    const renterId = await w.renter("Abebe Trading");
    const agreementId = await w.activeAgreement(unitId, renterId);

    const gen = await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    expect(gen.created).toBe(1);
    expect((await w.fin.mutation(w.api.billing.generate, { period: "2026-09" })).created).toBe(0); // test 8

    const [draft] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    expect(draft!.total).toBe(etb(345000));
    expect(draft!.status).toBe("draft");
    const [number] = await w.fin.mutation(w.api.billing.issue, { invoiceIds: [draft!._id] });
    expect(number).toBe("INV-2026-09-0001");

    const paymentId = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(200000), method: "transfer", reference: "TRX1", receivedAt: utc(2026, 9, 4) });
    await expect(w.fin.mutation(w.api.payments.apply, { paymentId })).rejects.toThrow(/payment_not_confirmed/);
    await expect(w.fin.mutation(w.api.payments.confirm, { paymentId })).rejects.toThrow(/forbidden/);
    await w.ap.mutation(w.api.payments.confirm, { paymentId });
    const r = await w.fin.mutation(w.api.payments.apply, { paymentId });
    expect(r).toEqual({ applied: etb(200000), credit: 0 });

    const [inv] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    expect(inv!.due).toBe(etb(145000));
    expect(inv!.payStatus).toBe("partial");

    // deposit stays separate from rent
    await w.fin.mutation(w.api.deposits.receive, { agreementId, amount: etb(50000), method: "cash", reference: "DEP-" + Math.random().toString(36).slice(2) });
    expect((await w.fin.query(w.api.billing.list, { period: "2026-09" }))[0]!.due).toBe(etb(145000));
  });

  it("overpayment 360,000 on 345,000 keeps 15,000 credit", async () => {
    const w = await world();
    const unitId = await w.unit("A-101", 150);
    const renterId = await w.renter("Abebe Trading");
    await w.activeAgreement(unitId, renterId);
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [d!._id] });
    const paymentId = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(360000), method: "cash", reference: "C1", receivedAt: utc(2026, 9, 3) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId });
    expect(await w.fin.mutation(w.api.payments.apply, { paymentId })).toEqual({ applied: etb(345000), credit: etb(15000) });
    expect(await w.fin.query(w.api.payments.credit, { renterId })).toBe(etb(15000));
    const dash = await w.fin.query(w.api.reports.dashboard, { period: "2026-09" });
    expect(dash.outstanding).toBe(0);
  });

  it("issued bills are corrected only by an approved adjustment", async () => {
    const w = await world();
    const unitId = await w.unit("A-101", 150);
    const renterId = await w.renter("Abebe");
    await w.activeAgreement(unitId, renterId);
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [d!._id] });
    await expect(w.fin.mutation(w.api.billing.addDraftLine, { invoiceId: d!._id, kind: "other", description: "x", amount: 1, calcNote: "" })).rejects.toThrow(/invoice_already_issued/);
    const adjustmentId = await w.fin.mutation(w.api.billing.requestAdjustment, { invoiceId: d!._id, delta: -etb(5000), reason: "rent-free days" });
    expect((await w.fin.query(w.api.billing.list, { period: "2026-09" }))[0]!.due).toBe(etb(345000)); // not yet
    await w.ap.mutation(w.api.billing.approveAdjustment, { adjustmentId });
    const [after] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    expect(after!.total).toBe(etb(345000)); // original untouched
    expect(after!.due).toBe(etb(340000));
  });

  it("rent change from October leaves the September bill unchanged; part-month is prorated", async () => {
    const w = await world();
    const unitId = await w.unit("A-101", 100);
    const renterId = await w.renter("Abebe");
    const agreementId = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(300000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    await w.ap.mutation(w.api.agreements.addTerm, { agreementId, effectiveFrom: utc(2026, 10), rent: { kind: "fixed", amount: etb(330000) }, dueDay: 5, depositAmount: etb(50000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-10" });
    const sep = (await w.fin.query(w.api.billing.list, { period: "2026-09" }))[0]!;
    const oct = (await w.fin.query(w.api.billing.list, { period: "2026-10" }))[0]!;
    expect(sep.total).toBe(etb(300000));
    expect(oct.total).toBe(etb(330000));

    const u2 = await w.unit("B-201", 100);
    const r2 = await w.renter("Late Starter");
    const ag2 = await w.pm.mutation(w.api.agreements.createDraft, { unitId: u2, renterId: r2, startsAt: utc(2026, 9, 16), endsAt: utc(2027, 9), rent: { kind: "fixed", amount: etb(30000) }, dueDay: 5, depositAmount: 0 });
    const f = await w.t.run((c) => storePdf(c as never));
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: ag2, fileId: f });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: ag2 });
    await w.ap.mutation(w.api.agreements.approve, { agreementId: ag2 });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const late = (await w.fin.query(w.api.billing.list, { period: "2026-09" })).find((i) => i.unitNumber === "B-201")!;
    expect(late.total).toBe(etb(15000)); // 15 of 30 days
  });
});

describe("controls", () => {
  it("creator cannot approve own agreement; overlapping active agreements are rejected; signed copy required", async () => {
    const w = await w_();
    async function w_() { return world(); }
    const unitId = await w.unit("A-101", 100);
    const renterId = await w.renter("Abebe");
    const both = await w.mk("both", ["propertyManager", "approver"]);
    const b = w.as(both);
    const ag = await b.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 9), endsAt: utc(2027, 9), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0 });
    await b.mutation(w.api.agreements.submitForReview, { agreementId: ag });
    await expect(b.mutation(w.api.agreements.approve, { agreementId: ag })).rejects.toThrow(/same_person/);
    await expect(w.ap.mutation(w.api.agreements.approve, { agreementId: ag })).rejects.toThrow(/signed_copy_required/);

    await w.activeAgreement(unitId, renterId);
    const second = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2027, 1), endsAt: utc(2028, 1), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0 });
    const f = await w.t.run((c) => storePdf(c as never));
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: second, fileId: f });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: second });
    await expect(w.ap.mutation(w.api.agreements.approve, { agreementId: second })).rejects.toThrow(/overlapping_active_agreement/);
  });

  it("a building-scoped user cannot open another building's unit", async () => {
    const w = await world();
    const other = await w.pm.mutation(w.api.properties.createBuilding, { name: "Second" });
    const f2 = await w.pm.mutation(w.api.properties.addFloor, { buildingId: other, label: "G" });
    const secret = await w.pm.mutation(w.api.properties.createUnit, { buildingId: other, floorId: f2, number: "S-1", areaM2: 10, category: "office", ratePerM2: 1 });
    const scopedId = await w.mk("scoped", ["propertyManager", "financeOfficer"], [w.buildingId]);
    const scoped = w.as(scopedId);
    await expect(scoped.query(w.api.properties.getUnit, { unitId: secret })).rejects.toThrow(/forbidden_building/);
    expect((await scoped.query(w.api.properties.listUnits, {})).every((u) => u.buildingId === w.buildingId)).toBe(true);
    expect((await scoped.query(w.api.properties.listBuildings, {})).map((b) => b.name)).toEqual(["Dire Mall"]);
  });

  it("deactivated users are locked out; unauthenticated users cannot read", async () => {
    const w = await world();
    const admin = await w.mk("admin", ["accessAdmin"]);
    const victim = await w.mk("victim", ["propertyManager"]);
    await w.as(admin).mutation(w.api.users.setAccess, { userId: victim, roles: ["propertyManager"], buildingScope: "all", active: false });
    await expect(w.as(victim).query(w.api.properties.listBuildings, {})).rejects.toThrow(/inactive/);
    await expect(w.t.query(w.api.properties.listBuildings, {})).rejects.toThrow(/unauthenticated/);
    // access admin has no financial powers by default
    await expect(w.as(admin).mutation(w.api.billing.generate, { period: "2026-09" })).rejects.toThrow(/forbidden/);
  });
});

describe("utilities and shared costs", () => {
  it("adds approved electricity and shared generator lines to the bill; flags backwards readings", async () => {
    const w = await world();
    const a = await w.unit("A", 150), b = await w.unit("B", 100), c = await w.unit("C", 50); // C stays vacant
    const ra = await w.renter("RA"), rb = await w.renter("RB");
    await w.activeAgreement(a, ra, { kind: "fixed", amount: etb(1000) });
    await w.activeAgreement(b, rb, { kind: "fixed", amount: etb(1000) });

    const meterId = await w.pm.mutation(w.api.utilities.addMeter, { unitId: a, kind: "electricity", serial: "M1" });
    const read = async (value: number, at: number) => {
      const r = await w.pm.mutation(w.api.utilities.enterReading, { meterId, value, readAt: at });
      if (r.status === "draft") await w.fin.mutation(w.api.utilities.approveReading, { readingId: r.id });
      return r;
    };
    await read(1000, utc(2026, 8, 31));
    await read(1150, utc(2026, 9, 30));
    expect((await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: 900, readAt: utc(2026, 10, 15) })).status).toBe("flagged");

    const cost = await w.fin.mutation(w.api.utilities.createSharedCost, { buildingId: w.buildingId, kind: "generator", period: "2026-09", total: etb(12000) });
    expect(cost.ownerShare).toBe(etb(2000)); // vacant 50 m² share
    await w.ap.mutation(w.api.utilities.approveSharedCost, { sharedCostId: cost.id });

    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const inv = (await w.fin.query(w.api.billing.list, { period: "2026-09" })).find((i) => i.unitNumber === "A")!;
    const detail = await w.fin.query(w.api.billing.get, { invoiceId: inv._id });
    const byKind = Object.fromEntries(detail.lines.map((l) => [l.kind, l.amount]));
    expect(byKind.electricity).toBe(etb(900));
    expect(byKind.generator).toBe(etb(6000));
    expect(inv.total).toBe(etb(1000 + 900 + 6000));
  });
});

describe("bank matching and dashboard", () => {
  it("matching links evidence without adding to collections", async () => {
    const w = await world();
    const unitId = await w.unit("A-101", 150);
    const renterId = await w.renter("Abebe");
    await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(250000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [d!._id] });
    const paymentId = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(250000), method: "bankDeposit", reference: "CBE-778", receivedAt: utc(2026, 9, 4) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId });
    await w.fin.mutation(w.api.payments.apply, { paymentId });
    const before = await w.fin.query(w.api.reports.dashboard, { period: "2026-09" });

    await w.fin.mutation(w.api.bank.importStatement, { batch: "sep", entries: [{ postedAt: utc(2026, 9, 4), amount: etb(250000), reference: "CBE-778 ABEBE" }] });
    const { lines: [line] } = await w.fin.query(w.api.bank.statement, { batch: "sep" });
    const cands = await w.fin.query(w.api.bank.candidates, { entryId: line!._id });
    expect(cands[0]).toMatchObject({ paymentId, difference: 0, referenceMatches: true });
    await w.fin.mutation(w.api.bank.confirmMatch, { entryId: line!._id, paymentId });

    const after = await w.fin.query(w.api.reports.dashboard, { period: "2026-09" });
    expect(after.confirmedPayments).toBe(before.confirmedPayments);
    expect(after.appliedToBills).toBe(etb(250000));
    expect((await w.fin.query(w.api.bank.statement, {})).totals.toMatch.n).toBe(0);
  });

  it("dashboard reproduces the proposal's figures; ledger and aging agree", async () => {
    const w = await world();
    const mk = async (n: string, rent: number) => {
      const u = await w.unit(n, 10); const r = await w.renter("R-" + n);
      await w.activeAgreement(u, r, { kind: "fixed", amount: etb(rent) });
      return r;
    };
    const r1 = await mk("A-101", 345000); await mk("A-102", 300000); await mk("A-103", 365000);
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const all = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: all.map((i) => i._id) });
    const pay = async (renterId: any, amount: number, ref: string, apply: boolean) => {
      const id = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(amount), method: "transfer", reference: ref, receivedAt: utc(2026, 9, 10) });
      await w.ap.mutation(w.api.payments.confirm, { paymentId: id });
      if (apply) await w.fin.mutation(w.api.payments.apply, { paymentId: id });
    };
    await pay(r1, 200000, "p1", true);
    await pay(r1, 60000, "p2", false); // confirmed, waiting to be applied
    const d = await w.fin.query(w.api.reports.dashboard, { period: "2026-09" });
    expect(d.billed).toBe(etb(1010000));
    expect(d.confirmedPayments).toBe(etb(260000));
    expect(d.appliedToBills).toBe(etb(200000));
    expect(d.waitingToApply).toBe(etb(60000));
    expect(d.outstanding).toBe(etb(810000));

    const ledger = await w.fin.query(w.api.reports.tenantLedger, { renterId: r1 });
    expect(ledger.at(-1)!.balance).toBe(etb(145000));
    const aging = await w.fin.query(w.api.reports.aging, { asOf: utc(2026, 12, 1) });
    expect(aging.totals.d61_90).toBe(etb(810000)); // due 5 Sep, 87 days overdue on 1 Dec
    const roll = await w.fin.query(w.api.reports.rentRoll, {});
    expect(roll.totalMonthlyRent).toBe(etb(1010000));
  });
});
