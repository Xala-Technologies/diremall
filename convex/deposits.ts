import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { READ_ROLES, assertDifferentPerson, assertSantim, audit, fail, requireRole } from "./lib/access";
import { invoiceBalance, refreshInvoice } from "./lib/ledger";
import { assertUnitVisible } from "./lib/scope";

const available = (d: Doc<"deposits">) =>
  d.held - d.deductions.filter((x) => x.approvedBy).reduce((s, x) => s + x.amount, 0) - d.refunded;

async function load(ctx: any, agreementId: Doc<"agreements">["_id"], u: Doc<"users">) {
  const ag = ((await ctx.db.get(agreementId)) as Doc<"agreements"> | null) ?? fail("not_found");
  await assertUnitVisible(ctx, u, ag.unitId);
  const dep = (await ctx.db.query("deposits").withIndex("by_agreement", (q: any) => q.eq("agreementId", agreementId)).unique()) as Doc<"deposits"> | null;
  return dep ?? fail("no_deposit");
}

/** Deposits live in their own ledger. They never reduce rent due. */
export const receive = mutation({
  args: {
    agreementId: v.id("agreements"), amount: v.number(),
    method: v.union(v.literal("bankDeposit"), v.literal("transfer"), v.literal("telebirr"), v.literal("cbeBirr"), v.literal("cash")),
    reference: v.string(), receivedAt: v.optional(v.number()),
  },
  handler: async (ctx, { agreementId, amount, method, reference, receivedAt }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const dep = await load(ctx, agreementId, u);
    assertSantim(amount);
    if (!reference.trim()) fail("reference_required");
    if (dep.held + amount > dep.required) fail("exceeds_required_deposit");
    const ref = reference.trim();
    // the same transfer cannot be booked twice, as a deposit or as rent
    if ((await ctx.db.query("payments").withIndex("by_reference", (q) => q.eq("method", method).eq("reference", ref)).collect()).some((p) => p.status !== "voided")) fail("duplicate_payment_reference");
    if ((await ctx.db.query("deposits").collect()).some((d) => (d.receipts ?? []).some((r) => r.method === method && r.reference === ref))) fail("duplicate_payment_reference");
    await ctx.db.patch(dep._id, { held: dep.held + amount, receipts: [...(dep.receipts ?? []), { amount, method, reference: ref, receivedAt: receivedAt ?? Date.now(), recordedBy: u._id }] });
    await audit(ctx, u, "deposit.receive", "agreements", agreementId, `${amount} ${method} ${ref}`);
  },
});

export const requestDeduction = mutation({
  args: { agreementId: v.id("agreements"), amount: v.number(), reason: v.string(), invoiceId: v.optional(v.id("invoices")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer", "propertyManager");
    const dep = await load(ctx, a.agreementId, u);
    if (a.invoiceId) {
      // taking the deposit to settle a bill: the bill must be this renter's, issued, and owe at least that much
      const ag = (await ctx.db.get(a.agreementId)) ?? fail("not_found");
      const inv = (await ctx.db.get(a.invoiceId)) ?? fail("not_found");
      if (inv.renterId !== ag.renterId || inv.status !== "issued") fail("invoice_not_payable");
      if (a.amount > (await invoiceBalance(ctx, inv)).due) fail("allocation_exceeds_balance");
    }
    if (!a.reason.trim()) fail("reason_required");
    assertSantim(a.amount);
    const pending = dep.deductions.filter((x) => !x.approvedBy).reduce((s, x) => s + x.amount, 0);
    if (a.amount <= 0 || a.amount + pending > available(dep)) fail("exceeds_deposit");
    await ctx.db.patch(dep._id, { deductions: [...dep.deductions, { amount: a.amount, reason: a.reason, requestedBy: u._id, ...(a.invoiceId ? { invoiceId: a.invoiceId } : {}) }] });
    await audit(ctx, u, "deposit.deductRequest", "agreements", a.agreementId, a.reason);
  },
});

export const approveDeduction = mutation({
  args: { agreementId: v.id("agreements"), index: v.number() },
  handler: async (ctx, { agreementId, index }) => {
    const u = await requireRole(ctx, "approver");
    const dep = await load(ctx, agreementId, u);
    const d = dep.deductions[index] ?? fail("not_found");
    if (d.approvedBy) fail("already_approved");
    assertDifferentPerson(d.requestedBy, u._id);
    if (d.amount > available(dep)) fail("exceeds_deposit");
    // when it settles a bill, the deposit pays that bill: a credit appears and is used on the bill in the same step, so the renter's credit stays at zero
    if (d.invoiceId) {
      const inv = (await ctx.db.get(d.invoiceId)) ?? fail("not_found");
      if (d.amount > (await invoiceBalance(ctx, inv)).due) fail("allocation_exceeds_balance");
      await ctx.db.insert("renterCredits", { renterId: inv.renterId, amount: d.amount });
      await ctx.db.insert("renterCredits", { renterId: inv.renterId, invoiceId: d.invoiceId, amount: -d.amount });
      await refreshInvoice(ctx, d.invoiceId);
    }
    const next = dep.deductions.map((x, i) => (i === index ? { ...x, approvedBy: u._id } : x));
    await ctx.db.patch(dep._id, { deductions: next });
    await audit(ctx, u, "deposit.deductApprove", "agreements", agreementId, String(d.amount));
  },
});

export const refund = mutation({
  args: { agreementId: v.id("agreements"), amount: v.number() },
  handler: async (ctx, { agreementId, amount }) => {
    const u = await requireRole(ctx, "approver");
    const dep = await load(ctx, agreementId, u);
    // A deposit is refunded when the tenancy has ended, never during it.
    const ag = (await ctx.db.get(agreementId)) ?? fail("not_found");
    if (ag.status !== "expired" && ag.status !== "terminated") fail("agreement_still_active");
    assertSantim(amount);
    if (amount > available(dep)) fail("exceeds_deposit");
    await ctx.db.patch(dep._id, { refunded: dep.refunded + amount });
    await audit(ctx, u, "deposit.refund", "agreements", agreementId, String(amount));
  },
});

export const get = query({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, { agreementId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const dep = await load(ctx, agreementId, u);
    return { ...dep, available: available(dep) };
  },
});
