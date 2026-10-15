import { v } from "convex/values";
import { assertUploadOk } from "./files";
import { isPhone, normalizePhone } from "./lib/validate";
import { mutation, query } from "./_generated/server";
import { READ_ROLES, assertBuilding, audit, canSeeBuilding, fail, requireRole } from "./lib/access";
import { activeAgreementsByUnit, renterMap } from "./lib/bulk";

const category = v.union(v.literal("office"), v.literal("retail"), v.literal("storage"), v.literal("residential"));

export const listBuildings = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    return (await ctx.db.query("buildings").collect()).filter((b) => canSeeBuilding(u, b._id));
  },
});

const text = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);
const buildingText = {
  address: v.optional(v.string()), city: v.optional(v.string()), subCity: v.optional(v.string()),
  contactName: v.optional(v.string()), contactPhone: v.optional(v.string()), notes: v.optional(v.string()),
};
const cleanBuilding = (a: { address?: string; city?: string; subCity?: string; contactName?: string; contactPhone?: string; notes?: string }) => {
  if (a.contactPhone && a.contactPhone.trim() && !isPhone(a.contactPhone)) fail("invalid_phone");
  return {
    address: text(a.address), city: text(a.city), subCity: text(a.subCity), contactName: text(a.contactName),
    contactPhone: a.contactPhone && a.contactPhone.trim() ? normalizePhone(a.contactPhone) : undefined, notes: text(a.notes),
  };
};
const sameName = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();

export const createBuilding = mutation({
  args: { name: v.string(), ...buildingText, floors: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    if (u.buildingScope !== "all") fail("forbidden_building");
    const name = a.name.trim();
    if (!name) fail("name_required");
    if ((await ctx.db.query("buildings").collect()).some((b) => sameName(b.name, name))) fail("building_name_exists");
    const labels = [...new Set((a.floors ?? []).map((l) => l.trim()).filter(Boolean))];
    if (labels.length > 60) fail("too_many_floors");
    const id = await ctx.db.insert("buildings", { name, ...cleanBuilding(a) });
    for (const label of labels) await ctx.db.insert("floors", { buildingId: id, label });
    await audit(ctx, u, "building.create", "buildings", id, name);
    return id;
  },
});

/** Edit a building's details. Name changes keep the same record, so nothing linked to it moves. */
export const updateBuilding = mutation({
  args: { buildingId: v.id("buildings"), name: v.string(), ...buildingText },
  handler: async (ctx, { buildingId, name, ...rest }) => {
    const u = await requireRole(ctx, "propertyManager");
    assertBuilding(u, buildingId);
    const n = name.trim();
    if (!n) fail("name_required");
    if ((await ctx.db.query("buildings").collect()).some((b) => b._id !== buildingId && sameName(b.name, n))) fail("building_name_exists");
    await ctx.db.replace(buildingId, { name: n, ...cleanBuilding(rest) });
    await audit(ctx, u, "building.update", "buildings", buildingId, n);
  },
});

/** Rename a floor or attach / replace its plan. */
export const updateFloor = mutation({
  args: { floorId: v.id("floors"), label: v.optional(v.string()), planFileId: v.optional(v.id("_storage")) },
  handler: async (ctx, { floorId, label, planFileId }) => {
    const u = await requireRole(ctx, "propertyManager");
    const floor = (await ctx.db.get(floorId)) ?? fail("not_found");
    assertBuilding(u, floor.buildingId);
    const patch: { label?: string; planFileId?: typeof planFileId } = {};
    if (label !== undefined) {
      const l = label.trim();
      if (!l) fail("name_required");
      const siblings = await ctx.db.query("floors").withIndex("by_building", (q) => q.eq("buildingId", floor.buildingId)).collect();
      if (siblings.some((f) => f._id !== floorId && sameName(f.label, l))) fail("floor_label_exists");
      patch.label = l;
    }
    if (planFileId) { await assertUploadOk(ctx, planFileId); patch.planFileId = planFileId; }
    await ctx.db.patch(floorId, patch);
    await audit(ctx, u, "floor.update", "floors", floorId, JSON.stringify({ label: patch.label, plan: !!planFileId }));
  },
});

export const addFloor = mutation({
  args: { buildingId: v.id("buildings"), label: v.string(), planFileId: v.optional(v.id("_storage")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    assertBuilding(u, a.buildingId);
    const label = a.label.trim();
    if (!label) fail("name_required");
    const siblings = await ctx.db.query("floors").withIndex("by_building", (q) => q.eq("buildingId", a.buildingId)).collect();
    if (siblings.some((f) => sameName(f.label, label))) fail("floor_label_exists");
    if (a.planFileId) await assertUploadOk(ctx, a.planFileId);
    const id = await ctx.db.insert("floors", { ...a, label });
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
    return floors.map((f) => ({ ...f, hasPlan: !!f.planFileId }));
  },
});

export const createUnit = mutation({
  args: { buildingId: v.id("buildings"), floorId: v.id("floors"), number: v.string(), areaM2: v.number(), category, ratePerM2: v.number(), notes: v.optional(v.string()), status: v.optional(v.union(v.literal("vacant"), v.literal("maintenance"))) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    assertBuilding(u, a.buildingId);
    if (!(Number.isFinite(a.areaM2) && a.areaM2 > 0) || !Number.isSafeInteger(a.ratePerM2) || a.ratePerM2 < 0) fail("invalid_amount");
    const floor = await ctx.db.get(a.floorId);
    if (!floor || floor.buildingId !== a.buildingId) fail("floor_not_in_building");
    const dupe = await ctx.db.query("units").withIndex("by_building_number", (q) => q.eq("buildingId", a.buildingId).eq("number", a.number.trim())).first();
    if (dupe) fail("unit_number_exists");
    const number = a.number.trim();
    if (!number) fail("name_required");
    const id = await ctx.db.insert("units", { buildingId: a.buildingId, floorId: a.floorId, number, areaM2: a.areaM2, category: a.category, ratePerM2: a.ratePerM2, notes: text(a.notes), status: a.status ?? "vacant" });
    await audit(ctx, u, "unit.create", "units", id, a.number);
    return id;
  },
});

export const updateUnit = mutation({
  args: { unitId: v.id("units"), number: v.optional(v.string()), floorId: v.optional(v.id("floors")), notes: v.optional(v.string()), areaM2: v.optional(v.number()), ratePerM2: v.optional(v.number()), category: v.optional(category) },
  handler: async (ctx, { unitId, ...patch }) => {
    const u = await requireRole(ctx, "propertyManager");
    const unit = (await ctx.db.get(unitId)) ?? fail("not_found");
    assertBuilding(u, unit.buildingId);
    // A rate change on a leased unit must go through an agreement term, so issued bills never move.
    if (unit.status === "occupied" && (patch.ratePerM2 !== undefined || patch.areaM2 !== undefined)) fail("use_agreement_term_for_rate_change");
    if (patch.areaM2 !== undefined && !(Number.isFinite(patch.areaM2) && patch.areaM2 > 0)) fail("invalid_amount");
    if (patch.ratePerM2 !== undefined && !(Number.isSafeInteger(patch.ratePerM2) && patch.ratePerM2 >= 0)) fail("invalid_amount");
    if (patch.number !== undefined) {
      const n = patch.number.trim();
      if (!n) fail("name_required");
      const dupe = await ctx.db.query("units").withIndex("by_building_number", (q) => q.eq("buildingId", unit.buildingId).eq("number", n)).first();
      if (dupe && dupe._id !== unitId) fail("unit_number_exists");
      patch.number = n;
    }
    if (patch.floorId !== undefined) {
      const f = await ctx.db.get(patch.floorId);
      if (!f || f.buildingId !== unit.buildingId) fail("floor_not_in_building");
    }
    if (patch.notes !== undefined) patch.notes = text(patch.notes) ?? "";
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
    const shown = a.status ? units.filter((x) => x.status === a.status) : units;
    // the current renter, so the unit board can show who is in each space
    const [leases, renters] = await Promise.all([activeAgreementsByUnit(ctx), renterMap(ctx)]);
    return shown.map((x) => {
      const actives = leases.get(x._id) ?? [];
      const now = Date.now();
      const current = actives.find((a) => a.startsAt <= now && a.endsAt > now);
      const next = actives.filter((a) => a.startsAt > now).sort((a, b) => a.startsAt - b.startsAt)[0];
      const ag = current ?? next;
      const renter = ag ? renters.get(ag.renterId) ?? null : null;
      // a unit with a signed lease starting later is reserved, not available
      return { ...x, renterName: renter?.name ?? "", agreementId: ag?._id, reservedFrom: !current && next ? next.startsAt : undefined };
    });
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
