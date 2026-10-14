import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Occupied if an active agreement on the unit has started and not ended; otherwise vacant. A unit marked for maintenance stays so.
 * Called whenever an agreement ends, so back-to-back leases never leave a leased unit showing as vacant.
 */
export async function refreshUnitStatus(ctx: MutationCtx, unitId: Id<"units">) {
  const unit = await ctx.db.get(unitId);
  if (!unit || unit.status === "maintenance") return;
  const now = Date.now();
  const active = (await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", unitId).eq("status", "active")).collect()).find((a) => a.startsAt <= now && a.endsAt > now);
  const next = active ? "occupied" : "vacant";
  if (unit.status !== next) await ctx.db.patch(unitId, { status: next });
}
