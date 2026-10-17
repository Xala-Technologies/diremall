import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { READ_ROLES, assertDifferentPerson, assertSantim, audit, fail, getSetting, requireRole } from "./lib/access";
import { inOrg, owned } from "./lib/tenant";
import { refreshUnitStatus } from "./lib/units";
import { renterMap, termsByAgreement, unitMap } from "./lib/bulk";
import { assertRenterVisible, assertUnitVisible } from "./lib/scope";
import { assertUploadOk } from "./files";
import { escalatedRent, monthlyRent, monthsBetween, rangesOverlap } from "./lib/billing";
import { invoiceBalance } from "./lib/ledger";

const escalation = v.optional(v.object({ percent: v.number(), everyMonths: v.number() }));
function assertEscalation(e?: { percent: number; everyMonths: number }) {
  if (!e) return;
  if (!(e.percent > 0 && e.percent <= 100) || !Number.isInteger(e.everyMonths) || e.everyMonths < 1 || e.everyMonths > 60) fail("invalid_escalation");
}

const rent = v.union(
  v.object({ kind: v.literal("perM2"), ratePerM2: v.number() }),
  v.object({ kind: v.literal("fixed"), amount: v.number() }),
);

const DAY = 86_400_000;

export const createDraft = mutation({
  args: {
    unitId: v.id("units"),
    renterId: v.id("renters"),
    startsAt: v.number(),
    endsAt: v.number(),
    rent,
    dueDay: v.number(),
    depositAmount: v.number(),
    escalation,
  },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    assertEscalation(a.escalation);
    const unit = await assertUnitVisible(ctx, u, a.unitId);
    await assertRenterVisible(ctx, u, a.renterId);
    if (a.endsAt <= a.startsAt) fail("end_before_start");
    if (a.dueDay < 1 || a.dueDay > 28) fail("due_day_1_to_28");
    assertSantim(a.depositAmount, { allowZero: true });
    assertSantim(a.rent.kind === "fixed" ? a.rent.amount : a.rent.ratePerM2, { allowZero: true });
    if (unit.status === "maintenance") fail("unit_in_maintenance");
    if ((await ctx.db.get(unit.buildingId))?.archivedAt) fail("building_archived");
    const id = await ctx.db.insert("agreements", { orgId: u.orgId, unitId: a.unitId, renterId: a.renterId, status: "draft", startsAt: a.startsAt, endsAt: a.endsAt, createdBy: u._id });
    await ctx.db.insert("agreementTerms", { orgId: u.orgId, agreementId: id, effectiveFrom: a.startsAt, rent: a.rent, dueDay: a.dueDay, depositAmount: a.depositAmount, ...(a.escalation ? { escalation: a.escalation } : {}), createdBy: u._id });
    await audit(ctx, u, "agreement.create", "agreements", id);
    return id;
  },
});

export const attachSignedCopy = mutation({
  args: { agreementId: v.id("agreements"), fileId: v.id("_storage") },
  handler: async (ctx, { agreementId, fileId }) => {
    const u = await requireRole(ctx, "propertyManager");
    const ag = await owned(ctx, u.orgId, agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    // Replacing the signed copy on a live agreement would bypass review; only drafts and agreements in review may change it.
    // (a lease brought in from the old records has no scan yet; it may be attached once, without reopening the lease)
    const scanLater = !!ag.importedAt && !ag.signedFileId;
    if (ag.status !== "draft" && ag.status !== "inReview" && !scanLater) fail("signed_copy_locked");
    await assertUploadOk(ctx, u.orgId, fileId);
    await ctx.db.patch(agreementId, { signedFileId: fileId });
    await audit(ctx, u, "agreement.signedCopy", "agreements", agreementId);
  },
});

export const submitForReview = mutation({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, { agreementId }) => {
    const u = await requireRole(ctx, "propertyManager");
    const ag = await owned(ctx, u.orgId, agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "draft") fail("not_a_draft");
    await ctx.db.patch(agreementId, { status: "inReview" });
    await audit(ctx, u, "agreement.submit", "agreements", agreementId);
  },
});

/** A draft with conflicting dates or no signed copy is returned, not activated. */
export const returnForCorrection = mutation({
  args: { agreementId: v.id("agreements"), reason: v.string() },
  handler: async (ctx, { agreementId, reason }) => {
    const u = await requireRole(ctx, "approver");
    const ag = await owned(ctx, u.orgId, agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "inReview") fail("not_in_review");
    await ctx.db.patch(agreementId, { status: "draft" });
    await audit(ctx, u, "agreement.return", "agreements", agreementId, reason);
  },
});

export const approve = mutation({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, { agreementId }) => {
    const u = await requireRole(ctx, "approver");
    const ag = await owned(ctx, u.orgId, agreementId);
    const unit = await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "inReview") fail("not_in_review");
    assertDifferentPerson(ag.createdBy, u._id);
    if (!ag.signedFileId) fail("signed_copy_required");
    if (unit.status === "maintenance") fail("unit_in_maintenance");
    if ((await ctx.db.get(unit.buildingId))?.archivedAt) fail("building_archived");
    if (ag.endsAt <= Date.now()) fail("agreement_already_ended"); // a lease that is already over is history: bring it in with Import data
    const others = await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", ag.unitId).eq("status", "active")).collect();
    if (others.some((o) => rangesOverlap([o.startsAt, o.endsAt], [ag.startsAt, ag.endsAt]))) fail("overlapping_active_agreement");
    await ctx.db.patch(agreementId, { status: "active", approvedBy: u._id });
    // A lease that starts in the future reserves the unit; it turns occupied on its start date.
    await refreshUnitStatus(ctx, ag.unitId);
    const term = await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", agreementId)).first();
    await ctx.db.insert("deposits", { orgId: u.orgId, agreementId, required: term?.depositAmount ?? 0, held: 0, deductions: [], refunded: 0 });
    await audit(ctx, u, "agreement.approve", "agreements", agreementId);
  },
});

/** Rent change or renewal: earlier terms stay in history; issued bills never change. */
export const addTerm = mutation({
  args: { agreementId: v.id("agreements"), effectiveFrom: v.number(), rent, dueDay: v.number(), depositAmount: v.number(), newEndsAt: v.optional(v.number()), escalation },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "approver");
    assertEscalation(a.escalation);
    const ag = await owned(ctx, u.orgId, a.agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "active") fail("agreement_not_active");
    if (a.dueDay < 1 || a.dueDay > 28) fail("due_day_1_to_28");
    assertSantim(a.depositAmount, { allowZero: true });
    assertSantim(a.rent.kind === "fixed" ? a.rent.amount : a.rent.ratePerM2, { allowZero: true });
    const existing = await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", a.agreementId)).collect();
    if (existing.some((t) => t.effectiveFrom >= a.effectiveFrom)) fail("term_must_start_after_previous");
    if (a.newEndsAt !== undefined) {
      if (a.newEndsAt <= ag.endsAt) fail("renewal_must_extend");
      await ctx.db.patch(a.agreementId, { endsAt: a.newEndsAt });
    }
    // a renewal that changes the deposit changes what is required; what is already held stays, so a shortfall or an excess shows
    const dep = await ctx.db.query("deposits").withIndex("by_agreement", (q) => q.eq("agreementId", a.agreementId)).unique();
    if (dep && dep.required !== a.depositAmount) await ctx.db.patch(dep._id, { required: a.depositAmount });
    await ctx.db.insert("agreementTerms", { orgId: u.orgId, agreementId: a.agreementId, effectiveFrom: a.effectiveFrom, rent: a.rent, dueDay: a.dueDay, depositAmount: a.depositAmount, ...(a.escalation ? { escalation: a.escalation } : {}), createdBy: u._id });
    await audit(ctx, u, "agreement.term", "agreements", a.agreementId, JSON.stringify({ effectiveFrom: a.effectiveFrom, rent: a.rent }));
  },
});

export const terminate = mutation({
  args: { agreementId: v.id("agreements"), reason: v.string(), effectiveAt: v.optional(v.number()) },
  handler: async (ctx, { agreementId, reason, effectiveAt }) => {
    const u = await requireRole(ctx, "approver");
    const ag = await owned(ctx, u.orgId, agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "active") fail("agreement_not_active");
    if (!reason.trim()) fail("reason_required");
    // The last day of the tenancy is the termination date itself (today unless another date is given), so billing stops at the end of
    // that day. endsAt is the start of the day after the last day, the same way every lease end is stored.
    const lastDay = Math.floor((effectiveAt ?? Date.now() + 3 * 3_600_000) / 86_400_000) * 86_400_000; // "today" is the day in Ethiopia (UTC+3)
    const end = Math.min(ag.endsAt, Math.max(ag.startsAt + 1, lastDay + 86_400_000));
    await ctx.db.patch(agreementId, { status: "terminated", terminationReason: reason, endsAt: end });
    await refreshUnitStatus(ctx, ag.unitId);
    await audit(ctx, u, "agreement.terminate", "agreements", agreementId, reason);
  },
});

export const recordHandover = mutation({
  args: { agreementId: v.id("agreements"), kind: v.union(v.literal("moveIn"), v.literal("moveOut")), keys: v.number(), condition: v.string(), readings: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    const ag = await owned(ctx, u.orgId, a.agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    const id = await ctx.db.insert("handovers", { orgId: u.orgId, ...a, recordedBy: u._id, at: Date.now() });
    await audit(ctx, u, `agreement.${a.kind}`, "agreements", a.agreementId);
    return id;
  },
});

export const list = query({
  args: { status: v.optional(v.union(v.literal("draft"), v.literal("inReview"), v.literal("active"), v.literal("expired"), v.literal("terminated"))) },
  handler: async (ctx, { status }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const all = status ? await inOrg(ctx, "agreements", u.orgId).collect().then((r) => r.filter((x) => x.status === status)) : await inOrg(ctx, "agreements", u.orgId).collect();
    // units and renters are read once as a whole (Convex allows 4,096 lookups per call)
    const [units, renters, terms] = await Promise.all([unitMap(ctx, u.orgId), renterMap(ctx, u.orgId), termsByAgreement(ctx, u.orgId)]);
    const out = [];
    const monthStart = (() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); })();
    for (const ag of all) {
      const unit = units.get(ag.unitId);
      if (!unit || (u.buildingScope !== "all" && !(Array.isArray(u.buildingScope) && u.buildingScope.includes(unit.buildingId)))) continue;
      // the monthly rent being charged now (or at the end of the lease for one that has ended), with any yearly increase applied
      const mine = (terms.get(ag._id) ?? []).sort((a, b) => a.effectiveFrom - b.effectiveFrom);
      const at = Math.min(Date.now(), ag.endsAt);
      const cur = mine.filter((x) => x.effectiveFrom <= at).at(-1) ?? mine[0];
      const rent = cur ? escalatedRent(monthlyRent(cur.rent.kind === "fixed" ? { kind: "fixed", amount: cur.rent.amount } : { kind: "perM2", areaM2: unit.areaM2, ratePerM2: cur.rent.ratePerM2 }), cur.escalation, cur.effectiveFrom, Math.min(monthStart, ag.endsAt)).amount : 0;
      out.push({ ...ag, unitNumber: unit.number, buildingId: unit.buildingId, renterName: renters.get(ag.renterId)?.name ?? "", rent });
    }
    return out;
  },
});

export const get = query({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, { agreementId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const ag = await owned(ctx, u.orgId, agreementId);
    const unit = await assertUnitVisible(ctx, u, ag.unitId);
    const terms = await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", agreementId)).collect();
    const handovers = await ctx.db.query("handovers").withIndex("by_agreement", (q) => q.eq("agreementId", agreementId)).collect();
    const deposit = await ctx.db.query("deposits").withIndex("by_agreement", (q) => q.eq("agreementId", agreementId)).unique();
    const nameOf = async (id?: Id<"users">) => (id ? (await ctx.db.get(id))?.name ?? "" : undefined);

    // what this lease has been billed, paid and still owes
    const bills = (await ctx.db.query("invoices").withIndex("by_agreement_period", (q) => q.eq("agreementId", agreementId)).collect()).filter((i) => i.status === "issued");
    const now = Date.now();
    const rows = [];
    for (const inv of bills) { const b = await invoiceBalance(ctx, inv); rows.push({ _id: inv._id, number: inv.number, period: inv.period, dueAt: inv.dueAt, total: b.total + b.adjustments, paid: b.paid + b.creditUsed, due: b.due }); }
    rows.sort((a, b) => b.dueAt - a.dueAt);
    const account = {
      billed: rows.reduce((s, r) => s + r.total, 0), paid: rows.reduce((s, r) => s + r.paid, 0), due: rows.reduce((s, r) => s + r.due, 0),
      overdue: rows.filter((r) => r.due > 0 && r.dueAt < now).reduce((s, r) => s + r.due, 0), count: rows.length, bills: rows.slice(0, 12),
    };

    // the rent being charged today, and the next yearly increase if the lease has one
    const sorted = terms.slice().sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    const current = sorted.filter((t) => t.effectiveFrom <= now).at(-1) ?? sorted[0];
    let rentNow: number | null = null; let nextIncrease: { at: number; amount: number } | null = null;
    if (current) {
      const monthly = monthlyRent(current.rent.kind === "fixed" ? { kind: "fixed", amount: current.rent.amount } : { kind: "perM2", areaM2: unit.areaM2, ratePerM2: current.rent.ratePerM2 });
      const d = new Date(now); const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const esc = current.escalation;
      rentNow = escalatedRent(monthly, esc, current.effectiveFrom, monthStart).amount;
      if (esc) {
        const steps = Math.floor(monthsBetween(current.effectiveFrom, monthStart) / esc.everyMonths);
        const e = new Date(current.effectiveFrom); const at = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + (steps + 1) * esc.everyMonths, 1);
        if (at < ag.endsAt && ag.status === "active") nextIncrease = { at, amount: escalatedRent(monthly, esc, current.effectiveFrom, at).amount };
      }
    }
    return {
      agreement: ag, unit, renter: await ctx.db.get(ag.renterId), terms, handovers, deposit, hasSigned: !!ag.signedFileId,
      createdByName: await nameOf(ag.createdBy), approvedByName: await nameOf(ag.approvedBy), account, rentNow, nextIncrease,
    };
  },
});

export const expiring = query({
  args: { withinDays: v.optional(v.number()) },
  handler: async (ctx, { withinDays }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const days = withinDays ?? (await getSetting(ctx, u.orgId, "expiryWarnDays", 60));
    const horizon = Date.now() + days * DAY;
    const active = await ctx.db.query("agreements").withIndex("by_status", (q) => q.eq("orgId", u.orgId).eq("status", "active")).collect();
    const units = await unitMap(ctx, u.orgId);
    const out = [];
    for (const ag of active) {
      if (ag.endsAt > horizon) continue;
      const unit = units.get(ag.unitId);
      if (!unit || (u.buildingScope !== "all" && !(Array.isArray(u.buildingScope) && u.buildingScope.includes(unit.buildingId)))) continue;
      out.push({ agreementId: ag._id as Id<"agreements">, unitNumber: unit.number, endsAt: ag.endsAt, renterId: ag.renterId });
    }
    return out.sort((a, b) => a.endsAt - b.endsAt);
  },
});

/** Correct a draft that was returned for correction. Only drafts can be edited; active terms change through addTerm. */
export const updateDraft = mutation({
  args: { agreementId: v.id("agreements"), startsAt: v.number(), endsAt: v.number(), rent, dueDay: v.number(), depositAmount: v.number(), escalation },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager");
    assertEscalation(a.escalation);
    const ag = await owned(ctx, u.orgId, a.agreementId);
    await assertUnitVisible(ctx, u, ag.unitId);
    if (ag.status !== "draft") fail("not_a_draft");
    if (a.endsAt <= a.startsAt) fail("end_before_start");
    if (a.dueDay < 1 || a.dueDay > 28) fail("due_day_1_to_28");
    assertSantim(a.depositAmount, { allowZero: true });
    assertSantim(a.rent.kind === "fixed" ? a.rent.amount : a.rent.ratePerM2, { allowZero: true });
    await ctx.db.patch(a.agreementId, { startsAt: a.startsAt, endsAt: a.endsAt });
    const terms = await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", a.agreementId)).collect();
    for (const t of terms) await ctx.db.delete(t._id);
    await ctx.db.insert("agreementTerms", { orgId: u.orgId, agreementId: a.agreementId, effectiveFrom: a.startsAt, rent: a.rent, dueDay: a.dueDay, depositAmount: a.depositAmount, ...(a.escalation ? { escalation: a.escalation } : {}), createdBy: u._id });
    await audit(ctx, u, "agreement.updateDraft", "agreements", a.agreementId);
  },
});
