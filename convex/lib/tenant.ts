import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./access";

/**
 * The rules that keep one company's records away from another's:
 *  - every business table carries `orgId`, and every list is read through `inOrg`, which uses an index that starts with it;
 *  - every id that arrives from a screen is loaded with `owned`, which refuses a record from any other company;
 *  - every insert writes the caller's `orgId`.
 * `tests/tenants.test.ts` calls every query and change as one company with another company's ids and expects refusal.
 */
export type TenantTable = { [T in TableNames]: DataModel[T]["document"] extends { orgId: Id<"organizations"> } ? T : never }[TableNames];

type Ctx = QueryCtx | MutationCtx;

/** What can be done with a company's records once they are selected. */
export interface OrgQuery<D> {
  collect(): Promise<D[]>;
  take(n: number): Promise<D[]>;
  first(): Promise<D | null>;
  unique(): Promise<D | null>;
  order(o: "asc" | "desc"): OrgQuery<D>;
  paginate(o: { numItems: number; cursor: string | null }): Promise<{ page: D[]; isDone: boolean; continueCursor: string }>;
  filter(f: (q: any) => any): OrgQuery<D>;
}

/** All of one company's records in a table, through the by_org index. Narrow further with .filter() or collect() and filter in code. */
export function inOrg<T extends TenantTable>(ctx: Ctx, table: T, orgId: Id<"organizations">): OrgQuery<Doc<T>> {
  return (ctx.db.query(table) as any).withIndex("by_org", (q: any) => q.eq("orgId", orgId));
}

/** A record by id, only if it belongs to this company. A record that does not exist and one in another company look the same. */
export async function owned<T extends TenantTable>(ctx: Ctx, orgId: Id<"organizations">, id: Id<T>): Promise<Doc<T>> {
  const d = (await ctx.db.get(id)) as (Doc<T> & { orgId: Id<"organizations"> }) | null;
  if (!d || d.orgId !== orgId) return fail("not_found");
  return d;
}

/** Same, but returns null instead of refusing: for optional links. */
export async function ownedOrNull<T extends TenantTable>(ctx: Ctx, orgId: Id<"organizations">, id: Id<T> | undefined | null): Promise<Doc<T> | null> {
  if (!id) return null;
  const d = (await ctx.db.get(id)) as (Doc<T> & { orgId: Id<"organizations"> }) | null;
  return d && d.orgId === orgId ? d : null;
}
