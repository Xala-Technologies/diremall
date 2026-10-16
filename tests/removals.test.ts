import { describe, expect, it } from "vitest";
import { etb, world } from "./helpers";

const YEAR = 365 * 86_400_000;

describe("deleting things that were added by mistake", () => {
  it("deletes an empty building with its floors and units, and takes it off staff access lists", async () => {
    const w = await world();
    const b = await w.pm.mutation(w.api.properties.createBuilding, { name: "Mistake", floors: ["Ground"] });
    const f = (await w.pm.query(w.api.properties.listFloors, { buildingId: b }))[0]!._id;
    await w.pm.mutation(w.api.properties.createUnit, { buildingId: b, floorId: f, number: "M-1", areaM2: 10, category: "retail", ratePerM2: etb(100) });
    const staff = await w.t.run((c) => c.db.insert("users", { name: "scoped", email: "s@x.et", roles: ["propertyManager"], buildingScope: [b, w.buildingId], active: true, lang: "en" }));
    expect((await w.pm.query(w.api.properties.buildingOverview, {})).find((x) => x._id === b)!.deletable).toBe(true);

    await expect(w.fin.mutation(w.api.removals.deleteBuilding, { buildingId: b })).rejects.toThrow(/forbidden/);
    expect(await w.pm.mutation(w.api.removals.deleteBuilding, { buildingId: b })).toEqual({ units: 1 });
    expect((await w.pm.query(w.api.properties.listBuildings, { includeArchived: true })).some((x) => x._id === b)).toBe(false);
    expect(await w.t.run((c) => c.db.query("units").collect().then((u) => u.filter((x) => x.buildingId === b).length))).toBe(0);
    expect((await w.t.run((c) => c.db.get(staff)))!.buildingScope).toEqual([w.buildingId]);
    expect((await w.t.run((c) => c.db.query("auditLog").collect())).some((a) => a.action === "building.delete")).toBe(true);
  });

  it("refuses a building, unit or renter that has history, and a lease that was approved", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 50); const renterId = await w.renter("Abebe");
    const ag = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: Date.now(), endsAt: Date.now() + YEAR, rent: { kind: "fixed", amount: etb(1000) }, dueDay: 5, depositAmount: 0 });
    expect((await w.pm.query(w.api.properties.buildingOverview, {})).find((x) => x._id === w.buildingId)!.deletable).toBe(false);
    await expect(w.pm.mutation(w.api.removals.deleteBuilding, { buildingId: w.buildingId })).rejects.toThrow(/building_has_history/);
    await expect(w.pm.mutation(w.api.removals.deleteUnit, { unitId })).rejects.toThrow(/unit_has_history/);
    await expect(w.pm.mutation(w.api.removals.deleteRenter, { renterId })).rejects.toThrow(/renter_has_history/);
    const floors = await w.pm.query(w.api.properties.listFloors, { buildingId: w.buildingId });
    await expect(w.pm.mutation(w.api.removals.deleteFloor, { floorId: floors[0]!._id })).rejects.toThrow(/floor_has_units/);

    // a draft can go; once the unit and renter are free of it they can go too
    await w.pm.mutation(w.api.removals.deleteDraftAgreement, { agreementId: ag });
    expect(await w.t.run((c) => c.db.get(ag))).toBeNull();
    expect(await w.t.run((c) => c.db.query("agreementTerms").collect().then((x) => x.length))).toBe(0);
    await w.pm.mutation(w.api.removals.deleteRenter, { renterId });
    await w.pm.mutation(w.api.removals.deleteUnit, { unitId });
    await w.pm.mutation(w.api.removals.deleteFloor, { floorId: floors[0]!._id });
    expect(await w.pm.query(w.api.properties.listUnits, {})).toEqual([]);
    expect((await w.pm.query(w.api.renters.list, {})).length).toBe(0);
  });

  it("will not delete a lease that has been approved", async () => {
    const w = await world();
    const unitId = await w.unit("A-2", 50); const renterId = await w.renter("Selam");
    const ag = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: Date.now(), endsAt: Date.now() + YEAR, rent: { kind: "fixed", amount: etb(1000) }, dueDay: 5, depositAmount: 0 });
    await w.t.run((c) => c.db.patch(ag, { status: "active" }));
    await expect(w.pm.mutation(w.api.removals.deleteDraftAgreement, { agreementId: ag })).rejects.toThrow(/agreement_not_draft/);
  });
});
