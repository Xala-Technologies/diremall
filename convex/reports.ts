import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { READ_ROLES, assertBuilding, canSeeBuilding, requireRole } from "./lib/access";
import { ageArrears, monthlyRent } from "./lib/billing";
import { invoiceBalance, termAt } from "./lib/ledger";
import { periodRange } from "./lib/period";
import { assertRenterVisible } from "./lib/scope";

const DAY = 86_400_000;

async function scopedUnits(ctx: QueryCtx, u: Doc<"users">, buildingId?: Id<"buildings">) {
  if (buildingId) assertBuilding(u, buildingId);
  const units = await ctx.db.query("units").collect();
  return units.filter((x) => canSeeBuilding(u, x.buildingId) && (!buildingId || x.buildingId === buildingId));
}

async function scopedInvoices(ctx: QueryCtx, u: Doc<"users">, buildingId?: Id<"buildings">) {
  const unitIds = new Set((await scopedUnits(ctx, u, buildingId)).map((x) => x._id));
  return (await ctx.db.query("invoices").collect()).filter((i) => unitIds.has(i.unitId));
}

/** Headline figures. Every total here is built from the same balance function the bill screens use. */
export const dashboard = query({
  args: { period: v.string(), buildingId: v.optional(v.id("buildings")) },
  handler: async (ctx, { period, buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const { start, end } = periodRange(period);
    const units = await scopedUnits(ctx, u, buildingId);
    const buildings = new Set(units.map((x) => x.buildingId));
    const unitIds = new Set(units.map((x) => x._id));
    const occupied = units.filter((x) => x.status === "occupied").length;

    const invoices = (await scopedInvoices(ctx, u, buildingId)).filter((i) => i.status === "issued");
    let billed = 0, outstanding = 0, overdue = 0;
    for (const i of invoices) {
      const b = await invoiceBalance(ctx, i);
      if (i.period === period) { billed += b.total + b.adjustments; outstanding += Math.max(0, b.due); }
      if (b.due > 0 && i.dueAt < Date.now()) overdue += b.due;
    }

    const renterOk = async (id: Id<"renters">) => { try { await assertRenterVisible(ctx, u, id); return true; } catch { return false; } };
    const payments = (await ctx.db.query("payments").collect()).filter((p) => p.receivedAt >= start && p.receivedAt < end);
    let confirmed = 0, applied = 0, waiting = 0;
    for (const p of payments) {
      if (p.status !== "confirmed" && p.status !== "applied") continue;
      if (!(await renterOk(p.renterId))) continue;
      confirmed += p.amount;
      if (p.status === "confirmed") waiting += p.amount;
      const al = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentId", p._id)).collect();
      applied += al.reduce((s, x) => s + x.amount, 0);
    }

    const deposits = (await ctx.db.query("deposits").collect());
    let depositsHeld = 0;
    for (const d of deposits) {
      const ag = await ctx.db.get(d.agreementId);
      if (ag && unitIds.has(ag.unitId)) depositsHeld += d.held - d.deductions.filter((x) => x.approvedBy).reduce((s, x) => s + x.amount, 0) - d.refunded;
    }

    const horizon = Date.now() + 60 * DAY;
    const agreements = await ctx.db.query("agreements").collect();
    const inScope = agreements.filter((a) => unitIds.has(a.unitId));
    const attention = {
      draftInvoices: (await scopedInvoices(ctx, u, buildingId)).filter((i) => i.status === "draft").length,
      paymentsToConfirm: payments.filter((p) => p.status === "recorded").length,
      paymentsToApply: payments.filter((p) => p.status === "confirmed").length,
      agreementsInReview: inScope.filter((a) => a.status === "inReview").length,
      expiringAgreements: inScope.filter((a) => a.status === "active" && a.endsAt <= horizon).length,
    };

    return {
      buildings: buildings.size, units: units.length, occupied, occupancyRate: units.length ? occupied / units.length : 0,
      billed, confirmedPayments: confirmed, appliedToBills: applied, waitingToApply: waiting, outstanding, overdue, depositsHeld,
      collectionRate: billed ? Math.min(1, applied / billed) : 0, attention,
    };
  },
});

export const rentRoll = query({
  args: { buildingId: v.optional(v.id("buildings")) },
  handler: async (ctx, { buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const units = await scopedUnits(ctx, u, buildingId);
    const rows = [];
    for (const unit of units) {
      const ag = (await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", unit._id).eq("status", "active")).first());
      let renter = null, rent = 0;
      if (ag) {
        renter = await ctx.db.get(ag.renterId);
        const terms = await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", ag._id)).collect();
        const t = termAt(terms, Date.now());
        if (t) rent = monthlyRent(t.rent.kind === "fixed" ? { kind: "fixed", amount: t.rent.amount } : { kind: "perM2", areaM2: unit.areaM2, ratePerM2: t.rent.ratePerM2 });
      }
      rows.push({ buildingId: unit.buildingId, unitNumber: unit.number, category: unit.category, areaM2: unit.areaM2, status: unit.status, renterName: renter?.name ?? "", startsAt: ag?.startsAt ?? null, endsAt: ag?.endsAt ?? null, monthlyRent: rent });
    }
    return { rows, totalMonthlyRent: rows.reduce((s, r) => s + r.monthlyRent, 0) };
  },
});

export const vacancy = query({
  args: { buildingId: v.optional(v.id("buildings")) },
  handler: async (ctx, { buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const units = (await scopedUnits(ctx, u, buildingId)).filter((x) => x.status !== "occupied");
    const rows = units.map((x) => ({ unitNumber: x.number, buildingId: x.buildingId, category: x.category, areaM2: x.areaM2, status: x.status, potentialRent: monthlyRent({ kind: "perM2", areaM2: x.areaM2, ratePerM2: x.ratePerM2 }) }));
    return { rows, totalPotentialRent: rows.filter((r) => r.status === "vacant").reduce((s, r) => s + r.potentialRent, 0) };
  },
});

export const aging = query({
  args: { asOf: v.optional(v.number()), buildingId: v.optional(v.id("buildings")) },
  handler: async (ctx, { asOf, buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const now = asOf ?? Date.now();
    const invoices = (await scopedInvoices(ctx, u, buildingId)).filter((i) => i.status === "issued");
    const byRenter = new Map<string, { renterName: string; unitNumbers: Set<string>; items: { due: number; daysOverdue: number }[] }>();
    const items: { due: number; daysOverdue: number }[] = [];
    for (const i of invoices) {
      const b = await invoiceBalance(ctx, i);
      if (b.due <= 0) continue;
      const days = Math.floor((now - i.dueAt) / DAY);
      const unit = await ctx.db.get(i.unitId);
      const renter = await ctx.db.get(i.renterId);
      const entry = byRenter.get(i.renterId) ?? { renterName: renter?.name ?? "", unitNumbers: new Set<string>(), items: [] };
      entry.unitNumbers.add(unit?.number ?? "");
      entry.items.push({ due: b.due, daysOverdue: days });
      byRenter.set(i.renterId, entry);
      items.push({ due: b.due, daysOverdue: days });
    }
    const rows = [...byRenter.entries()].map(([renterId, e]) => ({ renterId, renterName: e.renterName, units: [...e.unitNumbers].join(", "), ...ageArrears(e.items) }));
    return { rows, totals: ageArrears(items) };
  },
});

/** Everything a renter owes or has paid, in date order, with a running balance. */
export const tenantLedger = query({
  args: { renterId: v.id("renters") },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertRenterVisible(ctx, u, renterId);
    const entries: { at: number; kind: string; ref: string; debit: number; credit: number }[] = [];
    const invoices = (await ctx.db.query("invoices").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect()).filter((i) => i.status === "issued");
    for (const i of invoices) {
      entries.push({ at: i.issuedAt ?? i._creationTime, kind: "invoice", ref: i.number, debit: i.total, credit: 0 });
      for (const a of (await ctx.db.query("invoiceAdjustments").withIndex("by_invoice", (q) => q.eq("invoiceId", i._id)).collect()).filter((x) => x.approvedBy))
        entries.push({ at: a._creationTime, kind: "adjustment", ref: i.number, debit: Math.max(0, a.delta), credit: Math.max(0, -a.delta) });
      for (const c of await ctx.db.query("renterCredits").withIndex("by_invoice", (q) => q.eq("invoiceId", i._id)).collect())
        entries.push({ at: c._creationTime, kind: "creditUsed", ref: i.number, debit: 0, credit: -c.amount });
      for (const al of await ctx.db.query("paymentAllocations").withIndex("by_invoice", (q) => q.eq("invoiceId", i._id)).collect()) {
        const p = await ctx.db.get(al.paymentId);
        entries.push({ at: p?.receivedAt ?? al._creationTime, kind: "payment", ref: p?.reference ?? "", debit: 0, credit: al.amount });
      }
    }
    entries.sort((a, b) => a.at - b.at);
    let bal = 0;
    return entries.map((e) => ({ ...e, balance: (bal += e.debit - e.credit) }));
  },
});

export const revenue = query({
  args: { fromPeriod: v.string(), toPeriod: v.string(), buildingId: v.optional(v.id("buildings")) },
  handler: async (ctx, { fromPeriod, toPeriod, buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const invoices = (await scopedInvoices(ctx, u, buildingId)).filter((i) => i.status === "issued" && i.period >= fromPeriod && i.period <= toPeriod);
    const byPeriod = new Map<string, { billed: number; collected: number; outstanding: number }>();
    for (const i of invoices) {
      const b = await invoiceBalance(ctx, i);
      const r = byPeriod.get(i.period) ?? { billed: 0, collected: 0, outstanding: 0 };
      r.billed += b.total + b.adjustments;
      r.collected += b.paid + b.creditUsed;
      r.outstanding += Math.max(0, b.due);
      byPeriod.set(i.period, r);
    }
    const rows = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, r]) => ({ period, ...r }));
    // "Collected" is money received against bills. It is not profit.
    return { rows, totals: rows.reduce((t, r) => ({ billed: t.billed + r.billed, collected: t.collected + r.collected, outstanding: t.outstanding + r.outstanding }), { billed: 0, collected: 0, outstanding: 0 }) };
  },
});
