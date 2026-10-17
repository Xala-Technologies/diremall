import { describe, expect, it } from "vitest";
import { etb, world } from "./helpers";

const DAY = 86_400_000;
async function leases() {
  const w = await world();
  const mk = async (unit: string, name: string, endsInDays: number, rent: number, deposit: number) => {
    const unitId = await w.unit(unit, 100), renterId = await w.renter(name);
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: Date.now() - 300 * DAY, endsAt: Date.now() + endsInDays * DAY, rent: { kind: "fixed", amount: etb(rent) }, dueDay: 5, depositAmount: etb(deposit) });
    await w.t.run(async (c) => { await c.db.patch(id, { status: "active", approvedBy: w.apId }); await c.db.insert("deposits", { orgId: w.orgId, agreementId: id, required: etb(deposit), held: etb(deposit), deductions: [], refunded: 0 }); });
    return id;
  };
  return { ...w, soon: await mk("A-1", "Soon", 20, 10000, 20000), mid: await mk("A-2", "Mid", 75, 20000, 40000), late: await mk("A-3", "Late", 400, 30000, 60000), gone: await mk("A-4", "Gone", -5, 5000, 10000) };
}

describe("lease expiry report", () => {
  it("lists active leases ending within the chosen days, soonest first, with the rent at stake", async () => {
    const w = await leases();
    const r60 = await w.fin.query(w.api.reports.leaseExpiry, { withinDays: 60 });
    expect(r60.rows.map((x) => x.renterName)).toEqual(["Gone", "Soon"]); // Gone ended 5 days ago and is still open
    expect(r60.totals).toEqual({ leases: 2, rent: etb(15000), overdue: 1 });
    expect(r60.rows[0]!.daysLeft).toBeLessThan(0);
    const r90 = await w.fin.query(w.api.reports.leaseExpiry, { withinDays: 90 });
    expect(r90.rows.map((x) => x.renterName)).toEqual(["Gone", "Soon", "Mid"]);
    expect(r90.rows.find((x) => x.renterName === "Mid")).toMatchObject({ rent: etb(20000), deposit: etb(40000) });
  });
  it("only shows buildings the user may see", async () => {
    const w = await leases();
    const other = await w.t.run((c) => c.db.insert("buildings", { orgId: w.orgId, name: "Other" }));
    const lim = w.as(await w.mk("lim", ["financeOfficer"], [other]));
    expect((await lim.query(w.api.reports.leaseExpiry, { withinDays: 365 })).rows).toEqual([]);
    await expect(lim.query(w.api.reports.leaseExpiry, { withinDays: 365, buildingId: w.buildingId })).rejects.toThrow(/forbidden/);
  });
});

describe("deposits report", () => {
  it("shows required, held, deducted and what is still to be returned, putting refunds due first", async () => {
    const w = await leases();
    await w.t.run(async (c) => {
      await c.db.patch(w.gone, { status: "expired" });
      const dep = (await c.db.query("deposits").withIndex("by_agreement", (q) => q.eq("agreementId", w.gone)).unique())!;
      await c.db.patch(dep._id, { deductions: [{ amount: etb(2000), reason: "Repairs", requestedBy: w.finId, approvedBy: w.apId }] });
      const soon = (await c.db.query("deposits").withIndex("by_agreement", (q) => q.eq("agreementId", w.soon)).unique())!;
      await c.db.patch(soon._id, { held: etb(5000) });
    });
    const r = await w.fin.query(w.api.reports.deposits, {});
    expect(r.rows[0]).toMatchObject({ renterName: "Gone", status: "expired", held: etb(10000), deducted: etb(2000), available: etb(8000), refundDue: true });
    expect(r.rows.find((x) => x.renterName === "Soon")).toMatchObject({ held: etb(5000), shortfall: etb(15000), refundDue: false });
    expect(r.totals).toMatchObject({ toReturn: etb(8000), shortfall: etb(15000) });
    expect(r.totals.held).toBe(etb(8000 + 5000 + 40000 + 60000));
  });
});
