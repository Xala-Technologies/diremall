import { describe, expect, it } from "vitest";
import { etb, storePdf, world } from "./helpers";

describe("buildings and floors", () => {
  it("creates a building with its floors, trims and cleans the details, and refuses a duplicate name", async () => {
    const { t, api, pm } = await world();
    const id = await pm.mutation(api.properties.createBuilding, { name: "  Block B ", city: " Dire Dawa ", contactPhone: "0911 20 01 01", notes: "  ", floors: ["Ground", " 1st ", "1st", ""] });
    const [b] = (await pm.query(api.properties.listBuildings, {})).filter((x) => x._id === id);
    expect(b).toMatchObject({ name: "Block B", city: "Dire Dawa", contactPhone: "+251911200101" });
    expect(b!.notes).toBeUndefined();
    const floors = await pm.query(api.properties.listFloors, { buildingId: id });
    expect(floors.map((f) => f.label).sort()).toEqual(["1st", "Ground"]); // blank and duplicate labels dropped
    await expect(pm.mutation(api.properties.createBuilding, { name: "block b" })).rejects.toThrow(/building_name_exists/);
    await expect(pm.mutation(api.properties.createBuilding, { name: "X", contactPhone: "12" })).rejects.toThrow(/invalid_phone/);
    await expect(pm.mutation(api.properties.createBuilding, { name: "  " })).rejects.toThrow(/name_required/);
    void t;
  });

  it("edits a building, renames floors without clashes, and attaches a plan only if it is a PDF or image", async () => {
    const { t, api, pm, buildingId, floorId } = await world();
    await pm.mutation(api.properties.updateBuilding, { buildingId, name: "Dire Mall Main", address: "Kezira", city: "Dire Dawa" });
    const [b] = (await pm.query(api.properties.listBuildings, {})).filter((x) => x._id === buildingId);
    expect(b).toMatchObject({ name: "Dire Mall Main", address: "Kezira" });
    const f2 = await pm.mutation(api.properties.addFloor, { buildingId, label: "First" });
    await expect(pm.mutation(api.properties.addFloor, { buildingId, label: "first" })).rejects.toThrow(/floor_label_exists/);
    await expect(pm.mutation(api.properties.updateFloor, { floorId: f2, label: "Ground" })).rejects.toThrow(/floor_label_exists/);
    await pm.mutation(api.properties.updateFloor, { floorId: f2, label: "Mezzanine" });
    const bad = await t.run((c) => storePdf(c as never, "text/html"));
    await expect(pm.mutation(api.properties.updateFloor, { floorId, planFileId: bad })).rejects.toThrow(/file_type_not_allowed/);
    const ok = await t.run((c) => storePdf(c as never));
    await pm.mutation(api.properties.updateFloor, { floorId, planFileId: ok });
    const floors = await pm.query(api.properties.listFloors, { buildingId });
    expect(floors.find((f) => f._id === floorId)?.hasPlan).toBe(true);
  });

  it("a user limited to another building cannot edit this one", async () => {
    const { t, api, mk, as, buildingId, floorId } = await world();
    const other = await t.run((c) => c.db.insert("buildings", { name: "Other" }));
    const lim = as(await mk("lim", ["propertyManager"], [other]));
    await expect(lim.mutation(api.properties.updateBuilding, { buildingId, name: "Hacked" })).rejects.toThrow(/forbidden/);
    await expect(lim.mutation(api.properties.updateFloor, { floorId, label: "Hacked" })).rejects.toThrow(/forbidden/);
    await expect(lim.mutation(api.properties.createBuilding, { name: "Mine" })).rejects.toThrow(/forbidden/);
  });
});

describe("units", () => {
  it("can start in maintenance with notes, and edits keep the numbering and floors consistent", async () => {
    const { api, pm, unit, buildingId } = await world();
    const a = await unit("A-1", 50), b = await unit("A-2", 60);
    const f2 = await pm.mutation(api.properties.addFloor, { buildingId, label: "Upper" });
    const m = await pm.mutation(api.properties.createUnit, { buildingId, floorId: f2, number: " M-1 ", areaM2: 20, category: "storage", ratePerM2: etb(500), notes: " leaking roof ", status: "maintenance" });
    const units = await pm.query(api.properties.listUnits, { buildingId });
    expect(units.find((u) => u._id === m)).toMatchObject({ number: "M-1", status: "maintenance", notes: "leaking roof" });
    await expect(pm.mutation(api.properties.updateUnit, { unitId: a, number: "A-2" })).rejects.toThrow(/unit_number_exists/);
    await pm.mutation(api.properties.updateUnit, { unitId: a, number: "A-10", floorId: f2, notes: "corner unit" });
    const other = await pm.mutation(api.properties.createBuilding, { name: "Annex", floors: ["G"] });
    const [of] = await pm.query(api.properties.listFloors, { buildingId: other });
    await expect(pm.mutation(api.properties.updateUnit, { unitId: b, floorId: of!._id })).rejects.toThrow(/floor_not_in_building/);
  });
});

describe("renters", () => {
  const base = { kind: "company" as const, name: "Abebe Trading", tin: "0012345678", phone: "0911 20 01 01" };

  it("validates and normalises what is typed, and keeps the extra details", async () => {
    const { api, pm } = await world();
    const id = await pm.mutation(api.renters.create, { ...base, email: "a@x.et", address: " Kezira ", contactPerson: "Almaz", contactPhone: "0922 33 44 55", vatNumber: "123 456 789", licenseExpiresAt: Date.UTC(2027, 0, 1), notes: " pays late " });
    const r = (await pm.query(api.renters.get, { renterId: id })).renter;
    expect(r).toMatchObject({ phone: "+251911200101", contactPhone: "+251922334455", address: "Kezira", vatNumber: "123456789", notes: "pays late", licenseExpiresAt: Date.UTC(2027, 0, 1) });
    await expect(pm.mutation(api.renters.create, { ...base, name: "B", tin: "123" })).rejects.toThrow(/invalid_tin/);
    await expect(pm.mutation(api.renters.create, { ...base, name: "B", tin: "0099999999", phone: "abc" })).rejects.toThrow(/invalid_phone/);
    await expect(pm.mutation(api.renters.create, { ...base, name: "B", tin: "0099999999", email: "nope" })).rejects.toThrow(/invalid_email/);
    await expect(pm.mutation(api.renters.create, { ...base, name: "B", tin: "0099999999", vatNumber: "12" })).rejects.toThrow(/invalid_vat/);
    await expect(pm.mutation(api.renters.create, { ...base, name: "Same TIN" })).rejects.toThrow(/tin_already_registered/);
  });

  it("a company needs a TIN, an individual needs a TIN or an ID number", async () => {
    const { api, pm } = await world();
    await expect(pm.mutation(api.renters.create, { kind: "company", name: "C", phone: "0911200101" })).rejects.toThrow(/company_needs_tin/);
    await expect(pm.mutation(api.renters.create, { kind: "individual", name: "I", phone: "0911200101" })).rejects.toThrow(/individual_needs_identifier/);
    await pm.mutation(api.renters.create, { kind: "individual", name: "I", phone: "0911200101", idNumber: "ET-1234567" });
  });

  it("edits replace the old values and a blank clears a field, without breaking the rules", async () => {
    const { api, pm } = await world();
    const id = await pm.mutation(api.renters.create, { ...base, email: "a@x.et", licenseExpiresAt: Date.UTC(2027, 0, 1) });
    await pm.mutation(api.renters.update, { renterId: id, patch: { name: "Abebe Trading PLC", email: "", licenseExpiresAt: 0, address: "Sabiyan" } });
    const r = (await pm.query(api.renters.get, { renterId: id })).renter;
    expect(r).toMatchObject({ name: "Abebe Trading PLC", address: "Sabiyan" });
    expect(r.email).toBeUndefined();
    expect(r.licenseExpiresAt).toBeUndefined();
    expect(r.tin).toBe("0012345678"); // untouched fields stay
    await expect(pm.mutation(api.renters.update, { renterId: id, patch: { tin: "" } })).rejects.toThrow(/company_needs_tin/);
    const other = await pm.mutation(api.renters.create, { ...base, name: "Other", tin: "0098765432" });
    await expect(pm.mutation(api.renters.update, { renterId: other, patch: { tin: "0012345678" } })).rejects.toThrow(/tin_already_registered/);
  });
});

describe("archiving a building", () => {
  it("hides it and its units everywhere, keeps the record, refuses while a lease is live, and can be undone", async () => {
    const w = await world();
    const b2 = await w.pm.mutation(w.api.properties.createBuilding, { name: "Block B", floors: ["Ground"] });
    const f2 = (await w.pm.query(w.api.properties.listFloors, { buildingId: b2 }))[0]!._id;
    await w.pm.mutation(w.api.properties.createUnit, { buildingId: b2, floorId: f2, number: "B-1", areaM2: 40, category: "retail", ratePerM2: etb(100) });
    expect((await w.pm.query(w.api.properties.listBuildings, {})).map((b) => b.name).sort()).toEqual(["Block B", "Dire Mall"]);

    await w.pm.mutation(w.api.properties.setBuildingArchived, { buildingId: b2, archived: true });
    expect((await w.pm.query(w.api.properties.listBuildings, {})).map((b) => b.name)).toEqual(["Dire Mall"]);
    expect((await w.pm.query(w.api.properties.listBuildings, { includeArchived: true })).length).toBe(2);
    expect((await w.pm.query(w.api.properties.listUnits, {})).some((u) => u.number === "B-1")).toBe(false);
    expect((await w.pm.query(w.api.reports.rentRoll, {})).rows.some((r) => r.unitNumber === "B-1")).toBe(false);
    await expect(w.pm.mutation(w.api.properties.createUnit, { buildingId: b2, floorId: f2, number: "B-2", areaM2: 40, category: "retail", ratePerM2: 1 })).rejects.toThrow(/building_archived/);
    const ov = (await w.pm.query(w.api.properties.buildingOverview, {})).find((b) => b._id === b2)!;
    expect(ov).toMatchObject({ units: 1, floors: 1, liveAgreements: 0 }); expect(ov.archivedAt).toBeGreaterThan(0);

    await w.pm.mutation(w.api.properties.updateBuilding, { buildingId: b2, name: "Block B2" }); // an edit must not bring it back
    expect((await w.pm.query(w.api.properties.buildingOverview, {})).find((b) => b._id === b2)!.archivedAt).toBeGreaterThan(0);
    await w.pm.mutation(w.api.properties.setBuildingArchived, { buildingId: b2, archived: false });
    expect((await w.pm.query(w.api.properties.listUnits, {})).some((u) => u.number === "B-1")).toBe(true);

    // a live lease blocks archiving
    const unitId = await w.unit("A-1", 50); const renterId = await w.renter("Abebe");
    await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: Date.now(), endsAt: Date.now() + 365 * 86_400_000, rent: { kind: "fixed", amount: etb(1000) }, dueDay: 5, depositAmount: 0 });
    await expect(w.pm.mutation(w.api.properties.setBuildingArchived, { buildingId: w.buildingId, archived: true })).rejects.toThrow(/building_has_leases/);
    await expect(w.fin.mutation(w.api.properties.setBuildingArchived, { buildingId: b2, archived: true })).rejects.toThrow(/forbidden/);
  });
});
