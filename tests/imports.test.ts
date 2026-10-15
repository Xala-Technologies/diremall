import { describe, expect, it } from "vitest";
import { world } from "./helpers";

const u = (row: number, o: Partial<{ building: string; floor: string; unit: string; area: string; category: string; rate: string }> = {}) =>
  ({ row, building: "Dire Mall", floor: "Ground", unit: `X-${row}`, area: "50", category: "retail", rate: "2,300", ...o });
const r = (row: number, o: Partial<{ kind: string; name: string; tin: string; license: string; phone: string; email: string; rep: string; idNumber: string; address: string; contactPerson: string; contactPhone: string; vat: string; notes: string }> = {}) =>
  ({ row, kind: "company", name: `Firm ${row}`, tin: String(1000000000 + row), license: "", phone: `09112000${String(row).padStart(2, "0")}`, email: "", rep: "", ...o });

describe("unit import", () => {
  it("reports every problem with its row, and saves nothing until all rows are valid", async () => {
    const w = await world();
    const rows = [u(2), u(3, { area: "0" }), u(4, { category: "shop" }), u(5, { unit: "" }), u(6, { rate: "abc" }), u(7, { unit: "X-2" })];
    const r1 = await w.pm.query(w.api.imports.checkUnits, { rows });
    expect(r1.issues).toEqual(expect.arrayContaining([
      { row: 3, field: "area", code: "positive_number" }, { row: 4, field: "category", code: "category" },
      { row: 5, field: "unit", code: "required" }, { row: 6, field: "rate", code: "number" }, { row: 7, field: "unit", code: "duplicate_in_file" },
    ]));
    expect(r1.summary.valid).toBe(1);
    await expect(w.pm.mutation(w.api.imports.commitUnits, { rows })).rejects.toThrow(/import_has_errors/);
    expect(await w.pm.query(w.api.properties.listUnits, {})).toHaveLength(0);
  });

  it("creates missing buildings and floors, converts ETB to santim, and refuses a second import of the same units", async () => {
    const w = await world();
    const rows = [u(2, { building: "New Annex", floor: "1st", unit: "A-1", rate: "1,800.50" }), u(3, { building: "New Annex", floor: "1st", unit: "A-2" }), u(4, { floor: "Mezzanine" })];
    const check = await w.pm.query(w.api.imports.checkUnits, { rows });
    expect(check.summary).toMatchObject({ rows: 3, valid: 3, newBuildings: 1, newFloors: 2 });
    expect(await w.pm.mutation(w.api.imports.commitUnits, { rows })).toEqual({ units: 3, buildings: 1, floors: 2 });
    const units = await w.pm.query(w.api.properties.listUnits, {});
    expect(units.find((x) => x.number === "A-1")!.ratePerM2).toBe(180050);
    expect((await w.pm.query(w.api.imports.checkUnits, { rows })).issues.every((i) => i.code === "already_exists")).toBe(true);
    await expect(w.pm.mutation(w.api.imports.commitUnits, { rows })).rejects.toThrow(/import_has_errors/);
  });

  it("needs the property role, and a building-limited user cannot create buildings", async () => {
    const w = await world();
    await expect(w.fin.query(w.api.imports.checkUnits, { rows: [u(2)] })).rejects.toThrow(/forbidden/);
    const scoped = w.as(await w.mk("scoped", ["propertyManager"], [w.buildingId]));
    const res = await scoped.query(w.api.imports.checkUnits, { rows: [u(2, { building: "Brand New" })] });
    expect(res.issues).toEqual([{ row: 2, field: "building", code: "forbidden_building" }]);
  });
});

describe("renter import", () => {
  it("validates phone, TIN, email and type, and normalises phone numbers", async () => {
    const w = await world();
    const rows = [r(2), r(3, { phone: "12" }), r(4, { tin: "123" }), r(5, { tin: "" }), r(6, { kind: "shop" }), r(7, { email: "nope" }), r(8, { kind: "individual", tin: "", phone: "0911 20 01 01", idNumber: "ET-12345", address: " Kezira ", contactPhone: "0922 33 44 55", vat: "123 456 789" }), r(9, { kind: "individual", tin: "" }), r(10, { vat: "12" }), r(11, { contactPhone: "7" })];
    const res = await w.pm.query(w.api.imports.checkRenters, { rows });
    expect(res.issues).toEqual(expect.arrayContaining([
      { row: 3, field: "phone", code: "phone" }, { row: 4, field: "tin", code: "tin" }, { row: 5, field: "tin", code: "required" }, { row: 6, field: "kind", code: "kind" }, { row: 7, field: "email", code: "email" },
      { row: 9, field: "idNumber", code: "id_or_tin" }, { row: 10, field: "vat", code: "vat" }, { row: 11, field: "contactPhone", code: "phone" },
    ]));
    expect(res.summary.valid).toBe(2);
    expect(await w.pm.mutation(w.api.imports.commitRenters, { rows: [r(2), r(8, { kind: "individual", tin: "", phone: "0911 20 01 01", idNumber: "ET-12345", address: " Kezira ", contactPhone: "0922 33 44 55", vat: "123 456 789" })] })).toEqual({ renters: 2 });
    const list = await w.pm.query(w.api.renters.list, {});
    const ind = list.find((x) => x.kind === "individual")!;
    expect(ind).toMatchObject({ phone: "+251911200101", idNumber: "ET-12345", address: "Kezira", contactPhone: "+251922334455", vatNumber: "123456789" });
  });

  it("catches duplicates inside the file and against renters already saved", async () => {
    const w = await world();
    await w.pm.mutation(w.api.imports.commitRenters, { rows: [r(2)] });
    const res = await w.pm.query(w.api.imports.checkRenters, { rows: [r(2), r(3, { tin: r(2).tin }), r(4), r(4)] });
    const codes = res.issues.map((i) => `${i.row}:${i.code}`);
    expect(codes).toContain("2:already_exists"); // already saved
    expect(codes).toContain("3:duplicate_in_file"); // same TIN as row 2 in the same file
    expect(codes).toContain("4:duplicate_in_file"); // the second copy of the same new renter
  });
});
