import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { READ_ROLES, assertDifferentPerson, assertPeriod, assertSantim, audit, canSeeBuilding, fail, getSetting, nextSeq, requireRole } from "./lib/access";
import { escalatedRent, monthlyRent } from "./lib/billing";
import { invoiceBalance, refreshInvoice, termAt } from "./lib/ledger";
import { etb, formatEtb } from "./lib/money";
import { coveredDays, periodRange } from "./lib/period";
import { assertUnitVisible } from "./lib/scope";

const DAY = 86_400_000;
const lineKind = v.union(v.literal("rent"), v.literal("water"), v.literal("electricity"), v.literal("generator"), v.literal("security"), v.literal("cleaning"), v.literal("other"));

/**
 * Prepare DRAFT bills for a period from approved agreements, readings and shared costs.
 * Safe to re-run: an agreement+period that already has a bill is left alone.
 */
export const generate = mutation({
  args: { period: v.string(), buildingId: v.optional(v.id("buildings")), batch: v.optional(v.number()) },
  handler: async (ctx, { period, buildingId, batch }) => {
    const u = await requireRole(ctx, "financeOfficer");
    assertPeriod(period);
    // A large mall is billed in batches of this many bills per call (the screen keeps calling until done=true).
    const limit = Math.max(1, Math.min(batch ?? 150, 300));
    let done = true;
    const { start, end, days } = periodRange(period);
    if (start > Date.now() + 31 * 86_400_000) fail("period_in_future");
    const tariffElectricity = await getSetting(ctx, "tariff.electricity", etb(6));
    const tariffWater = await getSetting(ctx, "tariff.water", 0);

    const agreements = (await ctx.db.query("agreements").collect()).filter((a) => a.status === "active" || a.status === "expired" || a.status === "terminated");
    const created: string[] = [];
    const skipped: { agreementId: string; reason: string }[] = [];

    for (const ag of agreements) {
      if (created.length >= limit) { done = false; break; }
      const unit = await ctx.db.get(ag.unitId);
      if (!unit || !canSeeBuilding(u, unit.buildingId)) continue;
      if (buildingId && unit.buildingId !== buildingId) continue;
      const covered = coveredDays(period, ag.startsAt, ag.endsAt);
      if (covered === 0) continue;
      const exists = await ctx.db.query("invoices").withIndex("by_agreement_period", (q) => q.eq("agreementId", ag._id).eq("period", period)).first();
      if (exists) continue;

      const terms = await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", ag._id)).collect();
      const term = termAt(terms, Math.max(start, ag.startsAt));
      if (!term) {
        skipped.push({ agreementId: ag._id, reason: "missing_terms" });
        continue;
      }

      const lines: Omit<Doc<"invoiceLines">, "_id" | "_creationTime" | "invoiceId">[] = [];
      const base = monthlyRent(term.rent.kind === "fixed" ? { kind: "fixed", amount: term.rent.amount } : { kind: "perM2", areaM2: unit.areaM2, ratePerM2: term.rent.ratePerM2 });
      const esc = escalatedRent(base, term.escalation, term.effectiveFrom, start);
      const monthly = esc.amount;
      const basis0 = term.rent.kind === "fixed" ? `fixed ${formatEtb(base)}` : `${unit.areaM2} m² × ${formatEtb(term.rent.ratePerM2)} = ${formatEtb(base)}`;
      const basis = esc.steps > 0 && term.escalation ? `${basis0}; +${term.escalation.percent}% × ${esc.steps} = ${formatEtb(monthly)}` : basis0;
      const rentAmount = covered === days ? monthly : Math.round((monthly * covered) / days);
      lines.push({ kind: "rent", description: `Rent ${period}`, amount: rentAmount, calcNote: covered === days ? basis : `${basis}; ${covered}/${days} days = ${formatEtb(rentAmount)}` });

      // Utilities and shared costs belong to the unit, not the lease. When two leases share a period only the later one carries them,
      // so the same electricity or generator share is never billed twice.
      const sameUnit = await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", unit._id)).collect();
      const supersededByLater = sameUnit.some((o) => o._id !== ag._id && (o.status === "active" || o.status === "expired" || o.status === "terminated") && o.startsAt > ag.startsAt && coveredDays(period, o.startsAt, o.endsAt) > 0);
      const meters = supersededByLater ? [] : await ctx.db.query("meters").withIndex("by_unit", (q) => q.eq("unitId", unit._id)).collect();
      for (const m of meters) {
        const readings = (await ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", m._id)).collect()).filter((r) => r.status === "approved");
        const inPeriod = readings.filter((r) => r.readAt >= start && r.readAt < end);
        if (inPeriod.length === 0) continue;
        const before = readings.filter((r) => r.readAt < start).at(-1);
        const seq = before ? [before, ...inPeriod] : inPeriod;
        let usage = 0;
        for (let i = 1; i < seq.length; i++) if (!seq[i]!.isReset) usage += seq[i]!.value - seq[i - 1]!.value;
        const tariff = m.kind === "electricity" ? tariffElectricity : tariffWater;
        if (usage > 0 && tariff > 0) {
          const amount = Math.round(usage * tariff);
          lines.push({ kind: m.kind, description: `${m.kind === "electricity" ? "Electricity" : "Water"} ${period}`, amount, calcNote: `${usage} × ${formatEtb(tariff)} = ${formatEtb(amount)}` });
        }
      }

      // Shared costs approved for this building and period.
      const costs = supersededByLater ? [] : (await ctx.db.query("sharedCosts").withIndex("by_building_period", (q) => q.eq("buildingId", unit.buildingId).eq("period", period)).collect()).filter((c) => c.approvedBy);
      for (const c of costs) {
        const alloc = await ctx.db.query("sharedCostAllocations").withIndex("by_cost_unit", (q) => q.eq("sharedCostId", c._id).eq("unitId", unit._id)).first();
        if (alloc && alloc.amount > 0) lines.push({ kind: c.kind, description: `${c.kind} ${period}`, amount: alloc.amount, calcNote: `share of ${formatEtb(c.total)} by ${c.basis}` });
      }

      const total = lines.reduce((s, l) => s + l.amount, 0);
      const dueAt = start + (term.dueDay - 1) * DAY;
      const invoiceId = await ctx.db.insert("invoices", { number: "", agreementId: ag._id, unitId: unit._id, buildingId: unit.buildingId, renterId: ag.renterId, period, status: "draft", total, dueAt });
      for (const l of lines) await ctx.db.insert("invoiceLines", { ...l, invoiceId });
      created.push(invoiceId);
    }
    await audit(ctx, u, "billing.generate", "invoices", period, `created=${created.length} skipped=${skipped.length}`);
    return { created: created.length, skipped, done };
  },
});

async function recomputeTotal(ctx: Parameters<typeof invoiceBalance>[0] & { db: any }, invoiceId: Doc<"invoices">["_id"]) {
  const lines = await ctx.db.query("invoiceLines").withIndex("by_invoice", (q: any) => q.eq("invoiceId", invoiceId)).collect();
  return (lines as Doc<"invoiceLines">[]).reduce((s, l) => s + l.amount, 0);
}

export const addDraftLine = mutation({
  args: { invoiceId: v.id("invoices"), kind: lineKind, description: v.string(), amount: v.number(), calcNote: v.string() },
  handler: async (ctx, { invoiceId, ...line }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const inv = (await ctx.db.get(invoiceId)) ?? fail("not_found");
    await assertUnitVisible(ctx, u, inv.unitId);
    if (inv.status !== "draft") fail("invoice_already_issued");
    // Manual lines can only add charges. Discounts go through an approved correction, so no one can quietly reduce a renter's bill.
    assertSantim(line.amount);
    await ctx.db.insert("invoiceLines", { invoiceId, ...line });
    await ctx.db.patch(invoiceId, { total: await recomputeTotal(ctx as any, invoiceId) });
    await audit(ctx, u, "invoice.addLine", "invoices", invoiceId, line.description);
  },
});

export const discardDraft = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const inv = (await ctx.db.get(invoiceId)) ?? fail("not_found");
    await assertUnitVisible(ctx, u, inv.unitId);
    if (inv.status !== "draft") fail("invoice_already_issued");
    for (const l of await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect()) await ctx.db.delete(l._id);
    await ctx.db.delete(invoiceId);
    await audit(ctx, u, "invoice.discard", "invoices", invoiceId);
  },
});

/** Issuing assigns the number and freezes the bill. */
export const issue = mutation({
  args: { invoiceIds: v.array(v.id("invoices")) },
  handler: async (ctx, { invoiceIds }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const numbers: string[] = [];
    for (const id of invoiceIds) {
      const inv = (await ctx.db.get(id)) ?? fail("not_found");
      await assertUnitVisible(ctx, u, inv.unitId);
      if (inv.status !== "draft") continue;
      if (inv.total <= 0) fail("zero_total_needs_review");
      const n = await nextSeq(ctx, `invoiceSeq:${inv.period}`);
      const number = `INV-${inv.period}-${String(n).padStart(4, "0")}`;
      await ctx.db.patch(id, { status: "issued", number, issuedBy: u._id, issuedAt: Date.now(), buildingId: (await ctx.db.get(inv.unitId))?.buildingId });
      await refreshInvoice(ctx, id);
      await audit(ctx, u, "invoice.issue", "invoices", id, number);
      numbers.push(number);
    }
    return numbers;
  },
});

/** Issued bills never change; an approved adjustment records the reason and the revised balance. */
export const requestAdjustment = mutation({
  args: { invoiceId: v.id("invoices"), delta: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer");
    const inv = (await ctx.db.get(a.invoiceId)) ?? fail("not_found");
    await assertUnitVisible(ctx, u, inv.unitId);
    if (inv.status !== "issued") fail("only_issued_invoices");
    if (!a.reason.trim()) fail("reason_and_amount_required");
    assertSantim(a.delta, { allowNegative: true });
    if (a.delta === 0) fail("reason_and_amount_required");
    const id = await ctx.db.insert("invoiceAdjustments", { invoiceId: a.invoiceId, delta: a.delta, reason: a.reason, requestedBy: u._id });
    await audit(ctx, u, "invoice.adjustRequest", "invoices", a.invoiceId, a.reason);
    return id;
  },
});

export const approveAdjustment = mutation({
  args: { adjustmentId: v.id("invoiceAdjustments") },
  handler: async (ctx, { adjustmentId }) => {
    const u = await requireRole(ctx, "approver");
    const adj = (await ctx.db.get(adjustmentId)) ?? fail("not_found");
    const inv = (await ctx.db.get(adj.invoiceId)) ?? fail("not_found");
    await assertUnitVisible(ctx, u, inv.unitId);
    if (adj.approvedBy) fail("already_approved");
    assertDifferentPerson(adj.requestedBy, u._id);
    await ctx.db.patch(adjustmentId, { approvedBy: u._id });
    await refreshInvoice(ctx, adj.invoiceId);
    await audit(ctx, u, "invoice.adjustApprove", "invoices", adj.invoiceId, String(adj.delta));
  },
});

export const pendingAdjustments = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, "approver", "financeOfficer", "auditor");
    const rows = (await ctx.db.query("invoiceAdjustments").collect()).filter((a) => !a.approvedBy);
    const out = [];
    for (const a of rows) {
      const inv = await ctx.db.get(a.invoiceId);
      if (inv && (await ctx.db.get(inv.unitId).then((x) => x && canSeeBuilding(u, x.buildingId)))) out.push({ ...a, invoiceNumber: inv.number });
    }
    return out;
  },
});

export const list = query({
  args: { period: v.optional(v.string()), status: v.optional(v.union(v.literal("draft"), v.literal("issued"))), renterId: v.optional(v.id("renters")), openOnly: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const rows = a.period
      ? await ctx.db.query("invoices").withIndex("by_period", (q) => q.eq("period", a.period!)).collect()
      : a.renterId
        ? await ctx.db.query("invoices").withIndex("by_renter", (q) => q.eq("renterId", a.renterId!)).collect()
        : await ctx.db.query("invoices").order("desc").take(300); // newest first; ask for a period to see more
    const out = [];
    for (const inv of rows) {
      if (a.status && inv.status !== a.status) continue;
      if (a.renterId && inv.renterId !== a.renterId) continue;
      const unit = await ctx.db.get(inv.unitId);
      if (!unit || !canSeeBuilding(u, unit.buildingId)) continue;
      const bal = await invoiceBalance(ctx, inv);
      if (a.openOnly && (inv.status !== "issued" || bal.due <= 0)) continue;
      const renter = await ctx.db.get(inv.renterId);
      out.push({ ...inv, buildingId: unit.buildingId, unitNumber: unit.number, renterName: renter?.name ?? "", ...bal, payStatus: inv.status === "draft" ? "draft" : bal.due <= 0 ? "paid" : bal.paid + bal.creditUsed > 0 ? "partial" : "outstanding" });
    }
    return out;
  },
});

export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const inv = (await ctx.db.get(invoiceId)) ?? fail("not_found");
    const unit = await assertUnitVisible(ctx, u, inv.unitId);
    const lines = await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
    const adjustments = await ctx.db.query("invoiceAdjustments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
    const allocations = await ctx.db.query("paymentAllocations").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
    return { invoice: inv, unit, renter: await ctx.db.get(inv.renterId), lines, adjustments, allocations, balance: await invoiceBalance(ctx, inv) };
  },
});
