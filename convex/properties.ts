import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { READ_ROLES, assertBuilding, audit, canSeeBuilding, fail, requireRole } from "./lib/access";

const category = v.union(v.literal("office"), v.literal("retail"), v.literal("storage"), v.literal("residential"));

export const listBuildings = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    return (await ctx.db.query("buildings").collect()).filter((b) => canSeeBuilding(u, b._id));
  },
});

export const createBuilding = mutation({
  args: { name: v.string(), address: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    if (u.buildingScope !== "all") fail("forbidden_building");
    const id = await ctx.db.insert("buildings", a);
    await audit(ctx, u, "building.create", "buildings", id, a.name);
    return id;
  },
});

export const addFloor = mutation({
  args: { buildingId: v.id("buildings"), label: v.string(), planFileId: v.optional(v.id("_storage")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    assertBuilding(u, a.buildingId);
    const id = await ctx.db.insert("floors", a);
    await audit(ctx, u, "floor.create", "floors", id, a.label);
    return id;
  },
});

export const listFloors = query({
  args: { buildingId: v.id("buildings") },
  handler: async (ctx, { buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    assertBuilding(u, buildingId);
    const floors = await ctx.db.query("floors").withIndex("by_building", (q) => q.eq("buildingId", buildingId)).collect();
    return Promise.all(floors.map(async (f) => ({ ...f, planUrl: f.planFileId ? await ctx.storage.getUrl(f.planFileId) : null })));
  },
});

export const createUnit = mutation({
  args: { buildingId: v.id("buildings"), floorId: v.id("floors"), number: v.string(), areaM2: v.number(), category, ratePerM2: v.number() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    assertBuilding(u, a.buildingId);
    if (a.areaM2 <= 0 || a.ratePerM2 < 0) fail("invalid_amount");
    const floor = await ctx.db.get(a.floorId);
    if (!floor || floor.buildingId !== a.buildingId) fail("floor_not_in_building");
    const dupe = await ctx.db.query("units").withIndex("by_building_number", (q) => q.eq("buildingId", a.buildingId).eq("number", a.number)).first();
    if (dupe) fail("unit_number_exists");
    const id = await ctx.db.insert("units", { ...a, status: "vacant" });
    await audit(ctx, u, "unit.create", "units", id, a.number);
    return id;
  },
});

export const updateUnit = mutation({
  args: { unitId: v.id("units"), areaM2: v.optional(v.number()), ratePerM2: v.optional(v.number()), category: v.optional(category) },
  handler: async (ctx, { unitId, ...patch }) => {
    const u = await requireRole(ctx, "propertyManager");
    const unit = (await ctx.db.get(unitId)) ?? fail("not_found");
    assertBuilding(u, unit.buildingId);
    // A rate change on a leased unit must go through an agreement term, so issued bills never move.
    if (unit.status === "occupied" && patch.ratePerM2 !== undefined) fail("use_agreement_term_for_rate_change");
    await ctx.db.patch(unitId, patch);
    await audit(ctx, u, "unit.update", "units", unitId, JSON.stringify(patch));
  },
});

/** Only vacant <-> maintenance is manual; occupied is driven by agreements. */
export const setUnitAvailability = mutation({
  args: { unitId: v.id("units"), status: v.union(v.literal("vacant"), v.literal("maintenance")) },
  handler: async (ctx, { unitId, status }) => {
    const u = await requireRole(ctx, "propertyManager");
    const unit = (await ctx.db.get(unitId)) ?? fail("not_found");
    assertBuilding(u, unit.buildingId);
    if (unit.status === "occupied") fail("unit_occupied");
    await ctx.db.patch(unitId, { status });
    await audit(ctx, u, "unit.availability", "units", unitId, status);
  },
});

export const listUnits = query({
  args: { buildingId: v.optional(v.id("buildings")), status: v.optional(v.union(v.literal("vacant"), v.literal("occupied"), v.literal("maintenance"))) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    let units;
    if (a.buildingId) {
      assertBuilding(u, a.buildingId);
      units = await ctx.db.query("units").withIndex("by_building", (q) => q.eq("buildingId", a.buildingId!)).collect();
    } else {
      units = (await ctx.db.query("units").collect()).filter((x) => canSeeBuilding(u, x.buildingId));
    }
    return a.status ? units.filter((x) => x.status === a.status) : units;
  },
});

export const getUnit = query({
  args: { unitId: v.id("units") },
  handler: async (ctx, { unitId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const unit = (await ctx.db.get(unitId)) ?? fail("not_found");
    assertBuilding(u, unit.buildingId);
    const agreements = await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", unitId)).collect();
    const active = agreements.find((x) => x.status === "active") ?? null;
    const renter = active ? await ctx.db.get(active.renterId) : null;
    return { unit, activeAgreement: active, renter };
  },
});
