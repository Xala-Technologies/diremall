import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { refreshInvoice } from "./lib/ledger";

/** One page of bills: fill in building and stored balances. Safe to run again. */
export const backfillInvoicePage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("invoices").paginate({ numItems: 100, cursor });
    let changed = 0;
    for (const inv of page.page) {
      const unit = await ctx.db.get(inv.unitId);
      if (inv.buildingId === undefined && unit) { await ctx.db.patch(inv._id, { buildingId: unit.buildingId }); changed++; }
      if (inv.status === "issued" && inv.due === undefined) { await refreshInvoice(ctx, inv._id); changed++; }
    }
    return { next: page.isDone ? null : page.continueCursor, changed };
  },
});

/** Run after deploying the stored-balance change: npx convex run migrations:backfillInvoices */
export const backfillInvoices = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let changed = 0;
    do {
      const r: { next: string | null; changed: number } = await ctx.runMutation(internal.migrations.backfillInvoicePage, { cursor });
      changed += r.changed;
      cursor = r.next;
    } while (cursor);
    return `backfilled ${changed} updates`;
  },
});
