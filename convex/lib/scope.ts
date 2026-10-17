import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { canSeeBuilding, fail, type Principal } from "./access";
import { owned } from "./tenant";

/** A renter is visible if the user sees all buildings, the renter has no agreements yet, or one of their units is in scope. */
export async function renterVisible(ctx: QueryCtx, u: Principal, renterId: Id<"renters">): Promise<boolean> {
  if (u.buildingScope === "all") return true;
  const agreements = await ctx.db.query("agreements").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
  if (agreements.length === 0) return true;
  for (const a of agreements) {
    const unit = await ctx.db.get(a.unitId);
    if (unit && canSeeBuilding(u, unit.buildingId)) return true;
  }
  return false;
}

/** The renter must exist, belong to this company, and be one this person may see. */
export async function assertRenterVisible(ctx: QueryCtx, u: Principal, renterId: Id<"renters">) {
  await owned(ctx, u.orgId, renterId); // a renter who was deleted, or belongs to another company, is "not found"
  if (!(await renterVisible(ctx, u, renterId))) fail("forbidden_renter");
}

export async function assertUnitVisible(ctx: QueryCtx, u: Principal, unitId: Id<"units">): Promise<Doc<"units">> {
  const unit = await owned(ctx, u.orgId, unitId);
  if (!canSeeBuilding(u, unit.buildingId)) fail("forbidden_building");
  return unit;
}

/** The building must exist, belong to this company, and be one this person may see. */
export async function assertBuildingIn(ctx: QueryCtx, u: Principal, buildingId: Id<"buildings">): Promise<Doc<"buildings">> {
  const b = await owned(ctx, u.orgId, buildingId);
  if (!canSeeBuilding(u, buildingId)) fail("forbidden_building");
  return b;
}
