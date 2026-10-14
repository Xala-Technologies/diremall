import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { computeBalance } from "../convex/lib/ledger";
import { etb, utc, world } from "./helpers";

async function setup(units = 1) {
  const w = await world();
  const renters = [];
  for (let i = 0; i < units; i++) {
    const unitId = await w.unit(`U-${i}`, 10); const renterId = await w.renter(`Renter ${i}`);
    await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(1000 + i) });
    renters.push(renterId);
  }
  return { w, renters };
}
const issueAll = async (w: Awaited<ReturnType<typeof world>>, period = "2026-09") => {
  let r; do { r = await w.fin.mutation(w.api.billing.generate, { period, batch: 2 }); } while (!r.done);
  const drafts = await w.fin.query(w.api.billing.list, { period });
  await w.fin.mutation(w.api.billing.issue, { invoiceIds: drafts.map((d) => d._id) });
  return drafts.map((d) => d._id);
};

describe("stored balances", () => {
  it("bills are prepared in batches without losing or duplicating any", async () => {
    const { w } = await setup(5);
    const first = await w.fin.mutation(w.api.billing.generate, { period: "2026-09", batch: 2 });
    expect(first).toMatchObject({ created: 2, done: false });
    const ids = await issueAll(w);
    expect(ids).toHaveLength(5);
    expect((await w.fin.mutation(w.api.billing.generate, { period: "2026-09", batch: 2 })).created).toBe(0);
  });

  it("the balance stored on a bill always equals the sum of its payments, credit and corrections", async () => {
    const { w, renters } = await setup(1);
    const [invoiceId] = await issueAll(w);
    const renterId = renters[0]!;
    const pay = async (amount: number, ref: string) => {
      const id = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(amount), method: "cash", reference: ref, receivedAt: utc(2026, 9, 3) });
      await w.ap.mutation(w.api.payments.confirm, { paymentId: id });
      return w.fin.mutation(w.api.payments.apply, { paymentId: id });
    };
    const check = async () => {
      const stored = await w.t.run(async (ctx) => { const i = (await ctx.db.get(invoiceId!))!; return { due: i.due, paid: i.paid, adj: i.adjustments, credit: i.creditUsed, computed: await computeBalance(ctx, i) }; });
      expect(stored.due).toBe(stored.computed.due); expect(stored.paid).toBe(stored.computed.paid); expect(stored.adj).toBe(stored.computed.adjustments); expect(stored.credit).toBe(stored.computed.creditUsed);
      return stored.due!;
    };
    expect(await check()).toBe(etb(1000));
    await pay(300, "a"); expect(await check()).toBe(etb(700));
    const adj = await w.fin.mutation(w.api.billing.requestAdjustment, { invoiceId: invoiceId!, delta: -etb(100), reason: "rent-free days" });
    expect(await check()).toBe(etb(700)); // not approved yet
    await w.ap.mutation(w.api.billing.approveAdjustment, { adjustmentId: adj }); expect(await check()).toBe(etb(600));
    await pay(700, "b"); expect(await check()).toBe(0); // 600 applied, 100 kept as credit
    expect(await w.fin.query(w.api.payments.credit, { renterId })).toBe(etb(100));
  });

  it("reports read the same figures after the one-time backfill rebuilds the stored balances", async () => {
    const { w, renters } = await setup(3);
    await issueAll(w);
    const p = await w.fin.mutation(w.api.payments.record, { renterId: renters[0]!, amount: etb(400), method: "transfer", reference: "T1", receivedAt: utc(2026, 9, 5) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p }); await w.fin.mutation(w.api.payments.apply, { paymentId: p });
    const before = { dash: await w.fin.query(w.api.reports.dashboard, { period: "2026-09" }), aging: await w.fin.query(w.api.reports.aging, {}), rev: await w.fin.query(w.api.reports.revenue, { fromPeriod: "2026-09", toPeriod: "2026-09" }) };

    // simulate bills created before this change: no building, no stored balance
    await w.t.run(async (ctx) => { for (const i of await ctx.db.query("invoices").collect()) await ctx.db.patch(i._id, { buildingId: undefined, due: undefined, paid: undefined, creditUsed: undefined, adjustments: undefined }); });
    expect((await w.fin.query(w.api.reports.dashboard, { period: "2026-09" })).outstanding).toBe(before.dash.outstanding); // billed/outstanding still right via the fallback
    let cursor: string | null = null;
    do { const r: { next: string | null } = await w.t.mutation(internal.migrations.backfillInvoicePage, { cursor }); cursor = r.next; } while (cursor);

    expect(await w.fin.query(w.api.reports.dashboard, { period: "2026-09" })).toEqual(before.dash);
    expect(await w.fin.query(w.api.reports.aging, {})).toEqual(before.aging);
    expect(await w.fin.query(w.api.reports.revenue, { fromPeriod: "2026-09", toPeriod: "2026-09" })).toEqual(before.rev);
  });

  it("a building-limited user only sees their building in the open-bills reports", async () => {
    const { w, renters } = await setup(1);
    await issueAll(w);
    const b2 = await w.pm.mutation(w.api.properties.createBuilding, { name: "Other" });
    const scoped = w.as(await w.mk("scoped", ["financeOfficer"], [b2]));
    expect((await scoped.query(w.api.reports.aging, {})).rows).toHaveLength(0);
    expect((await scoped.query(w.api.reports.dashboard, { period: "2026-09" })).billed).toBe(0);
    expect((await w.fin.query(w.api.reports.aging, {})).rows).toHaveLength(1);
    void renters;
  });
});
