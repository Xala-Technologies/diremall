import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { READ_ROLES, assertBuilding, assertDifferentPerson, assertPeriod, assertSantim, audit, canSeeBuilding, fail, getSetting, requireRole } from "./lib/access";
import { inOrg, owned } from "./lib/tenant";
import { activeAgreementsByUnit, renterMap, unitMap } from "./lib/bulk";
import { periodRange } from "./lib/period";
import { allocateSharedCost } from "./lib/billing";
import { assertUnitVisible, assertBuildingIn } from "./lib/scope";

const kind = v.union(v.literal("water"), v.literal("electricity"));

export const addMeter = mutation({
  args: { unitId: v.id("units"), kind, serial: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    await assertUnitVisible(ctx, u, a.unitId);
    const id = await ctx.db.insert("meters", { orgId: u.orgId, ...a });
    await audit(ctx, u, "meter.create", "meters", id, a.serial);
    return id;
  },
});

export const meters = query({
  args: { unitId: v.id("units") },
  handler: async (ctx, { unitId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertUnitVisible(ctx, u, unitId);
    return ctx.db.query("meters").withIndex("by_unit", (q) => q.eq("unitId", unitId)).collect();
  },
});

/**
 * Enter a reading. A reading below the previous one, or a usage jump above 3× the last period,
 * is flagged for review instead of silently feeding a bill. A reset meter is marked explicitly.
 */
export const enterReading = mutation({
  args: { meterId: v.id("meters"), value: v.number(), readAt: v.number(), isReset: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    const meter = await owned(ctx, u.orgId, a.meterId);
    await assertUnitVisible(ctx, u, meter.unitId);
    if (!Number.isFinite(a.value) || a.value < 0) fail("invalid_value");
    const prior = (await ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", a.meterId)).collect()).filter((r) => r.status !== "flagged" && r.readAt < a.readAt);
    const prev = prior.at(-1);
    const prev2 = prior.at(-2);
    let status: "draft" | "flagged" = "draft";
    // A meter reset skips the usage checks, so it always needs an approver's decision.
    if (a.isReset) status = "flagged";
    if (prev && !a.isReset) {
      const delta = a.value - prev.value;
      if (delta < 0) status = "flagged";
      else if (prev2 && !prev.isReset) {
        const last = prev.value - prev2.value;
        if (last > 0 && delta > 3 * last) status = "flagged";
      }
    }
    // A reading dated before one that is already there must not be higher than it, or the later one would look like a step backwards.
    const later = (await ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", a.meterId)).collect()).filter((r) => r.status !== "flagged" && r.readAt > a.readAt && !r.isReset).sort((x, y) => x.readAt - y.readAt)[0];
    if (later && !a.isReset && a.value > later.value) status = "flagged";
    const id = await ctx.db.insert("meterReadings", { orgId: u.orgId, meterId: a.meterId, value: a.value, readAt: a.readAt, status, enteredBy: u._id, isReset: !!a.isReset });
    await audit(ctx, u, "reading.enter", "meterReadings", id, status);
    return { id, status };
  },
});

export const approveReading = mutation({
  args: { readingId: v.id("meterReadings") },
  handler: async (ctx, { readingId }) => {
    const u = await requireRole(ctx, "financeOfficer", "approver");
    const r = await owned(ctx, u.orgId, readingId);
    const meter = await owned(ctx, u.orgId, r.meterId);
    await assertUnitVisible(ctx, u, meter.unitId);
    if (r.status !== "draft") fail("not_a_draft_reading");
    assertDifferentPerson(r.enteredBy, u._id);
    await ctx.db.patch(readingId, { status: "approved", approvedBy: u._id });
    await audit(ctx, u, "reading.approve", "meterReadings", readingId);
  },
});

/** Flagged readings need an approver's decision: accept as-is, or confirm the meter was reset/replaced. */
export const reviewFlagged = mutation({
  args: { readingId: v.id("meterReadings"), decision: v.union(v.literal("accept"), v.literal("reset")) },
  handler: async (ctx, { readingId, decision }) => {
    const u = await requireRole(ctx, "approver");
    const r = await owned(ctx, u.orgId, readingId);
    const meter = await owned(ctx, u.orgId, r.meterId);
    await assertUnitVisible(ctx, u, meter.unitId);
    if (r.status !== "flagged") fail("not_flagged");
    assertDifferentPerson(r.enteredBy, u._id);
    if (decision === "accept" && !r.isReset) {
      const prev = (await ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", r.meterId)).collect()).filter((x) => x.status === "approved" && x.readAt < r.readAt).at(-1);
      if (prev && r.value < prev.value) fail("lower_than_previous_requires_reset");
    }
    await ctx.db.patch(readingId, { status: "approved", approvedBy: u._id, isReset: decision === "reset" ? true : r.isReset });
    await audit(ctx, u, "reading.reviewFlagged", "meterReadings", readingId, decision);
  },
});

export const readings = query({
  args: { meterId: v.id("meters") },
  handler: async (ctx, { meterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const m = await owned(ctx, u.orgId, meterId);
    await assertUnitVisible(ctx, u, m.unitId);
    return ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", meterId)).collect();
  },
});

export const pendingReadings = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const rows = (await inOrg(ctx, "meterReadings", u.orgId).collect()).filter((r) => r.status !== "approved");
    const out = [];
    for (const r of rows) {
      const m = await ctx.db.get(r.meterId);
      const unit = m ? await ctx.db.get(m.unitId) : null;
      if (m && unit && canSeeBuilding(u, unit.buildingId)) out.push({ ...r, unitNumber: unit.number, meterKind: m.kind });
    }
    return out;
  },
});

/** Divide a building cost (generator, cleaning, security) across units by floor area. Vacant units' share goes to the owner. */
export const createSharedCost = mutation({
  args: { buildingId: v.id("buildings"), kind: v.union(v.literal("generator"), v.literal("security"), v.literal("cleaning")), period: v.string(), total: v.number() },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "financeOfficer");
    await assertBuildingIn(ctx, u, a.buildingId);
    assertPeriod(a.period);
    assertSantim(a.total);
    const dupe = (await ctx.db.query("sharedCosts").withIndex("by_building_period", (q) => q.eq("buildingId", a.buildingId).eq("period", a.period)).collect()).find((c) => c.kind === a.kind);
    if (dupe) fail("shared_cost_exists");
    const units = await ctx.db.query("units").withIndex("by_building", (q) => q.eq("buildingId", a.buildingId)).collect();
    if (units.length === 0) fail("no_units");
    const res = allocateSharedCost(a.total, units.map((x) => ({ unitId: x._id, areaM2: x.areaM2, occupied: x.status === "occupied" })));
    const id = await ctx.db.insert("sharedCosts", { orgId: u.orgId, buildingId: a.buildingId, kind: a.kind, period: a.period, total: a.total, basis: "area", ownerShare: res.ownerShare, createdBy: u._id });
    for (const [unitId, amount] of Object.entries(res.shares)) await ctx.db.insert("sharedCostAllocations", { orgId: u.orgId, sharedCostId: id, unitId: unitId as any, amount });
    await audit(ctx, u, "sharedCost.create", "sharedCosts", id, `${a.kind} ${a.period}`);
    return { id, ownerShare: res.ownerShare };
  },
});

export const approveSharedCost = mutation({
  args: { sharedCostId: v.id("sharedCosts") },
  handler: async (ctx, { sharedCostId }) => {
    const u = await requireRole(ctx, "approver");
    const c = await owned(ctx, u.orgId, sharedCostId);
    assertBuilding(u, c.buildingId);
    if (c.approvedBy) fail("already_approved");
    assertDifferentPerson(c.createdBy, u._id);
    await ctx.db.patch(sharedCostId, { approvedBy: u._id });
    await audit(ctx, u, "sharedCost.approve", "sharedCosts", sharedCostId);
  },
});

export const sharedCosts = query({
  args: { buildingId: v.id("buildings"), period: v.optional(v.string()) },
  handler: async (ctx, { buildingId, period }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertBuildingIn(ctx, u, buildingId);
    const rows = await ctx.db.query("sharedCosts").withIndex("by_building_period", (q) => (period ? q.eq("buildingId", buildingId).eq("period", period) : q.eq("buildingId", buildingId))).collect();
    return Promise.all(rows.map(async (c) => ({ ...c, allocations: await ctx.db.query("sharedCostAllocations").withIndex("by_cost", (q) => q.eq("sharedCostId", c._id)).collect() })));
  },
});

/**
 * Every meter with its readings for one month, mirroring what billing will do: only APPROVED readings dated in the month
 * count, and usage is the step from the last approved reading before the month. So "ready" here means "will be billed".
 */
export const register = query({
  args: { period: v.string(), buildingId: v.optional(v.id("buildings")) },
  handler: async (ctx, { period, buildingId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    assertPeriod(period);
    if (buildingId) await assertBuildingIn(ctx, u, buildingId);
    const { start, end } = periodRange(period);
    const [units, renters, leases, meters] = await Promise.all([unitMap(ctx, u.orgId), renterMap(ctx, u.orgId), activeAgreementsByUnit(ctx, u.orgId), inOrg(ctx, "meters", u.orgId).collect()]);
    const tariff = { electricity: await getSetting(ctx, u.orgId, "tariff.electricity", 600), water: await getSetting(ctx, u.orgId, "tariff.water", 0) };
    const now = Date.now();
    const rows: {
      meterId: Id<"meters">; unitId: Id<"units">; buildingId: Id<"buildings">; unitNumber: string; renterName: string; kind: "water" | "electricity"; serial: string;
      previous: number | null; previousAt: number | null; latest: number | null; latestAt: number | null; usage: number | null; charge: number | null; status: "ready" | "waiting" | "flagged" | "missing";
    }[] = [];
    const metered = new Set<Id<"units">>();
    for (const m of meters) {
      const unit = units.get(m.unitId);
      if (!unit || !canSeeBuilding(u, unit.buildingId) || (buildingId && unit.buildingId !== buildingId)) continue;
      metered.add(unit._id);
      const readings = (await ctx.db.query("meterReadings").withIndex("by_meter", (q) => q.eq("meterId", m._id)).collect()).sort((a, b) => a.readAt - b.readAt);
      const approved = readings.filter((r) => r.status === "approved");
      const inPeriod = approved.filter((r) => r.readAt >= start && r.readAt < end);
      const before = approved.filter((r) => r.readAt < start).at(-1);
      let usage = 0;
      if (inPeriod.length > 0) { const seq = before ? [before, ...inPeriod] : inPeriod; for (let i = 1; i < seq.length; i++) if (!seq[i]!.isReset) usage += seq[i]!.value - seq[i - 1]!.value; }
      const waiting = readings.filter((r) => r.status !== "approved" && r.readAt >= start && r.readAt < end);
      const status = inPeriod.length > 0 ? "ready" : waiting.length > 0 ? (waiting.some((r) => r.status === "flagged") ? "flagged" : "waiting") : "missing";
      const rate = m.kind === "electricity" ? tariff.electricity : tariff.water;
      const lease = (leases.get(unit._id) ?? []).find((a) => a.startsAt <= now && a.endsAt > now);
      rows.push({
        meterId: m._id, unitId: unit._id, buildingId: unit.buildingId, unitNumber: unit.number, renterName: lease ? renters.get(lease.renterId)?.name ?? "" : "", kind: m.kind, serial: m.serial,
        previous: before?.value ?? null, previousAt: before?.readAt ?? null, latest: inPeriod.at(-1)?.value ?? null, latestAt: inPeriod.at(-1)?.readAt ?? null,
        usage: inPeriod.length > 0 ? usage : null, charge: inPeriod.length > 0 && rate > 0 && usage > 0 ? Math.round(usage * rate) : null, status,
      });
    }
    rows.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }) || a.kind.localeCompare(b.kind));
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    // occupied units with no meter at all: worth knowing before billing day
    const withoutMeter = [...units.values()].filter((x) => canSeeBuilding(u, x.buildingId) && (!buildingId || x.buildingId === buildingId) && x.status === "occupied" && !metered.has(x._id)).length;
    return { rows, tariff, summary: { meters: rows.length, ready: count("ready"), waiting: count("waiting") + count("flagged"), missing: count("missing"), withoutMeter } };
  },
});
