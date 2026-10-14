import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { READ_ROLES, assertDifferentPerson, assertSantim, audit, fail, requireRole } from "./lib/access";
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
  args: { agreementId: v.id("agreements"), amount: v.number() },
  handler: async (ctx, { agreementId, amount }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const dep = await load(ctx, agreementId, u);
    assertSantim(amount);
    if (dep.held + amount > dep.required) fail("exceeds_required_deposit");
    await ctx.db.patch(dep._id, { held: dep.held + amount });
    await audit(ctx, u, "deposit.receive", "agreements", agreementId, String(amount));
  },
});

export const requestDeduction = mutation({
  args: { agreementId: v.id("agreements"), amount: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer", "propertyManager");
    const dep = await load(ctx, a.agreementId, u);
    if (!a.reason.trim()) fail("reason_required");
    assertSantim(a.amount);
    const pending = dep.deductions.filter((x) => !x.approvedBy).reduce((s, x) => s + x.amount, 0);
    if (a.amount <= 0 || a.amount + pending > available(dep)) fail("exceeds_deposit");
    await ctx.db.patch(dep._id, { deductions: [...dep.deductions, { amount: a.amount, reason: a.reason, requestedBy: u._id }] });
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
