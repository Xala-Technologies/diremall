import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { assertSantim, audit, fail, requireRole } from "./lib/access";
import { inOrg, owned } from "./lib/tenant";
import { assertRenterVisible } from "./lib/scope";

/** Statement lines are evidence only. Importing or matching never creates a payment. */
/** Bank statements are mall-wide, so only staff with access to every building may import or match them. */
async function bankUser(ctx: Parameters<typeof requireRole>[0]) {
  const u = await requireRole(ctx, "financeOfficer", "approver");
  if (u.buildingScope !== "all") fail("forbidden_building");
  return u;
}

const MAX_LINES = 1000;
const stateOf = (e: Doc<"bankStatementEntries">) => (e.matchedPaymentId ? "matched" : e.ignoredAt ? "ignored" : "toMatch") as "matched" | "ignored" | "toMatch";

/**
 * Save the money-in lines of a statement. A line already imported earlier (same date, amount and reference) is skipped,
 * so importing an overlapping statement never creates doubles.
 */
export const importStatement = mutation({
  args: {
    batch: v.string(), bank: v.optional(v.string()),
    entries: v.array(v.object({ postedAt: v.number(), amount: v.number(), reference: v.string(), description: v.optional(v.string()) })),
  },
  handler: async (ctx, { batch, bank, entries }) => {
    const u = await bankUser(ctx);
    if (entries.length === 0) fail("import_empty");
    if (entries.length > MAX_LINES) fail("too_many_lines_per_import");
    for (const e of entries) { assertSantim(e.amount); if (!Number.isFinite(e.postedAt)) fail("invalid_date"); }
    const name = batch.trim();
    if (!name) fail("name_required");
    if (await ctx.db.query("bankStatementEntries").withIndex("by_batch", (q) => q.eq("orgId", u.orgId).eq("importBatch", name)).first()) fail("batch_already_imported");
    let imported = 0, duplicates = 0;
    for (const e of entries) {
      const ref = e.reference.trim();
      const same = await ctx.db.query("bankStatementEntries").withIndex("by_line", (q) => q.eq("orgId", u.orgId).eq("postedAt", e.postedAt).eq("amount", e.amount)).collect();
      if (same.some((x) => x.reference === ref)) { duplicates++; continue; }
      await ctx.db.insert("bankStatementEntries", { orgId: u.orgId, importBatch: name, postedAt: e.postedAt, amount: e.amount, reference: ref, description: e.description?.trim() || undefined, bank: bank?.trim() || undefined });
      imported++;
    }
    await audit(ctx, u, "bank.import", "bankStatementEntries", name, `${imported} lines, ${duplicates} already imported`);
    return { imported, duplicates };
  },
});

async function paymentBrief(ctx: QueryCtx, id: Id<"payments">) {
  const p = await ctx.db.get(id);
  if (!p) return null;
  const renter = await ctx.db.get(p.renterId);
  return { paymentId: p._id, renterName: renter?.name ?? "", reference: p.reference, status: p.status, receiptNumber: p.receiptNumber, amount: p.amount, receivedAt: p.receivedAt };
}

/** The statements imported so far, newest first, with how many lines still need a match. */
export const batches = query({
  args: {},
  handler: async (ctx) => {
    const u = await bankUser(ctx);
    const all = await inOrg(ctx, "bankStatementEntries", u.orgId).order("desc").take(5000);
    const map = new Map<string, { batch: string; bank?: string; lines: number; toMatch: number; importedAt: number }>();
    for (const e of all) {
      const b = map.get(e.importBatch) ?? { batch: e.importBatch, bank: e.bank, lines: 0, toMatch: 0, importedAt: e._creationTime };
      b.lines++; if (stateOf(e) === "toMatch") b.toMatch++;
      map.set(e.importBatch, b);
    }
    return [...map.values()].sort((a, b) => b.importedAt - a.importedAt);
  },
});

/** The lines of one statement (or all), with totals per state so the screen can show what is left to do. */
export const statement = query({
  args: { batch: v.optional(v.string()) },
  handler: async (ctx, { batch }) => {
    const u = await bankUser(ctx);
    const rows = batch
      ? await ctx.db.query("bankStatementEntries").withIndex("by_batch", (q) => q.eq("orgId", u.orgId).eq("importBatch", batch)).collect()
      : await inOrg(ctx, "bankStatementEntries", u.orgId).order("desc").take(1500);
    const totals = { toMatch: { n: 0, amount: 0 }, matched: { n: 0, amount: 0 }, ignored: { n: 0, amount: 0 } };
    const lines = [];
    for (const e of rows.sort((a, b) => b.postedAt - a.postedAt || b._creationTime - a._creationTime)) {
      const state = stateOf(e);
      totals[state].n++; totals[state].amount += e.amount;
      let payment = null;
      if (e.matchedPaymentId) {
        payment = await paymentBrief(ctx, e.matchedPaymentId);
        const p = await ctx.db.get(e.matchedPaymentId);
        if (p) { try { await assertRenterVisible(ctx, u, p.renterId); } catch { payment = null; } }
      }
      lines.push({ ...e, state, payment });
    }
    return { lines, totals, capped: !batch && rows.length >= 1500 };
  },
});

/** Payments this line could belong to: same amount first, then anything found by reference or renter name. */
export const candidates = query({
  args: { entryId: v.id("bankStatementEntries"), q: v.optional(v.string()) },
  handler: async (ctx, { entryId, q }) => {
    const u = await bankUser(ctx);
    const e = await owned(ctx, u.orgId, entryId);
    const seen = new Set<string>();
    const out: { paymentId: Id<"payments">; renterName: string; reference: string; status: string; amount: number; receivedAt: number; difference: number; referenceMatches: boolean; taken: boolean }[] = [];
    const add = async (p: Doc<"payments">) => {
      if (seen.has(p._id) || p.status === "voided") return;
      seen.add(p._id);
      try { await assertRenterVisible(ctx, u, p.renterId); } catch { return; }
      const renter = await ctx.db.get(p.renterId);
      const taken = !!(await ctx.db.query("bankStatementEntries").withIndex("by_payment", (x) => x.eq("matchedPaymentId", p._id)).first());
      out.push({ paymentId: p._id, renterName: renter?.name ?? "", reference: p.reference, status: p.status, amount: p.amount, receivedAt: p.receivedAt, difference: e.amount - p.amount, referenceMatches: !!e.reference && (e.reference.includes(p.reference) || p.reference.includes(e.reference)), taken });
    };
    for (const p of await ctx.db.query("payments").withIndex("by_amount", (x) => x.eq("orgId", u.orgId).eq("amount", e.amount)).take(50)) await add(p);
    const needle = (q ?? "").trim().toLowerCase();
    if (needle) {
      for (const p of await ctx.db.query("payments").withIndex("by_received", (q) => q.eq("orgId", u.orgId)).order("desc").take(400)) {
        const renter = await ctx.db.get(p.renterId);
        if (`${p.reference} ${renter?.name ?? ""}`.toLowerCase().includes(needle)) await add(p);
        if (out.length >= 30) break;
      }
    }
    out.sort((a, b) => Number(b.referenceMatches) - Number(a.referenceMatches) || Number(a.taken) - Number(b.taken) || Math.abs(a.difference) - Math.abs(b.difference));
    return out;
  },
});

export const confirmMatch = mutation({
  args: { entryId: v.id("bankStatementEntries"), paymentId: v.id("payments") },
  handler: async (ctx, { entryId, paymentId }) => {
    const u = await bankUser(ctx);
    const e = await owned(ctx, u.orgId, entryId);
    const p = await owned(ctx, u.orgId, paymentId);
    if (p.status === "voided") fail("payment_voided");
    await assertRenterVisible(ctx, u, p.renterId);
    if (e.matchedPaymentId) fail("entry_already_matched");
    if (e.ignoredAt) fail("entry_ignored");
    if (e.amount !== p.amount) fail("amount_differs");
    if (await ctx.db.query("bankStatementEntries").withIndex("by_payment", (q) => q.eq("matchedPaymentId", paymentId)).first()) fail("payment_already_matched");
    await ctx.db.patch(entryId, { matchedPaymentId: paymentId, matchedBy: u._id, matchedAt: Date.now() });
    await audit(ctx, u, "bank.match", "bankStatementEntries", entryId, paymentId);
  },
});

/** Take a line out of the to-do list because it is not rent (bank charge, own-account transfer, …). A reason is required. */
export const ignore = mutation({
  args: { entryId: v.id("bankStatementEntries"), reason: v.string() },
  handler: async (ctx, { entryId, reason }) => {
    const u = await bankUser(ctx);
    const e = await owned(ctx, u.orgId, entryId);
    if (e.matchedPaymentId) fail("entry_already_matched");
    if (!reason.trim()) fail("reason_required");
    await ctx.db.patch(entryId, { ignoredAt: Date.now(), ignoredBy: u._id, ignoreReason: reason.trim() });
    await audit(ctx, u, "bank.ignore", "bankStatementEntries", entryId, reason.trim());
  },
});

/** Undo an ignore or a match. Undoing a match needs an approver, because it reopens the question of where the money went. */
export const reopen = mutation({
  args: { entryId: v.id("bankStatementEntries") },
  handler: async (ctx, { entryId }) => {
    const u = await bankUser(ctx);
    const e = await owned(ctx, u.orgId, entryId);
    if (e.matchedPaymentId) {
      if (!(u.roles ?? []).some((r) => r === "approver" || r === "superAdmin")) fail("forbidden");
      await ctx.db.patch(entryId, { matchedPaymentId: undefined, matchedBy: undefined, matchedAt: undefined });
    } else if (e.ignoredAt) {
      await ctx.db.patch(entryId, { ignoredAt: undefined, ignoredBy: undefined, ignoreReason: undefined });
    } else fail("nothing_to_reopen");
    await audit(ctx, u, "bank.reopen", "bankStatementEntries", entryId);
  },
});
