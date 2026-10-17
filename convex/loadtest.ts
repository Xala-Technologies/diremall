import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * Load test data: about 1,000 units, renters and active agreements with 12 months of paid and part-paid bills.
 * Everything is tagged "LT" and removed by loadtest:clear. Development use only.
 *   npx convex run loadtest:seed        npx convex run loadtest:clear
 */
const BLOCKS = ["A", "B", "C", "D", "E"];
const PER_BLOCK = 200;
const PERIODS = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2025, 9 + i, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; });
const start = (p: string) => Date.parse(`${p}-01T00:00:00Z`);

export const setupBlock = internalMutation({
  args: { orgId: v.id("organizations"), block: v.string(), actor: v.id("users") },
  handler: async (ctx, { orgId, block, actor }) => {
    const buildingId = await ctx.db.insert("buildings", { orgId, name: `LT Block ${block}` });
    const floorId = await ctx.db.insert("floors", { orgId, buildingId, label: "G" });
    const agreements: { agreementId: Id<"agreements">; unitId: Id<"units">; renterId: Id<"renters">; total: number }[] = [];
    for (let i = 1; i <= PER_BLOCK; i++) {
      const area = 40 + ((i * 7) % 160), rate = (1500 + ((i * 13) % 1000)) * 100;
      const unitId = await ctx.db.insert("units", { orgId, buildingId, floorId, number: `LT-${block}-${String(i).padStart(3, "0")}`, areaM2: area, category: i % 3 === 0 ? "office" : "retail", ratePerM2: rate, status: "occupied" });
      const renterId = await ctx.db.insert("renters", { orgId, kind: "company", name: `LT Renter ${block}${i}`, tin: String(2000000000 + BLOCKS.indexOf(block) * 1000 + i), phone: `+2519${String(10000000 + BLOCKS.indexOf(block) * 1000 + i)}` });
      const agreementId = await ctx.db.insert("agreements", { orgId, unitId, renterId, status: "active", startsAt: start("2025-10"), endsAt: start("2027-10"), createdBy: actor, approvedBy: actor });
      await ctx.db.insert("agreementTerms", { orgId, agreementId, effectiveFrom: start("2025-10"), rent: { kind: "perM2", ratePerM2: rate }, dueDay: 5, depositAmount: 5_000_000, createdBy: actor });
      await ctx.db.insert("deposits", { orgId, agreementId, required: 5_000_000, held: 5_000_000, deductions: [], refunded: 0 });
      agreements.push({ agreementId, unitId, renterId, total: Math.round(area * rate) });
    }
    return { buildingId, agreements };
  },
});

export const billPeriod = internalMutation({
  args: { orgId: v.id("organizations"), period: v.string(), buildingId: v.id("buildings"), actor: v.id("users"), agreements: v.array(v.object({ agreementId: v.id("agreements"), unitId: v.id("units"), renterId: v.id("renters"), total: v.number() })) },
  handler: async (ctx, { orgId, period, buildingId, actor, agreements }) => {
    const last = period === PERIODS[PERIODS.length - 1];
    let n = 0;
    for (const a of agreements) {
      n++;
      const paid = !last || n % 10 < 7; // the latest month is ~70% paid
      const invoiceId = await ctx.db.insert("invoices", {
        orgId, number: `LT-INV-${period}-${String(n).padStart(4, "0")}-${buildingId.slice(-4)}`, agreementId: a.agreementId, unitId: a.unitId, buildingId, renterId: a.renterId, period, status: "issued",
        total: a.total, dueAt: start(period) + 4 * 86_400_000, issuedBy: actor, issuedAt: start(period), adjustments: 0, paid: paid ? a.total : 0, creditUsed: 0, due: paid ? 0 : a.total,
      });
      await ctx.db.insert("invoiceLines", { orgId, invoiceId, kind: "rent", description: `Rent ${period}`, amount: a.total, calcNote: "load test" });
      if (paid) {
        const paymentId = await ctx.db.insert("payments", { orgId, renterId: a.renterId, amount: a.total, method: "transfer", reference: `LT-${period}-${buildingId.slice(-4)}-${n}`, receivedAt: start(period) + 3 * 86_400_000, status: "applied", recordedBy: actor, confirmedBy: actor, receiptNumber: `LT-RCT-${period}-${buildingId.slice(-4)}-${n}` });
        await ctx.db.insert("paymentAllocations", { orgId, paymentId, invoiceId, amount: a.total });
      }
    }
  },
});

export const seed = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const actor: Id<"users"> | null = await ctx.runMutation(internal.loadtest.firstAdmin, { orgId });
    if (!actor) return "this company has no administrator yet";
    let rows = 0;
    for (const block of BLOCKS) {
      const { buildingId, agreements } = await ctx.runMutation(internal.loadtest.setupBlock, { orgId, block, actor });
      for (const period of PERIODS) { await ctx.runMutation(internal.loadtest.billPeriod, { orgId, period, buildingId, actor, agreements }); rows += agreements.length; }
    }
    return `seeded ${BLOCKS.length * PER_BLOCK} units and ${rows} bills`;
  },
});

export const firstAdmin = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => (await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).find((m) => m.roles.includes("superAdmin"))?.userId ?? null,
});

/** Remove everything the seed created (buildings named "LT Block …" and what hangs off them). */
export const clearPage = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    let removed = 0;
    const buildings = (await ctx.db.query("buildings").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).filter((b) => b.name.startsWith("LT Block"));
    for (const b of buildings) {
      const page = await ctx.db.query("units").withIndex("by_building", (q) => q.eq("buildingId", b._id)).take(10);
      if (page.length === 0) continue;
      for (const unit of page) {
        for (const ag of await ctx.db.query("agreements").withIndex("by_unit", (q) => q.eq("unitId", unit._id)).collect()) {
          for (const inv of await ctx.db.query("invoices").withIndex("by_agreement_period", (q) => q.eq("agreementId", ag._id)).collect()) {
            for (const l of await ctx.db.query("invoiceLines").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect()) { await ctx.db.delete(l._id); removed++; }
            for (const al of await ctx.db.query("paymentAllocations").withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id)).collect()) { await ctx.db.delete(al.paymentId); await ctx.db.delete(al._id); removed += 2; }
            await ctx.db.delete(inv._id); removed++;
          }
          for (const t of await ctx.db.query("agreementTerms").withIndex("by_agreement", (q) => q.eq("agreementId", ag._id)).collect()) { await ctx.db.delete(t._id); removed++; }
          for (const d of await ctx.db.query("deposits").withIndex("by_agreement", (q) => q.eq("agreementId", ag._id)).collect()) { await ctx.db.delete(d._id); removed++; }
          for (const m of await ctx.db.query("smsMessages").withIndex("by_renter", (q) => q.eq("renterId", ag.renterId)).collect()) { await ctx.db.delete(m._id); removed++; }
          await ctx.db.delete(ag.renterId); await ctx.db.delete(ag._id); removed += 2;
        }
        await ctx.db.delete(unit._id); removed++;
      }
      return removed; // one small page per call; the caller keeps going until nothing is left
    }
    return removed;
  },
});

export const clear = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const n: number = await ctx.runMutation(internal.loadtest.clearPage, { orgId });
      total += n;
      if (n === 0) break;
    }
    const left: number = await ctx.runMutation(internal.loadtest.dropBuildings, { orgId });
    const reminders: number = await ctx.runMutation(internal.loadtest.dropQueuedReminders, { orgId });
    return `removed ${total} rows, ${left} buildings and ${reminders} queued reminders`;
  },
});

export const dropBuildings = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    let n = 0;
    for (const b of (await ctx.db.query("buildings").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).filter((x) => x.name.startsWith("LT Block"))) {
      for (const f of await ctx.db.query("floors").withIndex("by_building", (q) => q.eq("buildingId", b._id)).collect()) await ctx.db.delete(f._id);
      await ctx.db.delete(b._id); n++;
    }
    return n;
  },
});

/** Reminder messages the daily job queued while testing (nothing is sent in development without a gateway). */
export const dropQueuedReminders = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    let n = 0;
    for (const m of await ctx.db.query("smsMessages").withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "queued")).take(2000)) {
      if (m.kind === "dueReminder" || m.kind === "expiryWarning") { await ctx.db.delete(m._id); n++; }
    }
    return n;
  },
});
