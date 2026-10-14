import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { READ_ROLES, audit, canSeeBuilding, fail, getSetting, requireRole } from "./lib/access";
import { invoiceBalance } from "./lib/ledger";
import { assertRenterVisible } from "./lib/scope";
import { refreshUnitStatus } from "./lib/units";

const DAY = 86_400_000;
const fmt = (s: number) => `ETB ${(s / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function queueOnce(ctx: any, row: { renterId: any; kind: "dueReminder" | "paymentAck" | "expiryWarning"; body: string; dedupeKey: string; invoiceId?: any; agreementId?: any }) {
  const exists = await ctx.db.query("smsMessages").withIndex("by_dedupe", (q: any) => q.eq("dedupeKey", row.dedupeKey)).first();
  if (exists) return false;
  await ctx.db.insert("smsMessages", { ...row, status: "queued" });
  return true;
}

/** Daily: remind about bills falling due, and notice bills past due. Paid bills never trigger a message. */
export const queueDueReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lead = await getSetting(ctx, "dueReminderDays", 3);
    const now = Date.now();
    let queued = 0;
    // only bills that still owe money
    for (const inv of await ctx.db.query("invoices").withIndex("by_status_due", (q) => q.eq("status", "issued").gt("due", 0)).collect()) {
      const bal = await invoiceBalance(ctx, inv);
      if (bal.due <= 0) continue;
      if (inv.dueAt >= now && inv.dueAt - now <= lead * DAY) {
        if (await queueOnce(ctx, { renterId: inv.renterId, kind: "dueReminder", invoiceId: inv._id, dedupeKey: `due:${inv._id}`, body: `Reminder: bill ${inv.number} of ${fmt(bal.due)} is due on ${date(inv.dueAt)}.` })) queued++;
      } else if (inv.dueAt < now) {
        if (await queueOnce(ctx, { renterId: inv.renterId, kind: "dueReminder", invoiceId: inv._id, dedupeKey: `overdue:${inv._id}`, body: `Overdue: bill ${inv.number} of ${fmt(bal.due)} was due on ${date(inv.dueAt)}. Please pay.` })) queued++;
      }
    }
    return queued;
  },
});

export const queueExpiryWarnings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const days = await getSetting(ctx, "expiryWarnDays", 60);
    const horizon = Date.now() + days * DAY;
    let queued = 0;
    for (const ag of (await ctx.db.query("agreements").collect()).filter((a) => a.status === "active" && a.endsAt <= horizon && a.endsAt > Date.now())) {
      if (await queueOnce(ctx, { renterId: ag.renterId, kind: "expiryWarning", agreementId: ag._id, dedupeKey: `expiry:${ag._id}:${ag.endsAt}`, body: `Your rental agreement ends on ${date(ag.endsAt)}. Please contact the office about renewal.` })) queued++;
    }
    return queued;
  },
});

/** Expire agreements whose end date has passed and free the unit. */
export const expireAgreements = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const ag of (await ctx.db.query("agreements").collect()).filter((a) => a.status === "active" && a.endsAt < Date.now())) {
      await ctx.db.patch(ag._id, { status: "expired" });
      await refreshUnitStatus(ctx, ag.unitId);
      n++;
    }
    return n;
  },
});

/** Turn reserved units occupied once their lease starts. */
export const refreshUnits = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const u of await ctx.db.query("units").collect()) await refreshUnitStatus(ctx, u._id);
  },
});

/** Messages ready to send, with the phone number; a message whose bill has since been paid is cancelled. */
export const claimQueued = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("smsMessages").withIndex("by_status", (q) => q.eq("status", "queued")).take(50);
    const out = [];
    for (const m of rows) {
      if (m.kind === "dueReminder" && m.invoiceId) {
        const inv = await ctx.db.get(m.invoiceId);
        if (!inv || (await invoiceBalance(ctx, inv)).due <= 0) { await ctx.db.patch(m._id, { status: "cancelled" }); continue; }
      }
      const renter = await ctx.db.get(m.renterId);
      if (!renter?.phone) { await ctx.db.patch(m._id, { status: "failed" }); continue; }
      await ctx.db.patch(m._id, { status: "sending" }); // claimed: an overlapping run cannot send it again
      out.push({ id: m._id, to: renter.phone, body: m.body });
    }
    return out;
  },
});

export const setStatus = internalMutation({
  args: { id: v.id("smsMessages"), status: v.union(v.literal("accepted"), v.literal("delivered"), v.literal("failed"), v.literal("uncertain")) },
  handler: async (ctx, { id, status }) => { await ctx.db.patch(id, { status }); },
});

/** Gateway delivery receipt. Only messages already handed to the gateway can change, and a delivered message never goes back. */
export const deliveryReceipt = internalMutation({
  args: { id: v.id("smsMessages"), status: v.union(v.literal("delivered"), v.literal("failed")) },
  handler: async (ctx, { id, status }) => {
    const m = await ctx.db.get(id);
    if (!m || !["accepted", "uncertain", "sending"].includes(m.status)) return false;
    await ctx.db.patch(id, { status });
    return true;
  },
});

export const list = query({
  args: { renterId: v.optional(v.id("renters")) },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const rows = renterId ? await ctx.db.query("smsMessages").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect() : await ctx.db.query("smsMessages").collect();
    const out = [];
    for (const m of rows) {
      try { await assertRenterVisible(ctx, u, m.renterId); } catch { continue; }
      out.push({ ...m, renterName: (await ctx.db.get(m.renterId))?.name ?? "" });
    }
    return out.sort((a, b) => b._creationTime - a._creationTime).slice(0, 200);
  },
});

export const retry = mutation({
  args: { id: v.id("smsMessages") },
  handler: async (ctx, { id }) => {
    const u = await requireRole(ctx, "financeOfficer");
    const m = (await ctx.db.get(id)) ?? fail("not_found");
    await assertRenterVisible(ctx, u, m.renterId);
    if (m.status !== "failed" && m.status !== "uncertain") fail("not_retryable");
    await ctx.db.patch(id, { status: "queued" });
    await audit(ctx, u, "sms.retry", "smsMessages", id);
  },
});
