import { describe, expect, it } from "vitest";
import { etb, utc, world } from "./helpers";

async function metered() {
  const w = await world();
  const a = await w.unit("A-101", 100), b = await w.unit("A-102", 100), c = await w.unit("A-103", 100);
  const renterId = await w.renter("Abebe");
  await w.activeAgreement(a, renterId, { kind: "fixed", amount: etb(10000) });
  const ea = await w.pm.mutation(w.api.utilities.addMeter, { unitId: a, kind: "electricity", serial: "E-1" });
  const eb = await w.pm.mutation(w.api.utilities.addMeter, { unitId: b, kind: "electricity", serial: "E-2" });
  return { ...w, a, b, c, ea, eb };
}
const read = async (w: Awaited<ReturnType<typeof metered>>, meterId: never, value: number, at: number, approve = true) => {
  const r = await w.pm.mutation(w.api.utilities.enterReading, { meterId, value, readAt: at });
  if (approve) await w.fin.mutation(w.api.utilities.approveReading, { readingId: r.id });
  return r;
};

describe("meter register", () => {
  it("shows, per meter, what billing will do for the month: usage, charge and whether it is ready", async () => {
    const w = await metered();
    await read(w, w.ea as never, 1000, utc(2026, 8, 28)); // last reading before September
    await read(w, w.ea as never, 1150, utc(2026, 9, 28)); // 150 kWh in September
    await read(w, w.eb as never, 500, utc(2026, 9, 28), false); // entered, not yet approved
    const r = await w.fin.query(w.api.utilities.register, { period: "2026-09" });
    const e1 = r.rows.find((x) => x.serial === "E-1")!, e2 = r.rows.find((x) => x.serial === "E-2")!;
    expect(e1).toMatchObject({ unitNumber: "A-101", renterName: "Abebe", previous: 1000, latest: 1150, usage: 150, charge: etb(900), status: "ready" }); // 150 × ETB 6
    expect(e2).toMatchObject({ status: "waiting", usage: null, charge: null });
    expect(r.summary).toMatchObject({ meters: 2, ready: 1, waiting: 1, missing: 0, withoutMeter: 0 });
    // the same meters a month later have nothing yet
    const oct = await w.fin.query(w.api.utilities.register, { period: "2026-10" });
    expect(oct.summary).toMatchObject({ ready: 0, waiting: 0, missing: 2 });
    expect(oct.rows.find((x) => x.serial === "E-1")).toMatchObject({ previous: 1150, status: "missing" });
  });

  it("agrees with the bill: ready means billed, the charge matches the line", async () => {
    const w = await metered();
    await read(w, w.ea as never, 1000, utc(2026, 8, 28)); await read(w, w.ea as never, 1150, utc(2026, 9, 28));
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const [bill] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    const lines = (await w.fin.query(w.api.billing.get, { invoiceId: bill!._id })).lines;
    const reg = (await w.fin.query(w.api.utilities.register, { period: "2026-09" })).rows.find((x) => x.serial === "E-1")!;
    expect(lines.find((l) => l.kind === "electricity")!.amount).toBe(reg.charge);
  });

  it("flags unusual readings and counts occupied units that have no meter", async () => {
    const w = await metered();
    await read(w, w.ea as never, 1000, utc(2026, 7, 28)); await read(w, w.ea as never, 1100, utc(2026, 8, 28));
    await w.pm.mutation(w.api.utilities.enterReading, { meterId: w.ea as never, value: 1900, readAt: utc(2026, 9, 28) }); // 800 against a usual 100
    const reg = await w.fin.query(w.api.utilities.register, { period: "2026-09" });
    expect(reg.rows.find((x) => x.serial === "E-1")!.status).toBe("flagged");
    expect(reg.summary.withoutMeter).toBe(0); // A-101 is occupied and has a meter; A-103 is vacant
    const other = await w.t.run((c) => c.db.insert("buildings", { name: "Other" }));
    const lim = w.as(await w.mk("lim", ["financeOfficer"], [other]));
    expect((await lim.query(w.api.utilities.register, { period: "2026-09" })).rows).toEqual([]);
    await expect(lim.query(w.api.utilities.register, { period: "2026-09", buildingId: w.buildingId })).rejects.toThrow(/forbidden/);
  });
});
