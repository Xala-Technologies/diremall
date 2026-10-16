import { describe, expect, it } from "vitest";
import { etb, storePdf, utc, world } from "./helpers";

const DAY = 86_400_000;
/** A valid agreement row; override what a test wants to break. */
const ag = (row: number, o: Record<string, unknown> = {}) => ({ row, building: "", unit: "A-101", renter: "Abebe", startsAt: utc(2025, 9), endsAt: utc(2027, 9), basis: "perM2" as const, amount: etb(2300), dueDay: 5, deposit: etb(50000), ...o });
const op = (row: number, o: Record<string, unknown> = {}) => ({ row, building: "", unit: "", renter: "Abebe", amount: etb(100000), dueAt: utc(2026, 8, 5), note: "Rent Aug", ...o });

async function setup() {
  const w = await world();
  const a = await w.unit("A-101", 100), b = await w.unit("A-102", 50);
  await w.renter("Abebe"); await w.renter("Selam");
  return { ...w, a, b };
}

describe("importing agreements", () => {
  it("brings leases in as active or expired with their terms and deposit, and keeps units right", async () => {
    const w = await setup();
    const rows = [
      ag(2),
      ag(3, { unit: "A-102", renter: "Selam", startsAt: utc(2023, 1), endsAt: utc(2024, 12), basis: "fixed", amount: etb(40000), deposit: etb(80000), depositPaid: etb(60000), escPercent: 10, escMonths: 12, dueDay: 1 }),
    ];
    const check = await w.pm.query(w.api.imports.checkAgreements, { rows });
    expect(check.issues).toEqual([]);
    expect(check.summary).toMatchObject({ rows: 2, valid: 2, active: 1, expired: 1 });
    await expect(w.pm.mutation(w.api.imports.commitAgreements, { rows })).rejects.toThrow(/forbidden/); // only an approver commits
    expect(await w.ap.mutation(w.api.imports.commitAgreements, { rows })).toEqual({ agreements: 2, active: 1, expired: 1 });

    const list = await w.ap.query(w.api.agreements.list, {});
    const active = list.find((x) => x.unitNumber === "A-101")!, old = list.find((x) => x.unitNumber === "A-102")!;
    expect(active).toMatchObject({ status: "active", renterName: "Abebe" }); expect(active.importedAt).toBeGreaterThan(0);
    expect(old.status).toBe("expired");
    const d = await w.ap.query(w.api.agreements.get, { agreementId: old._id });
    expect(d.terms[0]).toMatchObject({ rent: { kind: "fixed", amount: etb(40000) }, dueDay: 1, depositAmount: etb(80000), escalation: { percent: 10, everyMonths: 12 } });
    expect(d.deposit).toMatchObject({ required: etb(80000), held: etb(60000) });
    expect((await w.ap.query(w.api.agreements.get, { agreementId: active._id })).deposit).toMatchObject({ required: etb(50000), held: etb(50000) }); // paid in full unless stated
    const units = await w.ap.query(w.api.properties.listUnits, {});
    expect(units.find((u) => u.number === "A-101")!.status).toBe("occupied");
    expect(units.find((u) => u.number === "A-102")!.status).toBe("vacant"); // the old lease has ended
    const log = await w.t.run((c) => c.db.query("auditLog").collect());
    expect(log.map((l) => l.action)).toContain("import.agreements");
  });

  it("an imported lease is billed like any other", async () => {
    const w = await setup();
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2)] });
    const r = await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    expect(r.created).toBe(1);
    const [bill] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    expect(bill!.total).toBe(etb(230000)); // 100 m² × 2,300
  });

  it("names every problem by row and refuses the whole file", async () => {
    const w = await setup();
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2)] });
    const other = await w.t.run((c) => c.db.insert("buildings", { name: "Annex" }));
    const fl = await w.t.run((c) => c.db.insert("floors", { buildingId: other, label: "G" }));
    await w.t.run((c) => c.db.insert("units", { buildingId: other, floorId: fl, number: "A-101", areaM2: 10, category: "retail", ratePerM2: 1, status: "vacant" }));
    await w.t.run((c) => c.db.insert("renters", { kind: "company", name: "Twin", phone: "+251911000001", tin: "9999999991" }));
    await w.t.run((c) => c.db.insert("renters", { kind: "company", name: "Twin", phone: "+251911000002", tin: "9999999992" }));
    const rows = [
      ag(2, { building: "Dire Mall" }), // the same lease again
      ag(3, { building: "Dire Mall", unit: "A-101", renter: "Selam", startsAt: utc(2026, 1), endsAt: utc(2026, 6) }), // overlaps Abebe's lease
      ag(4, { unit: "Z-9" }), ag(5, { building: "Dire Mall", renter: "Nobody" }), ag(6, { renter: "Twin", unit: "A-102" }),
      ag(7, { building: "Nowhere" }), ag(8, { unit: "A-102", renter: "Selam", endsAt: utc(2025, 1) }),
      ag(9, { unit: "A-102", renter: "Selam", dueDay: 31, amount: -5 }), ag(10, { unit: "A-102", renter: "Selam", escPercent: 150 }),
      ag(11, { unit: "A-102", renter: "Selam", startsAt: utc(2024, 1), endsAt: utc(2024, 12) }), ag(12, { unit: "A-102", renter: "Selam", startsAt: utc(2024, 6), endsAt: utc(2025, 6) }), // 12 overlaps 11
      ag(13, { unit: "A-101", renter: "Selam" }), // two A-101 units: name the building
    ];
    const { issues } = await w.pm.query(w.api.imports.checkAgreements, { rows });
    const by = (row: number) => issues.filter((i) => i.row === row).map((i) => i.code);
    expect(by(2)).toEqual(["already_exists"]);
    expect(by(3)).toEqual(["overlaps"]); expect(by(13)).toEqual(["unit_ambiguous"]);
    expect(by(4)).toEqual(["unit_not_found"]); expect(by(5)).toEqual(["renter_not_found"]); expect(by(6)).toEqual(["renter_ambiguous"]); expect(by(7)).toEqual(["building_not_found"]);
    expect(by(8)).toEqual(["end_before_start"]); expect(by(9).sort()).toEqual(["due_day", "invalid_amount"]); expect(by(10)).toEqual(["invalid_escalation"]);
    expect(by(11)).toEqual([]); expect(by(12)).toEqual(["overlaps"]);
    await expect(w.ap.mutation(w.api.imports.commitAgreements, { rows })).rejects.toThrow(/import_has_errors/);
    expect((await w.ap.query(w.api.agreements.list, {})).length).toBe(1); // nothing was added
    // naming the building resolves the ambiguity; a TIN identifies a renter exactly
    const ok = await w.pm.query(w.api.imports.checkAgreements, { rows: [ag(3, { building: "Annex", unit: "A-101", renter: "9999999991" })] });
    expect(ok.issues).toEqual([]);
  });

  it("a file cannot be imported twice, and building-limited staff only see their building", async () => {
    const w = await setup();
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2)] });
    expect((await w.pm.query(w.api.imports.checkAgreements, { rows: [ag(2)] })).issues).toEqual([{ row: 2, field: "unit", code: "already_exists" }]);
    const other = await w.t.run((c) => c.db.insert("buildings", { name: "Other" }));
    const lim = w.as(await w.mk("limpm", ["propertyManager"], [other]));
    expect((await lim.query(w.api.imports.checkAgreements, { rows: [ag(2, { startsAt: utc(2020, 1), endsAt: utc(2021, 1) })] })).issues[0]).toMatchObject({ code: "forbidden_building" });
  });

  it("allows the old signed contract to be attached once to an imported lease", async () => {
    const w = await setup();
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2)] });
    const [a] = await w.ap.query(w.api.agreements.list, {});
    const scan = await w.t.run((c) => storePdf(c as never));
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: a!._id, fileId: scan });
    const again = await w.t.run((c) => storePdf(c as never));
    await expect(w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: a!._id, fileId: again })).rejects.toThrow(/signed_copy_locked/);
    expect((await w.ap.query(w.api.agreements.get, { agreementId: a!._id })).agreement.status).toBe("active");
  });
});

describe("importing opening balances", () => {
  async function withLeases() {
    const w = await setup();
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2), ag(3, { unit: "A-102", renter: "Selam", basis: "fixed", amount: etb(20000) })] });
    return w;
  }

  it("turns amounts owed into issued bills with their original due dates, and prepayments into credit", async () => {
    const w = await withLeases();
    const rows = [op(2), op(3, { amount: etb(25000), dueAt: utc(2026, 9, 5), note: "Rent Sep" }), op(4, { renter: "Selam", amount: -etb(5000), note: "Paid ahead" })];
    const check = await w.fin.query(w.api.imports.checkOpening, { rows });
    expect(check.issues).toEqual([]);
    expect(check.summary).toMatchObject({ owed: etb(125000), credit: etb(5000) });
    await expect(w.fin.mutation(w.api.imports.commitOpening, { rows })).rejects.toThrow(/forbidden/);
    expect(await w.ap.mutation(w.api.imports.commitOpening, { rows })).toEqual({ bills: 2, credits: 1 });

    const open = await w.fin.query(w.api.payments.openBills, { renterId: (await w.t.run((c) => c.db.query("renters").collect())).find((r) => r.name === "Abebe")!._id });
    expect(open.map((b) => [b.period, b.due])).toEqual([["opening", etb(100000)], ["opening", etb(25000)]]);
    expect(open[0]!.number).toBe("OPEN-00001");
    // ageing uses the ORIGINAL due date, so arrears land in the right bucket from day one
    const aging = await w.fin.query(w.api.reports.aging, { asOf: utc(2026, 10, 15) });
    const abebe = aging.rows.find((r) => r.renterName === "Abebe")!;
    expect(abebe).toMatchObject({ d31_60: etb(25000), d61_90: etb(100000) }); // Sep rent 40 days late, Aug rent 71 days late
    const selam = (await w.t.run((c) => c.db.query("renters").collect())).find((r) => r.name === "Selam")!;
    expect(await w.fin.query(w.api.payments.credit, { renterId: selam._id })).toBe(etb(5000));
  });

  it("can be paid like any bill, and does not stop the real monthly bill being prepared", async () => {
    const w = await withLeases();
    await w.ap.mutation(w.api.imports.commitOpening, { rows: [op(2, { dueAt: utc(2026, 9, 5) })] });
    const renterId = (await w.t.run((c) => c.db.query("renters").collect())).find((r) => r.name === "Abebe")!._id;
    const p = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(100000), method: "bankDeposit", reference: "B1", receivedAt: utc(2026, 10, 1) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p });
    expect(await w.fin.mutation(w.api.payments.apply, { paymentId: p })).toEqual({ applied: etb(100000), credit: 0 });
    expect(await w.fin.query(w.api.payments.openBills, { renterId })).toEqual([]);
    const gen = await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    expect(gen.created).toBe(2); // September is still billed for both leases
    expect((await w.fin.query(w.api.billing.list, { period: "opening" })).map((b) => b.number)).toEqual(["OPEN-00001"]);
  });

  it("refuses what it cannot place, and a file run twice adds nothing", async () => {
    const w = await withLeases();
    await w.t.run((c) => c.db.insert("renters", { kind: "company", name: "NoLease", phone: "+251911000009", tin: "9999999999" }));
    const rows = [op(2, { renter: "Nobody" }), op(3, { renter: "NoLease" }), op(4, { amount: 0 }), op(5, { unit: "A-102" }), op(6, { unit: "A-101" }), op(7, { unit: "A-101" })];
    const { issues } = await w.fin.query(w.api.imports.checkOpening, { rows });
    const by = (row: number) => issues.filter((i) => i.row === row).map((i) => i.code);
    expect(by(2)).toEqual(["renter_not_found"]); expect(by(3)).toEqual(["no_agreement"]); expect(by(4)).toEqual(["invalid_amount"]);
    expect(by(5)).toEqual(["no_agreement_for_unit"]); expect(by(6)).toEqual([]); expect(by(7)).toEqual(["duplicate_in_file"]);
    const good = [op(2, { unit: "A-101" }), op(3, { renter: "Selam", amount: -etb(300), note: "Prepaid" })];
    await w.ap.mutation(w.api.imports.commitOpening, { rows: good });
    const again = await w.fin.query(w.api.imports.checkOpening, { rows: good });
    expect(again.issues.map((i) => i.code)).toEqual(["already_exists", "already_exists"]);
    await expect(w.ap.mutation(w.api.imports.commitOpening, { rows: good })).rejects.toThrow(/import_has_errors/);
    expect(await w.t.run((c) => c.db.query("invoices").collect())).toHaveLength(1);
  });

  it("asks which unit when a renter has several, and keeps to the user's buildings", async () => {
    const w = await setup();
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2), ag(3, { unit: "A-102", renter: "Abebe" })] });
    expect((await w.fin.query(w.api.imports.checkOpening, { rows: [op(2)] })).issues).toEqual([{ row: 2, field: "unit", code: "unit_needed" }]);
    expect((await w.fin.query(w.api.imports.checkOpening, { rows: [op(2, { unit: "A-102" })] })).issues).toEqual([]);
    const other = await w.t.run((c) => c.db.insert("buildings", { name: "Other" }));
    const lim = w.as(await w.mk("limfin", ["financeOfficer"], [other]));
    expect((await lim.query(w.api.imports.checkOpening, { rows: [op(2, { unit: "A-102" })] })).issues[0]).toMatchObject({ code: "forbidden_building" });
  });
});

describe("the go-live checklist", () => {
  it("counts what is already loaded and the opening bills", async () => {
    const w = await setup();
    expect(await w.pm.query(w.api.imports.status, {})).toMatchObject({ units: 2, buildings: 1, renters: 2, agreements: 0, openingBills: 0, openingTotal: 0 });
    await w.ap.mutation(w.api.imports.commitAgreements, { rows: [ag(2)] });
    await w.ap.mutation(w.api.imports.commitOpening, { rows: [op(2)] });
    expect(await w.pm.query(w.api.imports.status, {})).toMatchObject({ agreements: 1, activeAgreements: 1, openingBills: 1, openingTotal: etb(100000) });
  });
});
