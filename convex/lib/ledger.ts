import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { Santim } from "./money";

export type InvoiceBalance = { total: Santim; adjustments: Santim; paid: Santim; creditUsed: Santim; due: Santim };

/** One place that defines "what is still owed on this bill". Screens, reports and SMS all use it. */
export async function invoiceBalance(ctx: QueryCtx, invoice: Doc<"invoices">): Promise<InvoiceBalance> {
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
