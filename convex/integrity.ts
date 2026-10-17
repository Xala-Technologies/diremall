import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/access";
import { inOrg } from "./lib/tenant";

/**
 * A health check of the books: does every record point at something that exists, and do the stored figures agree with what
 * they are made of? It only reads. Each finding names the record, so it can be fixed (or explained) by a person.
 */
export type Finding = { area: string; code: string; ref: string; detail: string };
const CAP = 20_000;

export async function scan(ctx: QueryCtx, orgId: Id<"organizations">): Promise<{ findings: Finding[]; checked: Record<string, number>; truncated: boolean }> {
  const f: Finding[] = [];
  const add = (area: string, code: string, ref: string, detail = "") => { if (f.length < 500) f.push({ area, code, ref, detail }); };
  const [buildings, floors, units, renters, agreements, terms, deposits, invoices, lines, adjustments, payments, allocs, credits, meters, readings, costs, costAllocs, entries, users] = await Promise.all([
    inOrg(ctx, "buildings", orgId).take(CAP), inOrg(ctx, "floors", orgId).take(CAP), inOrg(ctx, "units", orgId).take(CAP), inOrg(ctx, "renters", orgId).take(CAP), inOrg(ctx, "agreements", orgId).take(CAP),
    inOrg(ctx, "agreementTerms", orgId).take(CAP), inOrg(ctx, "deposits", orgId).take(CAP), inOrg(ctx, "invoices", orgId).take(CAP), inOrg(ctx, "invoiceLines", orgId).take(CAP), inOrg(ctx, "invoiceAdjustments", orgId).take(CAP),
    inOrg(ctx, "payments", orgId).take(CAP), inOrg(ctx, "paymentAllocations", orgId).take(CAP), inOrg(ctx, "renterCredits", orgId).take(CAP), inOrg(ctx, "meters", orgId).take(CAP), inOrg(ctx, "meterReadings", orgId).take(CAP),
    inOrg(ctx, "sharedCosts", orgId).take(CAP), inOrg(ctx, "sharedCostAllocations", orgId).take(CAP), inOrg(ctx, "bankStatementEntries", orgId).take(CAP), ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(CAP),
  ]);
  const truncated = [buildings, floors, units, renters, agreements, terms, deposits, invoices, lines, adjustments, payments, allocs, credits, meters, readings, costs, costAllocs, entries, users].some((t) => t.length >= CAP);
  const B = new Map(buildings.map((x) => [x._id, x])), Fl = new Map(floors.map((x) => [x._id, x])), U = new Map(units.map((x) => [x._id, x])), R = new Map(renters.map((x) => [x._id, x]));
  const A = new Map(agreements.map((x) => [x._id, x])), I = new Map(invoices.map((x) => [x._id, x])), P = new Map(payments.map((x) => [x._id, x]));
  const now = Date.now();

  // structure: building > floor > unit
  for (const x of floors) if (!B.has(x.buildingId)) add("structure", "floor_without_building", x.label);
  for (const x of units) {
    if (!B.has(x.buildingId)) add("structure", "unit_without_building", x.number);
    const fl = Fl.get(x.floorId);
    if (!fl) add("structure", "unit_without_floor", x.number);
    else if (fl.buildingId !== x.buildingId) add("structure", "unit_floor_in_other_building", x.number);
    if (!(x.areaM2 > 0)) add("structure", "unit_area_not_positive", x.number);
  }

  // leases
  const termsBy = new Map<string, number>(); for (const t of terms) termsBy.set(t.agreementId, (termsBy.get(t.agreementId) ?? 0) + 1);
  const depBy = new Map<string, number>(); for (const d of deposits) depBy.set(d.agreementId, (depBy.get(d.agreementId) ?? 0) + 1);
  const activeByUnit = new Map<string, typeof agreements>();
  for (const a of agreements) {
    const ref = `${U.get(a.unitId)?.number ?? "?"} / ${R.get(a.renterId)?.name ?? "?"}`;
    if (!U.has(a.unitId)) add("leases", "agreement_without_unit", a._id);
    if (!R.has(a.renterId)) add("leases", "agreement_without_renter", a._id);
    if (a.endsAt <= a.startsAt) add("leases", "agreement_ends_before_it_starts", ref);
    if (!termsBy.get(a._id)) add("leases", "agreement_without_terms", ref);
    if (a.status === "active" || a.status === "expired" || a.status === "terminated") {
      if ((depBy.get(a._id) ?? 0) !== 1) add("leases", "agreement_deposit_record_missing_or_double", ref);
    }
    if (a.status === "active") {
      if (a.endsAt <= now) add("leases", "active_agreement_past_its_end", ref, "the nightly job should have expired it");
      activeByUnit.set(a.unitId, [...(activeByUnit.get(a.unitId) ?? []), a]);
    }
    if (a.status === "inReview" || a.status === "draft") if (depBy.get(a._id)) add("leases", "unapproved_agreement_has_deposit_record", ref);
  }
  for (const [unitId, list] of activeByUnit) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (list[i]!.startsAt < list[j]!.endsAt && list[j]!.startsAt < list[i]!.endsAt) add("leases", "two_active_leases_overlap_on_one_unit", U.get(unitId as never)?.number ?? unitId);
  for (const x of units) {
    if (x.status === "maintenance") continue;
    const live = (activeByUnit.get(x._id) ?? []).some((a) => a.startsAt <= now && a.endsAt > now);
    if (live && x.status !== "occupied") add("leases", "unit_has_a_live_lease_but_shows_vacant", x.number);
    if (!live && x.status === "occupied") add("leases", "unit_shows_occupied_without_a_live_lease", x.number);
  }
  for (const d of deposits) {
    const ded = d.deductions.filter((y) => y.approvedBy).reduce((s, y) => s + y.amount, 0);
    if (d.held - ded - d.refunded < 0) add("deposits", "deposit_available_is_negative", d.agreementId);
    if (!A.has(d.agreementId)) add("deposits", "deposit_without_agreement", d.agreementId);
    if ((d.receipts ?? []).reduce((x, y) => x + y.amount, 0) > d.held) add("deposits", "deposit_receipts_exceed_what_is_held", d.agreementId);
  }

  // bills
  const lineSum = new Map<string, number>(); for (const l of lines) lineSum.set(l.invoiceId, (lineSum.get(l.invoiceId) ?? 0) + l.amount);
  const adjSum = new Map<string, number>(); for (const a of adjustments) if (a.approvedBy) adjSum.set(a.invoiceId, (adjSum.get(a.invoiceId) ?? 0) + a.delta);
  const paidSum = new Map<string, number>(); for (const a of allocs) paidSum.set(a.invoiceId, (paidSum.get(a.invoiceId) ?? 0) + a.amount);
  const creditUse = new Map<string, number>(); for (const c of credits) if (c.invoiceId) creditUse.set(c.invoiceId, (creditUse.get(c.invoiceId) ?? 0) - c.amount);
  const numbers = new Set<string>(), perPeriod = new Set<string>();
  for (const i of invoices) {
    if (!U.has(i.unitId)) add("bills", "bill_without_unit", i.number || i._id);
    if (!R.has(i.renterId)) add("bills", "bill_without_renter", i.number || i._id);
    const ag = A.get(i.agreementId);
    if (!ag) add("bills", "bill_without_agreement", i.number || i._id);
    else if (ag.renterId !== i.renterId || ag.unitId !== i.unitId) add("bills", "bill_renter_or_unit_differs_from_its_agreement", i.number || i._id);
    const key = `${i.agreementId}|${i.period}`;
    if (i.period !== "opening" && perPeriod.has(key)) add("bills", "two_bills_for_one_agreement_and_month", `${i.number} ${i.period}`);
    perPeriod.add(key);
    if (i.period !== "opening" && (lineSum.get(i._id) ?? 0) !== i.total) add("bills", "bill_total_differs_from_its_lines", i.number || i._id, `${i.total} vs ${lineSum.get(i._id) ?? 0}`);
    if (i.status === "issued") {
      if (!i.number) add("bills", "issued_bill_without_number", i._id);
      else if (numbers.has(i.number)) add("bills", "duplicate_bill_number", i.number);
      numbers.add(i.number);
      const adj = adjSum.get(i._id) ?? 0, paid = paidSum.get(i._id) ?? 0, cu = creditUse.get(i._id) ?? 0, due = i.total + adj - paid - cu;
      if (i.due !== due || i.paid !== paid || i.adjustments !== adj || i.creditUsed !== cu) add("bills", "stored_balance_differs_from_payments", i.number, `stored due ${i.due}, real ${due}`);
      if (due < 0) add("bills", "bill_overpaid_below_zero", i.number, String(due));
      const unit = U.get(i.unitId); if (unit && i.buildingId && i.buildingId !== unit.buildingId) add("bills", "bill_building_differs_from_unit", i.number);
    } else if ((paidSum.get(i._id) ?? 0) !== 0) add("bills", "draft_bill_has_payments", i._id);
  }
  for (const l of lines) if (!I.has(l.invoiceId)) add("bills", "bill_line_without_bill", l._id);

  // payments
  const allocBy = new Map<string, number>(); for (const a of allocs) { allocBy.set(a.paymentId, (allocBy.get(a.paymentId) ?? 0) + a.amount); if (!I.has(a.invoiceId)) add("payments", "allocation_without_bill", a.paymentId); if (!P.has(a.paymentId)) add("payments", "allocation_without_payment", a._id); }
  const creditBy = new Map<string, number>(); for (const c of credits) if (c.paymentId) creditBy.set(c.paymentId, (creditBy.get(c.paymentId) ?? 0) + c.amount);
  const receipts = new Set<string>(), refs = new Set<string>();
  for (const p of payments) {
    if (!R.has(p.renterId)) add("payments", "payment_without_renter", p.reference);
    if (p.status === "applied") {
      if (!p.receiptNumber) add("payments", "applied_payment_without_receipt", p.reference);
      else if (receipts.has(p.receiptNumber)) add("payments", "duplicate_receipt_number", p.receiptNumber);
      receipts.add(p.receiptNumber ?? "");
      if ((allocBy.get(p._id) ?? 0) + (creditBy.get(p._id) ?? 0) !== p.amount) add("payments", "applied_amount_differs_from_allocations_plus_credit", p.receiptNumber ?? p.reference, `${p.amount} vs ${(allocBy.get(p._id) ?? 0) + (creditBy.get(p._id) ?? 0)}`);
    } else if ((allocBy.get(p._id) ?? 0) !== 0 || (creditBy.get(p._id) ?? 0) !== 0) add("payments", "payment_not_applied_but_has_allocations", p.reference, p.status);
    if (p.status !== "voided") { const k = `${p.method}|${p.reference}`; if (refs.has(k)) add("payments", "same_reference_recorded_twice", p.reference); refs.add(k); }
    if (p.status === "confirmed" && p.confirmedBy === p.recordedBy) add("payments", "confirmed_by_the_person_who_recorded_it", p.reference);
  }
  const balance = new Map<string, number>(); for (const c of credits) balance.set(c.renterId, (balance.get(c.renterId) ?? 0) + c.amount);
  for (const [renterId, b] of balance) if (b < 0) add("payments", "renter_credit_balance_below_zero", R.get(renterId as never)?.name ?? renterId, String(b));
  for (const c of credits) if (!R.has(c.renterId)) add("payments", "credit_without_renter", c._id);

  // bank
  for (const e of entries) if (e.matchedPaymentId) { const p = P.get(e.matchedPaymentId); if (!p) add("bank", "statement_line_matched_to_missing_payment", e.reference); else if (p.status === "voided") add("bank", "statement_line_matched_to_a_voided_payment", e.reference); else if (p.amount !== e.amount) add("bank", "matched_amounts_differ", e.reference); }

  // utilities
  const M = new Map(meters.map((m) => [m._id, m]));
  for (const m of meters) if (!U.has(m.unitId)) add("utilities", "meter_without_unit", m.serial);
  const byMeter = new Map<string, typeof readings>(); for (const r of readings) { if (!M.has(r.meterId)) add("utilities", "reading_without_meter", r._id); byMeter.set(r.meterId, [...(byMeter.get(r.meterId) ?? []), r]); }
  for (const [mid, rs] of byMeter) { const ap = rs.filter((r) => r.status === "approved").sort((a, b) => a.readAt - b.readAt); for (let i = 1; i < ap.length; i++) if (!ap[i]!.isReset && ap[i]!.value < ap[i - 1]!.value) add("utilities", "approved_reading_goes_backwards", M.get(mid as never)?.serial ?? mid); }
  const cAlloc = new Map<string, number>(); for (const a of costAllocs) cAlloc.set(a.sharedCostId, (cAlloc.get(a.sharedCostId) ?? 0) + a.amount);
  for (const c of costs) { if (!B.has(c.buildingId)) add("utilities", "shared_cost_without_building", c.period); if ((cAlloc.get(c._id) ?? 0) + c.ownerShare !== c.total) add("utilities", "shared_cost_shares_do_not_add_up", `${c.kind} ${c.period}`); }

  // people
  for (const m of users) if (Array.isArray(m.buildingScope)) for (const b of m.buildingScope) if (!B.has(b)) add("access", "staff_scope_names_a_missing_building", m.userId);
  for (const m of users) if (m.status === "active" && m.roles.length === 0) add("access", "active_staff_without_a_role", m.userId);

  const checked = { buildings: buildings.length, units: units.length, renters: renters.length, agreements: agreements.length, bills: invoices.length, payments: payments.length, readings: readings.length, bankLines: entries.length };
  return { findings: f, checked, truncated };
}

/** For the Settings screen: approvers and administrators run the check on demand. */
export const check = query({ args: {}, handler: async (ctx) => { const u = await requireRole(ctx, "approver"); return scan(ctx, u.orgId); } });
/** For the command line: npx convex run integrity:run '{"orgId":"…"}' */
export const run = internalQuery({ args: { orgId: v.id("organizations") }, handler: async (ctx, { orgId }) => scan(ctx, orgId) });
