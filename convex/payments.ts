import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { READ_ROLES, assertDifferentPerson, assertSantim, audit, canSeeBuilding, fail, nextSeq, requireRole } from "./lib/access";
import { inOrg, owned } from "./lib/tenant";
import { applyPayment } from "./lib/billing";
import { formatEtb } from "./lib/money";
import { creditBalance, invoiceBalance, refreshInvoice } from "./lib/ledger";
import { renterMap } from "./lib/bulk";
import { periodRange } from "./lib/period";
import { assertRenterVisible, assertUnitVisible } from "./lib/scope";
import { assertUploadOk } from "./files";
import { queueTemplated, smsRules } from "./lib/sms";
import { smsMoney } from "./lib/smsTemplates";

const method = v.union(v.literal("bankDeposit"), v.literal("transfer"), v.literal("telebirr"), v.literal("cbeBirr"), v.literal("cash"));

/** Step 1: staff record the payment and its evidence. Nothing is reduced yet. */
export const record = mutation({
  args: { renterId: v.id("renters"), amount: v.number(), method, reference: v.string(), receivedAt: v.number(), evidenceFileId: v.optional(v.id("_storage")), payerName: v.optional(v.string()), notes: v.optional(v.string()), notDuplicate: v.optional(v.boolean()) },
  handler: async (ctx, { notDuplicate, ...a }) => {
    const u = await requireRole(ctx, "financeOfficer");
    await assertRenterVisible(ctx, u, a.renterId);
    assertSantim(a.amount);
    if (a.evidenceFileId) await assertUploadOk(ctx, a.evidenceFileId);
    if (!a.reference.trim()) fail("reference_required");
    // A bank or Telebirr reference identifies one transfer in the whole mall, whichever renter it is booked to.
    const dupe = (await ctx.db.query("payments").withIndex("by_reference", (q) => q.eq("orgId", u.orgId).eq("method", a.method).eq("reference", a.reference)).collect())
      .find((p) => p.status !== "voided");
    if (dupe) fail("duplicate_payment_reference");
    // The same renter paying the same amount within two weeks is more often the same money recorded twice (cash, then its
    // bank deposit) than a second payment. The person has to say it is a different payment.
    if (!notDuplicate && (await similarPayments(ctx, a.renterId, a.amount, a.receivedAt)).length > 0) fail("possible_duplicate");
    const clean = (x?: string) => (x && x.trim() ? x.trim() : undefined);
    const id = await ctx.db.insert("payments", { orgId: u.orgId, ...a, reference: a.reference.trim(), payerName: clean(a.payerName), notes: clean(a.notes), status: "recorded", recordedBy: u._id });
    await audit(ctx, u, "payment.record", "payments", id, `${a.amount}`);
    return id;
  },
});

/** Step 2: an authorised reviewer, not the person who recorded it, confirms receipt against bank/cash records. */
export const confirm = mutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const u = await requireRole(ctx, "approver");
    const p = await owned(ctx, u.orgId, paymentId);
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status !== "recorded") fail("not_recorded");
    assertDifferentPerson(p.recordedBy, u._id);
    await ctx.db.patch(paymentId, { status: "confirmed", confirmedBy: u._id, confirmedAt: Date.now() });
    await audit(ctx, u, "payment.confirm", "payments", paymentId);
  },
});

export const voidPayment = mutation({
  args: { paymentId: v.id("payments"), reason: v.string() },
  handler: async (ctx, { paymentId, reason }) => {
    const u = await requireRole(ctx, "approver");
    const p = await owned(ctx, u.orgId, paymentId);
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status === "applied") fail("applied_payment_needs_reversal"); // use reverse(), which keeps the trail
    if (p.status === "voided") fail("already_voided");
    if (!reason.trim()) fail("reason_required");
    await ctx.db.patch(paymentId, { status: "voided", voidedBy: u._id, voidedAt: Date.now(), voidReason: reason.trim() });
    // A bank line that was matched to this payment goes back to the to-do list: the money is still in the bank, with no payment behind it.
    for (const line of await ctx.db.query("bankStatementEntries").withIndex("by_payment", (q) => q.eq("matchedPaymentId", paymentId)).collect()) await ctx.db.patch(line._id, { matchedPaymentId: undefined, matchedBy: undefined, matchedAt: undefined });
    await audit(ctx, u, "payment.void", "payments", paymentId, reason);
  },
});

/**
 * Undo a payment that was applied by mistake (wrong renter, a bounced deposit). The money's trail stays: matching negative rows are added,
 * nothing is deleted, so the receipt and the history still tell the whole story. Credit that came from the payment must still be unspent.
 */
export const reverse = mutation({
  args: { paymentId: v.id("payments"), reason: v.string() },
  handler: async (ctx, { paymentId, reason }) => {
    const u = await requireRole(ctx, "approver");
    const p = await owned(ctx, u.orgId, paymentId);
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status !== "applied") fail("not_applied");
    if (!reason.trim()) fail("reason_required");
    const allocs = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).collect();
    const credits = (await ctx.db.query("renterCredits").withIndex("by_renter", (q) => q.eq("renterId", p.renterId)).collect()).filter((c) => c.paymentId === paymentId);
    const fromThisPayment = credits.reduce((s, c) => s + c.amount, 0);
    if (fromThisPayment > 0 && (await creditBalance(ctx, p.renterId)) < fromThisPayment) fail("credit_already_used");
    for (const a of allocs) { await ctx.db.insert("paymentAllocations", { orgId: u.orgId, paymentId, invoiceId: a.invoiceId, amount: -a.amount }); await refreshInvoice(ctx, a.invoiceId); }
    if (fromThisPayment !== 0) await ctx.db.insert("renterCredits", { orgId: u.orgId, renterId: p.renterId, paymentId, amount: -fromThisPayment });
    await ctx.db.patch(paymentId, { status: "voided", voidedBy: u._id, voidedAt: Date.now(), voidReason: `Reversed: ${reason.trim()}` });
    for (const line of await ctx.db.query("bankStatementEntries").withIndex("by_payment", (q) => q.eq("matchedPaymentId", paymentId)).collect()) await ctx.db.patch(line._id, { matchedPaymentId: undefined, matchedBy: undefined, matchedAt: undefined });
    await audit(ctx, u, "payment.reverse", "payments", paymentId, reason.trim());
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
    const p = await owned(ctx, u.orgId, paymentId);
    await assertRenterVisible(ctx, u, p.renterId);
    if (p.status !== "confirmed") fail("payment_not_confirmed");

    let plan: { invoiceId: Id<"invoices">; amount: number }[] = [];
    if (allocations) {
      // total per invoice, so repeating an invoice id cannot be used to over-apply
      const perInvoice = new Map<string, number>();
      for (const al of allocations) perInvoice.set(al.invoiceId, (perInvoice.get(al.invoiceId) ?? 0) + al.amount);
      for (const al of allocations) {
        assertSantim(al.amount);
        const inv = await owned(ctx, u.orgId, al.invoiceId);
        if (inv.renterId !== p.renterId || inv.status !== "issued") fail("invoice_not_payable");
        await assertUnitVisible(ctx, u, inv.unitId);
        const bal = await invoiceBalance(ctx, inv);
        if ((perInvoice.get(al.invoiceId) ?? 0) > bal.due) fail("allocation_exceeds_balance");
      }
      plan = allocations;
      if (plan.reduce((s, x) => s + x.amount, 0) > p.amount) fail("allocation_exceeds_payment");
    } else {
      let left = p.amount;
      const candidates = (await ctx.db.query("invoices").withIndex("by_renter", (q) => q.eq("renterId", p.renterId)).collect())
        .filter((i) => i.status === "issued")
        .sort((a, b) => a.dueAt - b.dueAt);
      // only bills in buildings this user may see: money cannot be moved onto another building's bills
      const open = [];
      for (const i of candidates) { const un = await ctx.db.get(i.unitId); if (un && canSeeBuilding(u, un.buildingId)) open.push(i); }
      for (const inv of open) {
        if (left <= 0) break;
        const bal = await invoiceBalance(ctx, inv);
        if (bal.due <= 0) continue;
        const r = applyPayment(bal.due, left);
        if (r.applied > 0) plan.push({ invoiceId: inv._id, amount: r.applied });
        left = r.credit;
      }
    }
    for (const al of plan) {
      await ctx.db.insert("paymentAllocations", { orgId: u.orgId, paymentId, invoiceId: al.invoiceId, amount: al.amount });
      await refreshInvoice(ctx, al.invoiceId);
    }
    const credit = p.amount - plan.reduce((s, x) => s + x.amount, 0);
    if (credit > 0) await ctx.db.insert("renterCredits", { orgId: u.orgId, renterId: p.renterId, paymentId, amount: credit });
    const year = new Date(p.receivedAt).getUTCFullYear();
    const receiptNumber = p.receiptNumber ?? `RCT-${year}-${String(await nextSeq(ctx, u.orgId, `receiptSeq:${year}`)).padStart(4, "0")}`;
    await ctx.db.patch(paymentId, { status: "applied", receiptNumber, appliedBy: u._id, appliedAt: Date.now() });
    await audit(ctx, u, "payment.apply", "payments", paymentId, `applied=${p.amount - credit} credit=${credit}`);

    // Receipt acknowledgment by SMS (once per payment), in the renter's language, unless receipts are switched off in Settings.
    if ((await smsRules(ctx, u.orgId)).receipts) {
      const renter = await ctx.db.get(p.renterId);
      await queueTemplated(ctx, { orgId: u.orgId, renterId: p.renterId, template: "paymentReceived", dedupeKey: `ack:${paymentId}`, renter, vars: { amount: smsMoney(p.amount), receipt: receiptNumber } });
    }
    return { applied: p.amount - credit, credit };
  },
});

/** Use a renter's saved credit against a bill. */
export const useCredit = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const inv = await owned(ctx, u.orgId, invoiceId);
    await assertUnitVisible(ctx, u, inv.unitId);
    if (inv.status !== "issued") fail("invoice_not_payable");
    const bal = await invoiceBalance(ctx, inv);
    const credit = await creditBalance(ctx, inv.renterId);
    const use = Math.min(bal.due, credit);
    if (use <= 0) fail("nothing_to_apply");
    await ctx.db.insert("renterCredits", { orgId: u.orgId, renterId: inv.renterId, invoiceId, amount: -use });
    await refreshInvoice(ctx, invoiceId);
    await audit(ctx, u, "credit.use", "invoices", invoiceId, String(use));
    return use;
  },
});

export const list = query({
  args: { status: v.optional(v.union(v.literal("recorded"), v.literal("confirmed"), v.literal("applied"), v.literal("voided"))), renterId: v.optional(v.id("renters")) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    // newest 300 when not narrowed to one renter, so the list stays quick as years of payments pile up
    const rows = a.renterId
      ? await ctx.db.query("payments").withIndex("by_renter", (q) => q.eq("renterId", a.renterId!)).collect()
      : a.status
        ? await ctx.db.query("payments").withIndex("by_status", (q) => q.eq("orgId", u.orgId).eq("status", a.status!)).order("desc").take(300)
        : await inOrg(ctx, "payments", u.orgId).order("desc").take(300);
    const out = [];
    for (const p of rows) {
      if (a.status && p.status !== a.status) continue;
      try { await assertRenterVisible(ctx, u, p.renterId); } catch { continue; }
      const renter = await ctx.db.get(p.renterId);
      out.push({ ...p, renterName: renter?.name ?? "", hasEvidence: !!p.evidenceFileId });
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

/** Everything a printed receipt needs. */
export const get = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const p = await owned(ctx, u.orgId, paymentId);
    await assertRenterVisible(ctx, u, p.renterId);
    const allocs = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).collect();
    const lines = [];
    for (const a of allocs) {
      const inv = await ctx.db.get(a.invoiceId);
      const unit = inv ? await ctx.db.get(inv.unitId) : null;
      lines.push({ invoiceNumber: inv?.number ?? "", period: inv?.period ?? "", unitNumber: unit?.number ?? "", amount: a.amount });
    }
    const credit = (await ctx.db.query("renterCredits").withIndex("by_renter", (q) => q.eq("renterId", p.renterId)).collect()).filter((c) => c.paymentId === paymentId).reduce((s, c) => s + c.amount, 0);
    const receivedBy = (await ctx.db.get(p.confirmedBy ?? p.recordedBy))?.name ?? "";
    const name = async (id?: Id<"users">) => (id ? (await ctx.db.get(id))?.name ?? "" : undefined);
    const line = await ctx.db.query("bankStatementEntries").withIndex("by_payment", (q) => q.eq("matchedPaymentId", paymentId)).first();
    const timeline = {
      recordedByName: await name(p.recordedBy), recordedAt: p._creationTime, confirmedByName: await name(p.confirmedBy), confirmedAt: p.confirmedAt,
      appliedByName: await name(p.appliedBy), appliedAt: p.appliedAt, voidedByName: await name(p.voidedBy), voidedAt: p.voidedAt, voidReason: p.voidReason,
    };
    return { payment: p, renter: await ctx.db.get(p.renterId), lines, credit, confirmedByName: receivedBy, timeline, hasEvidence: !!p.evidenceFileId, bankLine: line ? { description: line.description, reference: line.reference, batch: line.importBatch, postedAt: line.postedAt } : null };
  },
});

/** Every payment received in one month (by date, not just the newest 300), for the month-end pack. */
export const inPeriod = query({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const { start, end } = periodRange(period);
    const rows = await ctx.db.query("payments").withIndex("by_received", (q) => q.eq("orgId", u.orgId).gte("receivedAt", start).lt("receivedAt", end)).collect();
    const renters = await renterMap(ctx, u.orgId);
    const out = await Promise.all(rows.map(async (p) => {
      try { await assertRenterVisible(ctx, u, p.renterId); } catch { return null; }
      return { ...p, renterName: renters.get(p.renterId)?.name ?? "" };
    }));
    return out.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.receivedAt - a.receivedAt);
  },
});

/** The renter's open bills, oldest first: what a payment can be applied to. */
export const openBills = query({
  args: { renterId: v.id("renters") },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertRenterVisible(ctx, u, renterId);
    const all = (await ctx.db.query("invoices").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect()).filter((i) => i.status === "issued");
    const out = [];
    for (const inv of all) {
      const unit = await ctx.db.get(inv.unitId);
      if (!unit || !canSeeBuilding(u, unit.buildingId)) continue;
      const bal = await invoiceBalance(ctx, inv);
      if (bal.due > 0) out.push({ invoiceId: inv._id, number: inv.number, period: inv.period, unitNumber: unit.number, dueAt: inv.dueAt, due: bal.due });
    }
    return out.sort((a, b) => a.dueAt - b.dueAt);
  },
});

/** Counts and amounts by status for payments received in a date range (all time when none is given). */
export const summary = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { from, to }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const rows = await ctx.db.query("payments").withIndex("by_received", (q) => { const o = q.eq("orgId", u.orgId); return from !== undefined && to !== undefined ? o.gte("receivedAt", from).lt("receivedAt", to) : from !== undefined ? o.gte("receivedAt", from) : to !== undefined ? o.lt("receivedAt", to) : o; }).order("desc").take(5000);
    const seen = new Map<string, boolean>();
    const out = { recorded: { n: 0, amount: 0 }, confirmed: { n: 0, amount: 0 }, applied: { n: 0, amount: 0 }, voided: { n: 0, amount: 0 } };
    for (const p of rows) {
      let ok = seen.get(p.renterId);
      if (ok === undefined) { try { await assertRenterVisible(ctx, u, p.renterId); ok = true; } catch { ok = false; } seen.set(p.renterId, ok); }
      if (!ok) continue;
      out[p.status].n++; out[p.status].amount += p.amount;
    }
    return { ...out, capped: rows.length >= 5000 };
  },
});

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
async function similarPayments(ctx: QueryCtx, renterId: Id<"renters">, amount: number, receivedAt: number) {
  const mine = await ctx.db.query("payments").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
  return mine.filter((p) => p.status !== "voided" && p.amount === amount && Math.abs(p.receivedAt - receivedAt) <= TWO_WEEKS);
}

/** Payments that look like the one about to be recorded: same renter, same amount, within two weeks. */
export const possibleDuplicates = query({
  args: { renterId: v.id("renters"), amount: v.number(), receivedAt: v.number() },
  handler: async (ctx, { renterId, amount, receivedAt }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertRenterVisible(ctx, u, renterId);
    const rows = await similarPayments(ctx, renterId, amount, receivedAt);
    return rows.map((p) => ({ paymentId: p._id, method: p.method, reference: p.reference, receivedAt: p.receivedAt, status: p.status }));
  },
});
