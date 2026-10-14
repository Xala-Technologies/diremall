import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { READ_ROLES, assertDifferentPerson, audit, fail, requireRole } from "./lib/access";
import { applyPayment } from "./lib/billing";
import { creditBalance, invoiceBalance } from "./lib/ledger";
import { assertRenterVisible, assertUnitVisible } from "./lib/scope";

const method = v.union(v.literal("bankDeposit"), v.literal("transfer"), v.literal("telebirr"), v.literal("cbeBirr"), v.literal("cash"));

/** Step 1: staff record the payment and its evidence. Nothing is reduced yet. */
export const record = mutation({
  args: { renterId: v.id("renters"), amount: v.number(), method, reference: v.string(), receivedAt: v.number(), evidenceFileId: v.optional(v.id("_storage")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer");
    await assertRenterVisible(ctx, u, a.renterId);
    if (a.amount <= 0) fail("invalid_amount");
    if (!a.reference.trim()) fail("reference_required");
    const dupe = (await ctx.db.query("payments").withIndex("by_renter", (q) => q.eq("renterId", a.renterId)).collect())
      .find((p) => p.method === a.method && p.reference === a.reference && p.status !== "voided");
    if (dupe) fail("duplicate_payment_reference");
    const id = await ctx.db.insert("payments", { ...a, status: "recorded", recordedBy: u._id });
    await audit(ctx, u, "payment.record", "payments", id, `${a.amount}`);
    return id;
  },
});

/** Step 2: an authorised reviewer, not the person who recorded it, confirms receipt against bank/cash records. */
export const confirm = mutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const u = await requireRole(ctx, "approver");
    const p = (await ctx.db.get(paymentId)) ?? fail("not_found");
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status !== "recorded") fail("not_recorded");
    assertDifferentPerson(p.recordedBy, u._id);
    await ctx.db.patch(paymentId, { status: "confirmed", confirmedBy: u._id });
    await audit(ctx, u, "payment.confirm", "payments", paymentId);
  },
});

export const voidPayment = mutation({
  args: { paymentId: v.id("payments"), reason: v.string() },
  handler: async (ctx, { paymentId, reason }) => {
    const u = await requireRole(ctx, "approver");
    const p = (await ctx.db.get(paymentId)) ?? fail("not_found");
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status === "applied") fail("applied_payment_needs_reversal");
    if (p.status === "voided") fail("already_voided");
    if (!reason.trim()) fail("reason_required");
    await ctx.db.patch(paymentId, { status: "voided" });
    await audit(ctx, u, "payment.void", "payments", paymentId, reason);
  },
});

/**
 * Step 3: finance applies the confirmed amount to bills. With no explicit allocations the
 * oldest open bills are paid first; whatever is left is kept as renter credit.
 */
export const apply = mutation({
  args: { paymentId: v.id("payments"), allocations: v.optional(v.array(v.object({ invoiceId: v.id("invoices"), amount: v.number() }))) },
  handler: async (ctx, { paymentId, allocations }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const p = (await ctx.db.get(paymentId)) ?? fail("not_found");
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status !== "confirmed") fail("payment_not_confirmed");

    let plan: { invoiceId: Id<"invoices">; amount: number }[] = [];
    if (allocations) {
      for (const al of allocations) {
        const inv = (await ctx.db.get(al.invoiceId)) ?? fail("not_found");
        if (inv.renterId !== p.renterId || inv.status !== "issued") fail("invoice_not_payable");
        await assertUnitVisible(ctx, u, inv.unitId);
        const bal = await invoiceBalance(ctx, inv);
        if (al.amount <= 0 || al.amount > bal.due) fail("allocation_exceeds_balance");
      }
      plan = allocations;
      if (plan.reduce((s, x) => s + x.amount, 0) > p.amount) fail("allocation_exceeds_payment");
    } else {
      let left = p.amount;
      const open = (await ctx.db.query("invoices").withIndex("by_renter", (q) => q.eq("renterId", p.renterId)).collect())
        .filter((i) => i.status === "issued")
        .sort((a, b) => a.dueAt - b.dueAt);
      for (const inv of open) {
        if (left <= 0) break;
        const bal = await invoiceBalance(ctx, inv);
        if (bal.due <= 0) continue;
        const r = applyPayment(bal.due, left);
        if (r.applied > 0) plan.push({ invoiceId: inv._id, amount: r.applied });
        left = r.credit;
      }
    }
    for (const al of plan) await ctx.db.insert("paymentAllocations", { paymentId, invoiceId: al.invoiceId, amount: al.amount });
    const credit = p.amount - plan.reduce((s, x) => s + x.amount, 0);
    if (credit > 0) await ctx.db.insert("renterCredits", { renterId: p.renterId, paymentId, amount: credit });
    await ctx.db.patch(paymentId, { status: "applied" });
    await audit(ctx, u, "payment.apply", "payments", paymentId, `applied=${p.amount - credit} credit=${credit}`);

    // Receipt acknowledgment by SMS (once per payment).
    const key = `ack:${paymentId}`;
    if (!(await ctx.db.query("smsMessages").withIndex("by_dedupe", (q) => q.eq("dedupeKey", key)).first())) {
      await ctx.db.insert("smsMessages", { renterId: p.renterId, kind: "paymentAck", body: `Payment of ETB ${(p.amount / 100).toFixed(2)} received. Thank you.`, status: "queued", dedupeKey: key });
    }
    return { applied: p.amount - credit, credit };
  },
});

/** Use a renter's saved credit against a bill. */
export const useCredit = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const inv = (await ctx.db.get(invoiceId)) ?? fail("not_found");
    await assertUnitVisible(ctx, u, inv.unitId);
    if (inv.status !== "issued") fail("invoice_not_payable");
    const bal = await invoiceBalance(ctx, inv);
    const credit = await creditBalance(ctx, inv.renterId);
    const use = Math.min(bal.due, credit);
    if (use <= 0) fail("nothing_to_apply");
    await ctx.db.insert("renterCredits", { renterId: inv.renterId, invoiceId, amount: -use });
    await audit(ctx, u, "credit.use", "invoices", invoiceId, String(use));
    return use;
  },
});

export const list = query({
  args: { status: v.optional(v.union(v.literal("recorded"), v.literal("confirmed"), v.literal("applied"), v.literal("voided"))), renterId: v.optional(v.id("renters")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const rows = a.renterId
      ? await ctx.db.query("payments").withIndex("by_renter", (q) => q.eq("renterId", a.renterId!)).collect()
      : a.status
        ? await ctx.db.query("payments").withIndex("by_status", (q) => q.eq("status", a.status!)).collect()
        : await ctx.db.query("payments").collect();
    const out = [];
    for (const p of rows) {
      if (a.status && p.status !== a.status) continue;
      try { await assertRenterVisible(ctx, u, p.renterId); } catch { continue; }
      const renter = await ctx.db.get(p.renterId);
      out.push({ ...p, renterName: renter?.name ?? "", evidenceUrl: p.evidenceFileId ? await ctx.storage.getUrl(p.evidenceFileId) : null });
    }
    return out.sort((x, y) => y.receivedAt - x.receivedAt);
  },
});

export const credit = query({
  args: { renterId: v.id("renters") },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertRenterVisible(ctx, u, renterId);
    return creditBalance(ctx, renterId);
  },
});
