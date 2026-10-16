import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { canSeeBuilding, fail } from "./access";

/** A renter is visible if the user sees all buildings, the renter has no agreements yet, or one of their units is in scope. */
export async function renterVisible(ctx: QueryCtx, u: Doc<"users">, renterId: Id<"renters">): Promise<boolean> {
  if (u.buildingScope === "all") return true;
  const agreements = await ctx.db.query("agreements").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
  if (agreements.length === 0) return true;
  for (const a of agreements) {
    const unit = await ctx.db.get(a.unitId);
    if (unit && canSeeBuilding(u, unit.buildingId)) return true;
  }
  return false;
}

export async function assertRenterVisible(ctx: QueryCtx, u: Doc<"users">, renterId: Id<"renters">) {
  if (!(await ctx.db.get(renterId))) fail("not_found"); // a renter who was deleted cannot be given a lease or a payment
  if (!(await renterVisible(ctx, u, renterId))) fail("forbidden_renter");
}

export async function assertUnitVisible(ctx: QueryCtx, u: Doc<"users">, unitId: Id<"units">): Promise<Doc<"units">> {
  const unit = await ctx.db.get(unitId);
  if (!unit) return fail("not_found");
  if (!canSeeBuilding(u, unit.buildingId)) fail("forbidden_building");
  return unit;
}
