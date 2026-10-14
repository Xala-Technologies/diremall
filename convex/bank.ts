import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertSantim, audit, fail, requireRole } from "./lib/access";
import { assertRenterVisible } from "./lib/scope";

/** Statement lines are evidence only. Importing or matching never creates a payment. */
/** Bank statements are mall-wide, so only staff with access to every building may import or match them. */
async function bankUser(ctx: Parameters<typeof requireRole>[0]) {
  const u = await requireRole(ctx, "financeOfficer", "approver");
  if (u.buildingScope !== "all") fail("forbidden_building");
  return u;
}

export const importStatement = mutation({
  args: { batch: v.string(), entries: v.array(v.object({ postedAt: v.number(), amount: v.number(), reference: v.string() })) },
  handler: async (ctx, { batch, entries }) => {
    const u = await bankUser(ctx);
    if (entries.length > 500) fail("too_many_lines_per_import");
    for (const e of entries) assertSantim(e.amount);
    if ((await ctx.db.query("bankStatementEntries").withIndex("by_batch", (q) => q.eq("importBatch", batch)).first())) fail("batch_already_imported");
    for (const e of entries) await ctx.db.insert("bankStatementEntries", { importBatch: batch, ...e });
    await audit(ctx, u, "bank.import", "bankStatementEntries", batch, `${entries.length} lines`);
    return entries.length;
  },
});

/** Suggest the recorded payment with the same amount; reference/method equality ranks it first. */
export const suggestions = query({
  args: { batch: v.string() },
  handler: async (ctx, { batch }) => {
    const u = await bankUser(ctx);
    const entries = (await ctx.db.query("bankStatementEntries").withIndex("by_batch", (q) => q.eq("importBatch", batch)).collect()).filter((e) => !e.matchedPaymentId);
    const out = [];
    for (const e of entries) {
      const cands = [];
      // payments with exactly this amount, via the amount index (not every payment ever recorded)
      for (const p of await ctx.db.query("payments").withIndex("by_amount", (q) => q.eq("amount", e.amount)).take(50)) {
        if (p.status === "voided") continue;
        if (await ctx.db.query("bankStatementEntries").withIndex("by_payment", (q) => q.eq("matchedPaymentId", p._id)).first()) continue;
        try { await assertRenterVisible(ctx, u, p.renterId); } catch { continue; }
        const renter = await ctx.db.get(p.renterId);
        cands.push({ paymentId: p._id, renterName: renter?.name ?? "", reference: p.reference, status: p.status, referenceMatches: e.reference.includes(p.reference) || p.reference.includes(e.reference), difference: e.amount - p.amount });
      }
      cands.sort((a, b) => Number(b.referenceMatches) - Number(a.referenceMatches));
      out.push({ entry: e, candidates: cands });
    }
    return out;
  },
});

export const confirmMatch = mutation({
  args: { entryId: v.id("bankStatementEntries"), paymentId: v.id("payments") },
  handler: async (ctx, { entryId, paymentId }) => {
    const u = await bankUser(ctx);
    const e = (await ctx.db.get(entryId)) ?? fail("not_found");
    const p = (await ctx.db.get(paymentId)) ?? fail("not_found");
    if (p.status === "voided") fail("payment_voided");
    await assertRenterVisible(ctx, u, p.renterId);
    if (e.matchedPaymentId) fail("entry_already_matched");
    if (e.amount !== p.amount) fail("amount_differs");
    if (await ctx.db.query("bankStatementEntries").withIndex("by_payment", (q) => q.eq("matchedPaymentId", paymentId)).first()) fail("payment_already_matched");
    await ctx.db.patch(entryId, { matchedPaymentId: paymentId });
    await audit(ctx, u, "bank.match", "bankStatementEntries", entryId, paymentId);
  },
});

export const unmatched = query({
  args: {},
  handler: async (ctx) => {
    await bankUser(ctx);
    return (await ctx.db.query("bankStatementEntries").collect()).filter((e) => !e.matchedPaymentId);
  },
});
