import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Santim } from "./money";

export type InvoiceBalance = { total: Santim; adjustments: Santim; paid: Santim; creditUsed: Santim; due: Santim };

/** One place that defines "what is still owed on this bill". Screens, reports and SMS all use it. */
export async function invoiceBalance(ctx: QueryCtx, invoice: Doc<"invoices">): Promise<InvoiceBalance> {
  // a draft cannot have payments, corrections or credit yet, so there is nothing to look up
  if (invoice.status === "draft") return { total: invoice.total, adjustments: 0, paid: 0, creditUsed: 0, due: invoice.total };
  // Issued bills keep their balance on the row (see refreshInvoice). Drafts and not-yet-backfilled rows are added up.
  if (invoice.status === "issued" && invoice.due !== undefined && invoice.paid !== undefined && invoice.creditUsed !== undefined && invoice.adjustments !== undefined)
    return { total: invoice.total, adjustments: invoice.adjustments, paid: invoice.paid, creditUsed: invoice.creditUsed, due: invoice.due };
  return computeBalance(ctx, invoice);
}

/** Add up the corrections, payments and credit that make up a bill's balance. The source of truth for refreshInvoice. */
export async function computeBalance(ctx: QueryCtx, invoice: Doc<"invoices">): Promise<InvoiceBalance> {
  const adj = await ctx.db.query("invoiceAdjustments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id)).collect();
  const adjustments = adj.filter((a) => a.approvedBy).reduce((s, a) => s + a.delta, 0);
  const allocs = await ctx.db.query("paymentAllocations").withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id)).collect();
  const paid = allocs.reduce((s, a) => s + a.amount, 0);
  const credits = await ctx.db.query("renterCredits").withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id)).collect();
  const creditUsed = -credits.reduce((s, c) => s + c.amount, 0);
  return { total: invoice.total, adjustments, paid, creditUsed, due: invoice.total + adjustments - paid - creditUsed };
}

export async function creditBalance(ctx: QueryCtx, renterId: Id<"renters">): Promise<Santim> {
  const rows = await ctx.db.query("renterCredits").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** The term in force at a given instant (latest effectiveFrom ≤ at). */
export function termAt<T extends { effectiveFrom: number }>(terms: T[], at: number): T | undefined {
  return terms.filter((t) => t.effectiveFrom <= at).sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
}

/** Recompute a bill's balance from its payments, credit and approved corrections and store it on the bill. Call after any change to them. */
export async function refreshInvoice(ctx: MutationCtx, invoiceId: Id<"invoices">) {
  const inv = await ctx.db.get(invoiceId);
  if (!inv) return;
  const b = await computeBalance(ctx, inv);
  await ctx.db.patch(invoiceId, { adjustments: b.adjustments, paid: b.paid, creditUsed: b.creditUsed, due: b.due });
}
