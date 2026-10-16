import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertBuilding, audit, fail, requireRole } from "./lib/access";
import { assertRenterVisible, assertUnitVisible } from "./lib/scope";

/**
 * Permanent deletion, for records that were added by mistake and have no history.
 * Anything with leases, bills, payments or readings behind it is refused: archive it (buildings) or end it instead,
 * so the books always add up. Every deletion is recorded in History.
 */

const MAX_UNITS = 400; // one call may touch about 4,000 records

/** Does this unit have anything that would be lost: a lease of any status, a meter reading, a shared-cost share? */
export async function unitHasHistory(ctx: QueryCtx, unitId: Id<"units">): Promise<boolean> {
  if (await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", unitId)).first()) return true;
  if (await ctx.db.query("sharedCostAllocations").withIndex("by_unit", (q) => q.eq("unitId", unitId)).first()) return true;
  for (const m of await ctx.db.query("meters").withIndex("by_unit", (q) => q.eq("unitId", unitId)).collect()) {
    if (await ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", m._id)).first()) return true;
  }
  return false;
}

async function removeUnit(ctx: MutationCtx, unitId: Id<"units">) {
  for (const m of await ctx.db.query("meters").withIndex("by_unit", (q) => q.eq("unitId", unitId)).collect()) await ctx.db.delete(m._id);
  await ctx.db.delete(unitId);
}

export const deleteUnit = mutation({
  args: { unitId: v.id("units") },
  handler: async (ctx, { unitId }) => {
    const u = await requireRole(ctx, "propertyManager");
    await assertUnitVisible(ctx, u, unitId);
    const unit = (await ctx.db.get(unitId)) ?? fail("not_found");
    if (await unitHasHistory(ctx, unitId)) fail("unit_has_history");
    await removeUnit(ctx, unitId);
    await audit(ctx, u, "unit.delete", "units", unitId, unit.number);
  },
});

export const deleteFloor = mutation({
  args: { floorId: v.id("floors") },
  handler: async (ctx, { floorId }) => {
    const u = await requireRole(ctx, "propertyManager");
    const floor = (await ctx.db.get(floorId)) ?? fail("not_found");
    assertBuilding(u, floor.buildingId);
    const units = await ctx.db.query("units").withIndex("by_building", (q) => q.eq("buildingId", floor.buildingId)).collect();
    if (units.some((x) => x.floorId === floorId)) fail("floor_has_units");
    if (floor.planFileId) await ctx.storage.delete(floor.planFileId);
    await ctx.db.delete(floorId);
    await audit(ctx, u, "floor.delete", "floors", floorId, floor.label);
  },
});

export const deleteBuilding = mutation({
  args: { buildingId: v.id("buildings") },
  handler: async (ctx, { buildingId }) => {
    const u = await requireRole(ctx, "propertyManager");
    if (u.buildingScope !== "all") fail("forbidden_building");
    const b = (await ctx.db.get(buildingId)) ?? fail("not_found");
    const units = await ctx.db.query("units").withIndex("by_building", (q) => q.eq("buildingId", buildingId)).collect();
    if (units.length > MAX_UNITS) fail("too_big_to_delete");
    if (await ctx.db.query("sharedCosts").withIndex("by_building_period", (q) => q.eq("buildingId", buildingId)).first()) fail("building_has_history");
    for (const x of units) if (await unitHasHistory(ctx, x._id)) fail("building_has_history");
    for (const x of units) await removeUnit(ctx, x._id);
    for (const f of await ctx.db.query("floors").withIndex("by_building", (q) => q.eq("buildingId", buildingId)).collect()) {
      if (f.planFileId) await ctx.storage.delete(f.planFileId);
      await ctx.db.delete(f._id);
    }
    // staff and open invitations that named this building lose it from their list
    for (const s of await ctx.db.query("users").collect()) {
      if (Array.isArray(s.buildingScope) && s.buildingScope.includes(buildingId)) await ctx.db.patch(s._id, { buildingScope: s.buildingScope.filter((id) => id !== buildingId) });
    }
    for (const i of await ctx.db.query("invites").collect()) {
      if (Array.isArray(i.buildingScope) && i.buildingScope.includes(buildingId)) await ctx.db.patch(i._id, { buildingScope: i.buildingScope.filter((id) => id !== buildingId) });
    }
    await ctx.db.delete(buildingId);
    await audit(ctx, u, "building.delete", "buildings", buildingId, `${b.name} (${units.length} units)`);
    return { units: units.length };
  },
});

export const deleteRenter = mutation({
  args: { renterId: v.id("renters") },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    await assertRenterVisible(ctx, u, renterId);
    const r = (await ctx.db.get(renterId)) ?? fail("not_found");
    const has = (await ctx.db.query("agreements").withIndex("by_renter", (q) => q.eq("renterId", renterId)).first())
      || (await ctx.db.query("payments").withIndex("by_renter", (q) => q.eq("renterId", renterId)).first())
      || (await ctx.db.query("renterCredits").withIndex("by_renter", (q) => q.eq("renterId", renterId)).first())
      || (await ctx.db.query("invoices").withIndex("by_renter", (q) => q.eq("renterId", renterId)).first());
    if (has) fail("renter_has_history");
    for (const d of await ctx.db.query("renterDocuments").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect()) { await ctx.storage.delete(d.fileId); await ctx.db.delete(d._id); }
    for (const m of await ctx.db.query("smsMessages").filter((q) => q.eq(q.field("renterId"), renterId)).collect()) await ctx.db.delete(m._id);
    await ctx.db.delete(renterId);
    await audit(ctx, u, "renter.delete", "renters", renterId, r.name);
  },
});

/** A lease that was never approved can be thrown away. Once it has been active it stays on the record. */
export const deleteDraftAgreement = mutation({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, { agreementId }) => {
    const u = await requireRole(ctx, "propertyManager");
    const ag = (await ctx.db.get(agreementId)) ?? fail("not_found");
    await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "draft" && ag.status !== "inReview") fail("agreement_not_draft");
    if (await ctx.db.query("invoices").withIndex("by_agreement_period", (q) => q.eq("agreementId", agreementId)).first()) fail("agreement_has_bills");
    for (const t of await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", agreementId)).collect()) await ctx.db.delete(t._id);
    for (const d of await ctx.db.query("deposits").withIndex("by_agreement", (q) => q.eq("agreementId", agreementId)).collect()) await ctx.db.delete(d._id);
    if (ag.signedFileId) await ctx.storage.delete(ag.signedFileId);
    await ctx.db.delete(agreementId);
    await audit(ctx, u, "agreement.deleteDraft", "agreements", agreementId, ag.status);
  },
});
