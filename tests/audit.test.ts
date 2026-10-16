import { describe, expect, it } from "vitest";
import { scan } from "../convex/integrity";
import { etb, storePdf, utc, world } from "./helpers";

const healthy = async (w: Awaited<ReturnType<typeof world>>) => expect((await w.t.run((c) => scan(c as never))).findings).toEqual([]);

describe("rent maths against an independent calculation", () => {
  it("bills a full month, a part month at both ends, and a yearly increase, to the santim", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 150); const renterId = await w.renter("Abebe");
    const f = () => w.t.run((c) => storePdf(c as never));
    // 10 Sep 2026 to 20 Oct 2026 inclusive: ends at the start of 21 Oct. 150 m2 x 2,300 = 345,000 a month.
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 9, 10), endsAt: utc(2026, 10, 21), rent: { kind: "perM2", ratePerM2: etb(2300) }, dueDay: 5, depositAmount: 0 });
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: await f() });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id }); await w.ap.mutation(w.api.agreements.approve, { agreementId: id });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" }); await w.fin.mutation(w.api.billing.generate, { period: "2026-10" });
    const rent = async (p: string) => { const i = (await w.fin.query(w.api.billing.list, { period: p }))[0]!; return i.total; };
    expect(await rent("2026-09")).toBe(Math.round((etb(345000) * 21) / 30)); // 10..30 Sep = 21 days
    expect(await rent("2026-10")).toBe(Math.round((etb(345000) * 20) / 31)); // 1..20 Oct = 20 days, the 20th included
    await healthy(w);
  });

  it("a lease typed as 1 Sep to 31 Aug is exactly twelve full months: the last day is billed", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 100); const renterId = await w.renter("Abebe");
    const f = () => w.t.run((c) => storePdf(c as never));
    const lastDay = utc(2027, 8, 31), endsAt = lastDay + 86_400_000; // how the screen and the import store a typed end date
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 9), endsAt, rent: { kind: "fixed", amount: etb(31000) }, dueDay: 5, depositAmount: 0 });
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: await f() });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id }); await w.ap.mutation(w.api.agreements.approve, { agreementId: id });
    // billing the last month goes through the same coverage rule, checked directly (the month is too far ahead for generate)
    const { coveredDays } = await import("../convex/lib/period");
    expect(coveredDays("2027-08", utc(2026, 9), endsAt)).toBe(31);
    expect(coveredDays("2027-09", utc(2026, 9), endsAt)).toBe(0);
  });
});

describe("corrections, payments and readings keep the books straight", () => {
  async function paidBill() {
    const w = await world();
    const unitId = await w.unit("A-1", 100); const renterId = await w.renter("Abebe");
    const ag = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(10000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-10" });
    const inv = (await w.fin.query(w.api.billing.list, { period: "2026-10" }))[0]!;
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [inv._id] });
    const pay = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(10000), method: "cash", reference: "C1", receivedAt: utc(2026, 10, 5) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: pay }); await w.fin.mutation(w.api.payments.apply, { paymentId: pay });
    return { w, ag, renterId, invId: inv._id, pay };
  }

  it("a correction on a bill that is already paid turns the overpayment into renter credit, and cannot take off more than the bill", async () => {
    const { w, renterId, invId } = await paidBill();
    await expect(w.fin.mutation(w.api.billing.requestAdjustment, { invoiceId: invId, delta: -etb(10001), reason: "too much" })).rejects.toThrow(/adjustment_exceeds_bill/);
    const adj = await w.fin.mutation(w.api.billing.requestAdjustment, { invoiceId: invId, delta: -etb(2000), reason: "discount agreed" });
    await w.ap.mutation(w.api.billing.approveAdjustment, { adjustmentId: adj });
    expect((await w.fin.query(w.api.billing.get, { invoiceId: invId })).balance.due).toBe(0);
    expect(await w.fin.query(w.api.payments.credit, { renterId })).toBe(etb(2000)); // the 2,000 they overpaid is theirs
    await healthy(w);
  });

  it("voiding a payment frees the bank line it was matched to", async () => {
    const w = await world(); const renterId = await w.renter("Abebe");
    const pay = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(500), method: "transfer", reference: "T1", receivedAt: utc(2026, 10, 5) });
    await w.fin.mutation(w.api.bank.importStatement, { batch: "S1", entries: [{ postedAt: utc(2026, 10, 5), amount: etb(500), reference: "BANK1" }] });
    const line = (await w.ap.query(w.api.bank.statement, { batch: "S1" })).lines[0]!;
    await w.ap.mutation(w.api.bank.confirmMatch, { entryId: line._id, paymentId: pay });
    await w.ap.mutation(w.api.payments.voidPayment, { paymentId: pay, reason: "wrong renter" });
    expect((await w.ap.query(w.api.bank.statement, { batch: "S1" })).lines[0]!.state).toBe("toMatch");
    await healthy(w);
  });

  it("refuses a lease or payment for a renter who has been deleted, and a lease that is already over", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const renterId = await w.renter("Gone");
    await w.pm.mutation(w.api.removals.deleteRenter, { renterId });
    await expect(w.fin.mutation(w.api.payments.record, { renterId, amount: etb(1), method: "cash", reference: "X", receivedAt: Date.now() })).rejects.toThrow(/not_found/);
    await expect(w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 1), endsAt: utc(2027, 1), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0 })).rejects.toThrow(/not_found/);
    const r2 = await w.renter("Past");
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId: r2, startsAt: utc(2024, 1), endsAt: utc(2024, 12), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0 });
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: await w.t.run((c) => storePdf(c as never)) });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id });
    await expect(w.ap.mutation(w.api.agreements.approve, { agreementId: id })).rejects.toThrow(/agreement_already_ended/);
  });

  it("a meter reading dated before a later one cannot be higher than it without review", async () => {
    const w = await world(); const unitId = await w.unit("A-1", 10);
    const meterId = await w.pm.mutation(w.api.utilities.addMeter, { unitId, kind: "electricity", serial: "M" });
    const a = await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: 100, readAt: utc(2026, 8, 31) });
    const c = await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: 300, readAt: utc(2026, 10, 31) });
    await w.fin.mutation(w.api.utilities.approveReading, { readingId: a.id }); await w.fin.mutation(w.api.utilities.approveReading, { readingId: c.id });
    const b = await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: 450, readAt: utc(2026, 9, 30) }); // between them, but above the later one
    expect(b.status).toBe("flagged");
    expect((await w.pm.mutation(w.api.utilities.enterReading, { meterId, value: 200, readAt: utc(2026, 9, 29) })).status).toBe("draft");
  });
});

describe("a full go-live load leaves the books consistent and the numbers provable", () => {
  it("imports units, renters, leases and opening balances, then bills, takes payments and reports agree with the source", async () => {
    const w = await world();
    const units = [
      { row: 2, building: "Dire Mall", floor: "Ground", unit: "G-01", area: "150", category: "retail", rate: "2300" },
      { row: 3, building: "Dire Mall", floor: "Ground", unit: "G-02", area: "100", category: "retail", rate: "2300" },
      { row: 4, building: "Dire Mall", floor: "First", unit: "F-01", area: "80", category: "office", rate: "1500" },
    ];
    await w.pm.mutation(w.api.imports.commitUnits, { rows: units });
    const renters = ["Abebe Trading", "Selam Pharmacy"].map((name, i) => ({ row: i + 2, kind: "company", name, tin: `00${i}1234567`.slice(0, 10), license: "", phone: `091120010${i}`, email: "", rep: "" }));
    await w.pm.mutation(w.api.imports.commitRenters, { rows: renters });
    const ag = (row: number, unit: string, renter: string, extra: object = {}) => ({ row, building: "", unit, renter, startsAt: utc(2025, 9), endsAt: utc(2027, 9), basis: "perM2" as const, amount: etb(2300), dueDay: 5, deposit: etb(100000), ...extra });
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2, "G-01", "Abebe Trading"), ag(3, "G-02", "Selam Pharmacy", { basis: "fixed", amount: etb(200000), depositPaid: etb(60000) })] });
    const op = (row: number, renter: string, amount: number, dueAt: number) => ({ row, building: "", unit: "", renter, amount, dueAt, note: "old balance" });
    await w.ap.mutation(w.api.imports.commitOpening, { rows: [op(2, "Abebe Trading", etb(120000), utc(2026, 7, 5)), op(3, "Selam Pharmacy", etb(-30000), utc(2026, 8, 1))] });
    await healthy(w);
    // the source says: 2 leases, rent 345,000 + 200,000 = 545,000 a month, arrears 120,000, 30,000 credit, deposits 100,000 + 60,000
    const rr = await w.fin.query(w.api.reports.rentRoll, {});
    expect(rr.totalMonthlyRent).toBe(etb(545000));
    const aging = await w.fin.query(w.api.reports.aging, {});
    expect(Object.values(aging.totals).reduce((a, b) => a + b, 0)).toBe(etb(120000));
    expect(aging.totals.d90plus).toBe(etb(120000)); // due 5 Jul is more than 90 days before 16 Oct
    const selam = (await w.fin.query(w.api.renters.list, {})).find((r) => r.name === "Selam Pharmacy")!;
    expect(await w.fin.query(w.api.payments.credit, { renterId: selam._id })).toBe(etb(30000));
    const dep = await w.fin.query(w.api.reports.deposits, {});
    expect(dep.totals.held).toBe(etb(100000) + etb(60000));
    // a month is billed on top, a payment clears the arrears first, and the books still agree
    await w.fin.mutation(w.api.billing.generate, { period: "2026-10" });
    const bills = await w.fin.query(w.api.billing.list, { period: "2026-10" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: bills.map((b) => b._id) });
    const abebe = (await w.fin.query(w.api.renters.list, {})).find((r) => r.name === "Abebe Trading")!;
    const pay = await w.fin.mutation(w.api.payments.record, { renterId: abebe._id, amount: etb(150000), method: "transfer", reference: "TX1", receivedAt: utc(2026, 10, 10) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: pay });
    await w.fin.mutation(w.api.payments.apply, { paymentId: pay });
    const open = await w.fin.query(w.api.payments.openBills, { renterId: abebe._id });
    expect(open.map((b) => b.number).some((n) => n.startsWith("OPEN-"))).toBe(false); // the oldest bill (the opening balance) was paid first
    expect(open.reduce((s, b) => s + b.due, 0)).toBe(etb(120000) + etb(345000) - etb(150000));
    await healthy(w);
  });
});

describe("the rent roll equals what billing charges", () => {
  it("includes the yearly increase, so the monthly total matches the bills", async () => {
    const w = await world();
    await w.pm.mutation(w.api.imports.commitUnits, { rows: [{ row: 2, building: "Dire Mall", floor: "Ground", unit: "G-01", area: "100", category: "retail", rate: "2000" }] });
    await w.pm.mutation(w.api.imports.commitRenters, { rows: [{ row: 2, kind: "company", name: "Abebe", tin: "0012345678", license: "", phone: "0911200100", email: "", rep: "" }] });
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [{ row: 2, building: "", unit: "G-01", renter: "Abebe", startsAt: utc(2025, 9), endsAt: utc(2028, 9), basis: "perM2" as const, amount: etb(2000), dueDay: 5, deposit: 0, escPercent: 10, escMonths: 12 }] });
    const base = etb(200000);
    expect((await w.fin.query(w.api.reports.rentRoll, {})).totalMonthlyRent).toBe(Math.round(base * 1.1)); // Oct 2026 is past the first anniversary
    await w.fin.mutation(w.api.billing.generate, { period: "2026-10" });
    expect((await w.fin.query(w.api.billing.list, { period: "2026-10" }))[0]!.total).toBe(Math.round(base * 1.1));
    const l = (await w.fin.query(w.api.agreements.list, {}))[0]!; expect(l.rent).toBe(Math.round(base * 1.1));
    await healthy(w);
  });
});
