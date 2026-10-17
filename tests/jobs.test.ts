import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { utc, world } from "./helpers";

// 600 leases is more than one page (250) of every daily job, so these runs prove the paging and self-scheduling.
async function bulk(w: Awaited<ReturnType<typeof world>>, n: number, o: { status: "active" | "expired"; start: number; end: number; unit: "vacant" | "occupied"; invoice?: { dueAt: number } }) {
  await w.t.run(async (ctx) => {
    const actor = (await ctx.db.query("users").first())!._id;
    const building = (await ctx.db.query("buildings").first())!._id;
    const floor = (await ctx.db.query("floors").first())!._id;
    for (let i = 0; i < n; i++) {
      const unitId = await ctx.db.insert("units", { orgId: w.orgId, buildingId: building, floorId: floor, number: `B-${i}`, areaM2: 10, category: "retail", ratePerM2: 100, status: o.unit });
      const renterId = await ctx.db.insert("renters", { orgId: w.orgId, kind: "individual", name: `R${i}`, phone: "+251911000000" });
      const agreementId = await ctx.db.insert("agreements", { orgId: w.orgId, unitId, renterId, status: "active", startsAt: o.start, endsAt: o.end, createdBy: actor, approvedBy: actor });
      if (o.invoice) await ctx.db.insert("invoices", { orgId: w.orgId, number: `X-${i}`, agreementId, unitId, renterId, buildingId: building, period: "2026-09", status: "issued", total: 1000, dueAt: o.invoice.dueAt, adjustments: 0, paid: 0, creditUsed: 0, due: 1000 });
    }
  });
}
const settle = async (w: Awaited<ReturnType<typeof world>>) => { await w.t.finishAllScheduledFunctions(vi.runAllTimers); };

describe("daily jobs handle more than one page of rows", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("payment reminders: one message per open bill, never twice", async () => {
    const w = await world();
    await bulk(w, 600, { status: "active", start: utc(2026, 9), end: utc(2027, 9), unit: "occupied", invoice: { dueAt: Date.now() - 5 * 86_400_000 } });
    await w.t.mutation(internal.smsQueue.queueDueReminders, { orgId: w.orgId }); await settle(w);
    expect((await w.t.run((c) => c.db.query("smsMessages").collect())).length).toBe(600);
    await w.t.mutation(internal.smsQueue.queueDueReminders, { orgId: w.orgId }); await settle(w);
    expect((await w.t.run((c) => c.db.query("smsMessages").collect())).length).toBe(600);
  });

  it("expiry warnings reach every lease that ends soon", async () => {
    const w = await world();
    await bulk(w, 600, { status: "active", start: utc(2025, 1), end: Date.now() + 20 * 86_400_000, unit: "occupied" });
    await w.t.mutation(internal.smsQueue.queueExpiryWarnings, { orgId: w.orgId }); await settle(w);
    expect((await w.t.run((c) => c.db.query("smsMessages").collect())).filter((m) => m.kind === "expiryWarning")).toHaveLength(600);
  });

  it("ended leases expire and their units are freed", async () => {
    const w = await world();
    await bulk(w, 600, { status: "active", start: utc(2024, 1), end: Date.now() - 86_400_000, unit: "occupied" });
    await w.t.mutation(internal.smsQueue.expireAgreements, { orgId: w.orgId }); await settle(w);
    const left = await w.t.run(async (c) => ({ active: (await c.db.query("agreements").collect()).filter((a) => a.status === "active").length, occupied: (await c.db.query("units").collect()).filter((x) => x.status === "occupied").length }));
    expect(left).toEqual({ active: 0, occupied: 0 });
  });

  it("units whose lease has started turn occupied", async () => {
    const w = await world();
    await bulk(w, 600, { status: "active", start: utc(2026, 1), end: utc(2028, 1), unit: "vacant" });
    await w.t.mutation(internal.smsQueue.refreshUnits, { orgId: w.orgId }); await settle(w);
    expect((await w.t.run((c) => c.db.query("units").collect())).filter((x) => x.status === "occupied")).toHaveLength(600);
  });
});
