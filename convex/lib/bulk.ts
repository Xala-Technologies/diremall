import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Convex allows 4,096 database lookups per function. Reports that fetch a related record for every row
 * (a renter for each bill, a lease for each unit) would hit that at about a thousand rows. These helpers read the
 * whole related table in one call and hand back a map, so the number of lookups stays small however many rows there are.
 */
export async function renterMap(ctx: QueryCtx): Promise<Map<Id<"renters">, Doc<"renters">>> {
  return new Map((await ctx.db.query("renters").collect()).map((r) => [r._id, r]));
}
export async function unitMap(ctx: QueryCtx): Promise<Map<Id<"units">, Doc<"units">>> {
  return new Map((await ctx.db.query("units").collect()).map((x) => [x._id, x]));
}
export async function activeAgreementsByUnit(ctx: QueryCtx): Promise<Map<Id<"units">, Doc<"agreements">[]>> {
  const m = new Map<Id<"units">, Doc<"agreements">[]>();
  for (const a of await ctx.db.query("agreements").withIndex("by_status", (q) => q.eq("status", "active")).collect()) m.set(a.unitId, [...(m.get(a.unitId) ?? []), a]);
  return m;
}
export async function termsByAgreement(ctx: QueryCtx): Promise<Map<Id<"agreements">, Doc<"agreementTerms">[]>> {
  const m = new Map<Id<"agreements">, Doc<"agreementTerms">[]>();
  for (const t of await ctx.db.query("agreementTerms").collect()) m.set(t.agreementId, [...(m.get(t.agreementId) ?? []), t]);
  return m;
}
