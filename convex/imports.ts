import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { audit, canSeeBuilding, fail, nextSeq, requireRole } from "./lib/access";
import { rangesOverlap } from "./lib/billing";
import { renterMap, unitMap } from "./lib/bulk";
import { refreshInvoice } from "./lib/ledger";
import { refreshUnitStatus } from "./lib/units";
import { isEmail, isPhone, isTin, normalizePhone, parseNumber } from "./lib/validate";

/**
 * Bulk import from a spreadsheet. Nothing is saved until every row is valid (all or nothing),
 * and the same checks run again at save time, so a screen can never push in bad data.
 */
const MAX_ROWS = 1000;
export type Issue = { row: number; field: string; code: string };

const unitRow = v.object({ row: v.number(), building: v.string(), floor: v.string(), unit: v.string(), area: v.string(), category: v.string(), rate: v.string() });
const renterRow = v.object({ row: v.number(), kind: v.string(), name: v.string(), tin: v.string(), license: v.string(), phone: v.string(), email: v.string(), rep: v.string(), idNumber: v.optional(v.string()), address: v.optional(v.string()), contactPerson: v.optional(v.string()), contactPhone: v.optional(v.string()), vat: v.optional(v.string()), notes: v.optional(v.string()) });
type UnitRow = typeof unitRow.type;
type RenterRow = typeof renterRow.type;

const CATEGORIES = ["office", "retail", "storage", "residential"] as const;
const key = (s: string) => s.trim().toLowerCase();

async function evalUnits(ctx: QueryCtx, u: Doc<"users">, rows: UnitRow[]) {
  if (rows.length === 0) fail("import_empty");
  if (rows.length > MAX_ROWS) fail("import_too_many_rows");
  const issues: Issue[] = [];
  const buildings = new Map((await ctx.db.query("buildings").collect()).map((b) => [key(b.name), b]));
  const floorsOf = new Map<Id<"buildings">, Map<string, Doc<"floors">>>();
  const seen = new Set<string>();
  const newBuildings = new Set<string>(); const newFloors = new Set<string>();
  const clean: { building: string; floor: string; unit: string; areaM2: number; category: (typeof CATEGORIES)[number]; ratePerM2: number }[] = [];

  for (const r of rows) {
    const bad = (field: string, code: string) => issues.push({ row: r.row, field, code });
    const building = r.building.trim(), floor = r.floor.trim(), unit = r.unit.trim();
    if (!building) bad("building", "required"); if (!floor) bad("floor", "required"); if (!unit) bad("unit", "required");
    const area = parseNumber(r.area);
    if (area == null || !(area > 0)) bad("area", "positive_number");
    const category = CATEGORIES.find((c) => c === key(r.category));
    if (!category) bad("category", "category");
    const rate = parseNumber(r.rate);
    if (rate == null) bad("rate", "number");
    if (!building || !floor || !unit || area == null || !(area > 0) || !category || rate == null) continue;

    const dupKey = `${key(building)}|${key(unit)}`;
    if (seen.has(dupKey)) { bad("unit", "duplicate_in_file"); continue; }
    seen.add(dupKey);

    const existing = buildings.get(key(building));
    if (existing) {
      if (!canSeeBuilding(u, existing._id)) { bad("building", "forbidden_building"); continue; }
      if (await ctx.db.query("units").withIndex("by_building_number", (q) => q.eq("buildingId", existing._id).eq("number", unit)).first()) { bad("unit", "already_exists"); continue; }
      if (!floorsOf.has(existing._id)) floorsOf.set(existing._id, new Map((await ctx.db.query("floors").withIndex("by_building", (q) => q.eq("buildingId", existing._id)).collect()).map((f) => [key(f.label), f])));
      if (!floorsOf.get(existing._id)!.has(key(floor))) newFloors.add(`${key(building)}|${key(floor)}`);
    } else {
      if (u.buildingScope !== "all") { bad("building", "forbidden_building"); continue; }
      newBuildings.add(key(building)); newFloors.add(`${key(building)}|${key(floor)}`);
    }
    clean.push({ building, floor, unit, areaM2: area, category: category!, ratePerM2: Math.round(rate * 100) });
  }
  return { issues, clean, summary: { rows: rows.length, valid: rows.length - new Set(issues.map((i) => i.row)).size, newBuildings: newBuildings.size, newFloors: newFloors.size } };
}

export const checkUnits = query({
  args: { rows: v.array(unitRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "propertyManager");
    const { issues, summary } = await evalUnits(ctx, u, rows);
    return { issues, summary };
  },
});

export const commitUnits = mutation({
  args: { rows: v.array(unitRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "propertyManager");
    const { issues, clean } = await evalUnits(ctx, u, rows);
    if (issues.length > 0) fail("import_has_errors");
    const buildingId = new Map<string, Id<"buildings">>((await ctx.db.query("buildings").collect()).map((b) => [key(b.name), b._id]));
    const floorId = new Map<string, Id<"floors">>();
    for (const f of await ctx.db.query("floors").collect()) { const b = [...buildingId.entries()].find(([, id]) => id === f.buildingId); if (b) floorId.set(`${b[0]}|${key(f.label)}`, f._id); }
    let createdBuildings = 0, createdFloors = 0;
    for (const r of clean) {
      let b = buildingId.get(key(r.building));
      if (!b) { b = await ctx.db.insert("buildings", { name: r.building }); buildingId.set(key(r.building), b); createdBuildings++; }
      const fk = `${key(r.building)}|${key(r.floor)}`;
      let f = floorId.get(fk);
      if (!f) { f = await ctx.db.insert("floors", { buildingId: b, label: r.floor }); floorId.set(fk, f); createdFloors++; }
      await ctx.db.insert("units", { buildingId: b, floorId: f, number: r.unit, areaM2: r.areaM2, category: r.category, ratePerM2: r.ratePerM2, status: "vacant" });
    }
    await audit(ctx, u, "import.units", "units", "bulk", `units=${clean.length} buildings=${createdBuildings} floors=${createdFloors}`);
    return { units: clean.length, buildings: createdBuildings, floors: createdFloors };
  },
});

async function evalRenters(ctx: QueryCtx, rows: RenterRow[]) {
  if (rows.length === 0) fail("import_empty");
  if (rows.length > MAX_ROWS) fail("import_too_many_rows");
  const issues: Issue[] = [];
  const seenTin = new Set<string>(); const seenName = new Set<string>();
  const clean: { kind: "company" | "individual"; name: string; tin?: string; businessLicenseNo?: string; phone: string; email?: string; legalRepresentative?: string; idNumber?: string; address?: string; contactPerson?: string; contactPhone?: string; vatNumber?: string; notes?: string }[] = [];
  for (const r of rows) {
    const bad = (field: string, code: string) => issues.push({ row: r.row, field, code });
    const name = r.name.trim();
    if (!name) bad("name", "required");
    const kind = key(r.kind) === "company" || key(r.kind) === "individual" ? (key(r.kind) as "company" | "individual") : null;
    if (!kind) bad("kind", "kind");
    const phone = r.phone.trim();
    if (!phone) bad("phone", "required"); else if (!isPhone(phone)) bad("phone", "phone");
    const tin = r.tin.replace(/\s/g, "");
    if (kind === "company" && !tin) bad("tin", "required"); else if (tin && !isTin(tin)) bad("tin", "tin");
    if (r.email.trim() && !isEmail(r.email)) bad("email", "email");
    const idNo = (r.idNumber ?? "").trim(), vat = (r.vat ?? "").replace(/\s/g, ""), cPhone = (r.contactPhone ?? "").trim();
    const idMissing = kind === "individual" && !tin && !idNo;
    if (idMissing) bad("idNumber", "id_or_tin");
    if (vat && !/^\d{6,15}$/.test(vat)) bad("vat", "vat");
    if (cPhone && !isPhone(cPhone)) bad("contactPhone", "phone");
    if (idMissing || (vat && !/^\d{6,15}$/.test(vat)) || (cPhone && !isPhone(cPhone))) continue;
    if (!name || !kind || !phone || !isPhone(phone) || (kind === "company" && !tin) || (tin && !isTin(tin)) || (r.email.trim() && !isEmail(r.email))) continue;

    const nameKey = `${key(name)}|${normalizePhone(phone)}`;
    if ((tin && seenTin.has(tin)) || seenName.has(nameKey)) { bad(tin ? "tin" : "name", "duplicate_in_file"); continue; }
    if (tin) seenTin.add(tin); seenName.add(nameKey);
    if (tin && (await ctx.db.query("renters").withIndex("by_tin", (q) => q.eq("tin", tin)).first())) { bad("tin", "already_exists"); continue; }
    const sameName = await ctx.db.query("renters").withIndex("by_name", (q) => q.eq("name", name)).collect();
    if (sameName.some((x) => normalizePhone(x.phone) === normalizePhone(phone))) { bad("name", "already_exists"); continue; }
    clean.push({ kind: kind!, name, ...(tin ? { tin } : {}), ...(r.license.trim() ? { businessLicenseNo: r.license.trim() } : {}), phone: normalizePhone(phone), ...(r.email.trim() ? { email: r.email.trim() } : {}), ...(r.rep.trim() ? { legalRepresentative: r.rep.trim() } : {}), ...(idNo ? { idNumber: idNo } : {}), ...((r.address ?? "").trim() ? { address: r.address!.trim() } : {}), ...((r.contactPerson ?? "").trim() ? { contactPerson: r.contactPerson!.trim() } : {}), ...(cPhone ? { contactPhone: normalizePhone(cPhone) } : {}), ...(vat ? { vatNumber: vat } : {}), ...((r.notes ?? "").trim() ? { notes: r.notes!.trim() } : {}) });
  }
  return { issues, clean, summary: { rows: rows.length, valid: rows.length - new Set(issues.map((i) => i.row)).size } };
}

export const checkRenters = query({
  args: { rows: v.array(renterRow) },
  handler: async (ctx, { rows }) => {
    await requireRole(ctx, "propertyManager", "financeOfficer");
    const { issues, summary } = await evalRenters(ctx, rows);
    return { issues, summary };
  },
});

export const commitRenters = mutation({
  args: { rows: v.array(renterRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    const { issues, clean } = await evalRenters(ctx, rows);
    if (issues.length > 0) fail("import_has_errors");
    for (const r of clean) await ctx.db.insert("renters", r);
    await audit(ctx, u, "import.renters", "renters", "bulk", `renters=${clean.length}`);
    return { renters: clean.length };
  },
});


// ---------------------------------------------------------------------------------------------------------------
// Agreements and opening balances: the records a mall already has when it starts using the system.
// Dates and amounts are read on the screen (so a bad cell is named by its row) and arrive here as numbers.
// ---------------------------------------------------------------------------------------------------------------
const AGREEMENT_CHUNK = 150;
const agreementRow = v.object({
  row: v.number(), building: v.string(), unit: v.string(), renter: v.string(),
  startsAt: v.number(), endsAt: v.number(), basis: v.union(v.literal("perM2"), v.literal("fixed")), amount: v.number(),
  dueDay: v.number(), deposit: v.number(), depositPaid: v.optional(v.number()), escPercent: v.optional(v.number()), escMonths: v.optional(v.number()),
});
type AgreementRow = typeof agreementRow.type;

/** Find a renter by TIN (exactly 10 digits) or by name. */
function findRenter(byTin: Map<string, Doc<"renters">[]>, byName: Map<string, Doc<"renters">[]>, text: string): { renter?: Doc<"renters">; error?: "renter_not_found" | "renter_ambiguous" } {
  const t = text.trim();
  const hits = (isTin(t) ? byTin.get(t.replace(/\s/g, "")) : byName.get(key(t))) ?? [];
  if (hits.length === 0) return { error: "renter_not_found" };
  if (hits.length > 1) return { error: "renter_ambiguous" };
  return { renter: hits[0] };
}
const indexRenters = (renters: Iterable<Doc<"renters">>) => {
  const byTin = new Map<string, Doc<"renters">[]>(), byName = new Map<string, Doc<"renters">[]>();
  for (const r of renters) {
    if (r.tin) byTin.set(r.tin, [...(byTin.get(r.tin) ?? []), r]);
    byName.set(key(r.name), [...(byName.get(key(r.name)) ?? []), r]);
  }
  return { byTin, byName };
};

async function evalAgreements(ctx: QueryCtx, u: Doc<"users">, rows: AgreementRow[]) {
  if (rows.length === 0) fail("import_empty");
  if (rows.length > MAX_ROWS) fail("import_too_many_rows");
  const issues: Issue[] = [];
  const [units, renters, buildingsAll, agreements] = await Promise.all([unitMap(ctx), renterMap(ctx), ctx.db.query("buildings").collect(), ctx.db.query("agreements").collect()]);
  const buildings = new Map(buildingsAll.map((b) => [key(b.name), b]));
  const unitsByKey = new Map<string, Doc<"units">[]>();
  for (const x of units.values()) unitsByKey.set(key(x.number), [...(unitsByKey.get(key(x.number)) ?? []), x]);
  const { byTin, byName } = indexRenters(renters.values());
  const taken = new Map<Id<"units">, [number, number, string][]>(); // time ranges already used on a unit (existing agreements, then rows of this file)
  for (const a of agreements) if (a.status !== "terminated") taken.set(a.unitId, [...(taken.get(a.unitId) ?? []), [a.startsAt, a.endsAt, String(a.renterId)]]);
  const seen = new Set<string>();
  const now = Date.now();
  const clean: { row: number; unitId: Id<"units">; renterId: Id<"renters">; startsAt: number; endsAt: number; rent: { kind: "perM2"; ratePerM2: number } | { kind: "fixed"; amount: number }; dueDay: number; deposit: number; held: number; escalation?: { percent: number; everyMonths: number }; status: "active" | "expired" }[] = [];

  for (const r of rows) {
    const bad = (field: string, code: string) => issues.push({ row: r.row, field, code });
    let unit: Doc<"units"> | undefined;
    const bName = r.building.trim();
    if (!r.unit.trim()) bad("unit", "required");
    else if (bName) {
      const b = buildings.get(key(bName));
      if (!b) bad("building", "building_not_found");
      else unit = (unitsByKey.get(key(r.unit)) ?? []).find((x) => x.buildingId === b._id) ?? (bad("unit", "unit_not_found"), undefined);
    } else {
      const hits = unitsByKey.get(key(r.unit)) ?? [];
      if (hits.length === 0) bad("unit", "unit_not_found"); else if (hits.length > 1) bad("building", "unit_ambiguous"); else unit = hits[0];
    }
    if (unit && !canSeeBuilding(u, unit.buildingId)) { bad("unit", "forbidden_building"); unit = undefined; }
    const rr = r.renter.trim() ? findRenter(byTin, byName, r.renter) : { error: "required" as const };
    if ("error" in rr && rr.error) bad("renter", rr.error);
    if (!(r.endsAt > r.startsAt)) bad("endsAt", "end_before_start");
    if (!Number.isSafeInteger(r.amount) || r.amount < 0) bad("amount", "invalid_amount");
    if (!Number.isInteger(r.dueDay) || r.dueDay < 1 || r.dueDay > 28) bad("dueDay", "due_day");
    if (!Number.isSafeInteger(r.deposit) || r.deposit < 0) bad("deposit", "invalid_amount");
    if (r.depositPaid !== undefined && (!Number.isSafeInteger(r.depositPaid) || r.depositPaid < 0)) bad("depositPaid", "invalid_amount");
    const hasEsc = r.escPercent !== undefined && r.escPercent !== 0;
    if (hasEsc && !(r.escPercent! > 0 && r.escPercent! <= 100)) bad("escPercent", "invalid_escalation");
    if (hasEsc && !(Number.isInteger(r.escMonths ?? 12) && (r.escMonths ?? 12) >= 1 && (r.escMonths ?? 12) <= 60)) bad("escMonths", "invalid_escalation");
    if (!unit || !("renter" in rr) || !rr.renter) continue;
    if (issues.some((i) => i.row === r.row)) continue;

    const dupKey = `${unit._id}|${rr.renter._id}|${r.startsAt}`;
    if (seen.has(dupKey)) { bad("unit", "duplicate_in_file"); continue; }
    seen.add(dupKey);
    const existingSame = agreements.find((a) => a.unitId === unit!._id && a.renterId === rr.renter!._id && a.startsAt === r.startsAt);
    if (existingSame) { bad("unit", "already_exists"); continue; }
    if ((taken.get(unit._id) ?? []).some(([s, e]) => rangesOverlap([s, e], [r.startsAt, r.endsAt]))) { bad("startsAt", "overlaps"); continue; }
    taken.set(unit._id, [...(taken.get(unit._id) ?? []), [r.startsAt, r.endsAt, String(rr.renter._id)]]);
    clean.push({
      row: r.row, unitId: unit._id, renterId: rr.renter._id, startsAt: r.startsAt, endsAt: r.endsAt,
      rent: r.basis === "fixed" ? { kind: "fixed", amount: r.amount } : { kind: "perM2", ratePerM2: r.amount },
      dueDay: r.dueDay, deposit: r.deposit, held: r.depositPaid ?? r.deposit,
      ...(hasEsc ? { escalation: { percent: r.escPercent!, everyMonths: r.escMonths ?? 12 } } : {}),
      status: r.endsAt <= now ? "expired" : "active",
    });
  }
  const states = { active: clean.filter((c) => c.status === "active").length, expired: clean.filter((c) => c.status === "expired").length };
  return { issues, clean, summary: { rows: rows.length, valid: rows.length - new Set(issues.map((i) => i.row)).size, ...states } };
}

/** Check a spreadsheet of current and past leases without saving anything. */
export const checkAgreements = query({
  args: { rows: v.array(agreementRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "propertyManager", "approver");
    const { issues, summary } = await evalAgreements(ctx, u, rows);
    return { issues, summary, chunk: AGREEMENT_CHUNK };
  },
});

/**
 * Save leases brought in from the old records. They go straight to active (or expired when they have already ended),
 * because they were agreed and signed long ago; that bypasses the normal review, so only an approver may do it, and
 * every imported lease is marked and logged. Send at most 150 rows per call; the screen splits larger files.
 */
export const commitAgreements = mutation({
  args: { rows: v.array(agreementRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "approver");
    if (rows.length > AGREEMENT_CHUNK) fail("import_in_smaller_groups");
    const { issues, clean } = await evalAgreements(ctx, u, rows);
    if (issues.length > 0) fail("import_has_errors");
    const now = Date.now();
    const units = new Set<Id<"units">>();
    for (const c of clean) {
      const id = await ctx.db.insert("agreements", { unitId: c.unitId, renterId: c.renterId, status: c.status, startsAt: c.startsAt, endsAt: c.endsAt, createdBy: u._id, importedAt: now });
      await ctx.db.insert("agreementTerms", { agreementId: id, effectiveFrom: c.startsAt, rent: c.rent, dueDay: c.dueDay, depositAmount: c.deposit, ...(c.escalation ? { escalation: c.escalation } : {}), createdBy: u._id });
      await ctx.db.insert("deposits", { agreementId: id, required: c.deposit, held: c.held, deductions: [], refunded: 0 });
      units.add(c.unitId);
    }
    for (const unitId of units) await refreshUnitStatus(ctx, unitId);
    await audit(ctx, u, "import.agreements", "agreements", "bulk", `agreements=${clean.length}`);
    return { agreements: clean.length, active: clean.filter((c) => c.status === "active").length, expired: clean.filter((c) => c.status === "expired").length };
  },
});

const openingRow = v.object({ row: v.number(), building: v.string(), unit: v.string(), renter: v.string(), amount: v.number(), dueAt: v.number(), note: v.string() });
type OpeningRow = typeof openingRow.type;

async function evalOpening(ctx: QueryCtx, u: Doc<"users">, rows: OpeningRow[]) {
  if (rows.length === 0) fail("import_empty");
  if (rows.length > MAX_ROWS) fail("import_too_many_rows");
  const issues: Issue[] = [];
  const [units, renters, agreements, buildingsAll] = await Promise.all([unitMap(ctx), renterMap(ctx), ctx.db.query("agreements").collect(), ctx.db.query("buildings").collect()]);
  const buildings = new Map(buildingsAll.map((b) => [key(b.name), b]));
  const { byTin, byName } = indexRenters(renters.values());
  const seen = new Set<string>();
  const clean: { row: number; renterId: Id<"renters">; agreementId: Id<"agreements">; unitId: Id<"units">; amount: number; dueAt: number; note: string; key: string }[] = [];
  for (const r of rows) {
    const bad = (field: string, code: string) => issues.push({ row: r.row, field, code });
    if (!Number.isSafeInteger(r.amount) || r.amount === 0) { bad("amount", "invalid_amount"); continue; }
    if (!Number.isFinite(r.dueAt)) { bad("dueAt", "date"); continue; }
    const rr = r.renter.trim() ? findRenter(byTin, byName, r.renter) : { error: "required" as const };
    if (!("renter" in rr) || !rr.renter) { bad("renter", rr.error ?? "renter_not_found"); continue; }
    // which lease the balance belongs to: the renter's agreement on the named unit, or their only unit
    let mine = agreements.filter((a) => a.renterId === rr.renter!._id && a.status !== "draft");
    if (r.unit.trim()) {
      const bName = r.building.trim();
      mine = mine.filter((a) => { const un = units.get(a.unitId); return !!un && key(un.number) === key(r.unit) && (!bName || buildings.get(key(bName))?._id === un.buildingId); });
      if (mine.length === 0) { bad("unit", "no_agreement_for_unit"); continue; }
    } else if (new Set(mine.map((a) => a.unitId)).size > 1) { bad("unit", "unit_needed"); continue; }
    else if (mine.length === 0) { bad("renter", "no_agreement"); continue; }
    const ag = mine.sort((a, b) => b.startsAt - a.startsAt)[0]!;
    const unit = units.get(ag.unitId);
    if (!unit || !canSeeBuilding(u, unit.buildingId)) { bad("unit", "forbidden_building"); continue; }
    const k = `${rr.renter._id}|${ag.unitId}|${r.amount}|${r.dueAt}|${r.note.trim().toLowerCase()}`;
    if (seen.has(k)) { bad("amount", "duplicate_in_file"); continue; }
    seen.add(k);
    // a file can be run twice without doubling anything: the same bill (or credit) is recognised and refused
    let exists = false;
    if (r.amount > 0) exists = (await ctx.db.query("invoices").withIndex("by_agreement_period", (q) => q.eq("agreementId", ag._id).eq("period", "opening")).collect()).some((i) => i.total === r.amount && i.dueAt === r.dueAt);
    else exists = (await ctx.db.query("renterCredits").withIndex("by_renter", (q) => q.eq("renterId", rr.renter!._id)).collect()).some((c) => c.openingKey === k);
    if (exists) { bad("amount", "already_exists"); continue; }
    clean.push({ row: r.row, renterId: rr.renter._id, agreementId: ag._id, unitId: ag.unitId, amount: r.amount, dueAt: r.dueAt, note: r.note.trim(), key: k });
  }
  const owed = clean.filter((c) => c.amount > 0).reduce((s, c) => s + c.amount, 0);
  const credit = clean.filter((c) => c.amount < 0).reduce((s, c) => s - c.amount, 0);
  return { issues, clean, summary: { rows: rows.length, valid: rows.length - new Set(issues.map((i) => i.row)).size, owed, credit } };
}

export const checkOpening = query({
  args: { rows: v.array(openingRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "financeOfficer", "approver");
    const { issues, summary } = await evalOpening(ctx, u, rows);
    return { issues, summary, chunk: AGREEMENT_CHUNK };
  },
});

/**
 * Carry in what each renter owed (a positive amount) or had paid in advance (a negative amount) on the day of go-live.
 * An amount owed becomes an issued bill numbered OPEN-00001… with the period "opening" and its ORIGINAL due date, so
 * arrears ageing is right from day one. A prepayment becomes credit on the renter's account. Only an approver may do this.
 */
export const commitOpening = mutation({
  args: { rows: v.array(openingRow) },
  handler: async (ctx, { rows }) => {
    const u = await requireRole(ctx, "approver");
    if (rows.length > AGREEMENT_CHUNK) fail("import_in_smaller_groups");
    const { issues, clean } = await evalOpening(ctx, u, rows);
    if (issues.length > 0) fail("import_has_errors");
    let bills = 0, credits = 0;
    for (const c of clean) {
      if (c.amount > 0) {
        const unit = await ctx.db.get(c.unitId);
        const number = `OPEN-${String(await nextSeq(ctx, "openingSeq")).padStart(5, "0")}`;
        const id = await ctx.db.insert("invoices", { number, agreementId: c.agreementId, unitId: c.unitId, renterId: c.renterId, period: "opening", status: "issued", total: c.amount, dueAt: c.dueAt, issuedBy: u._id, issuedAt: Date.now(), buildingId: unit?.buildingId });
        await ctx.db.insert("invoiceLines", { invoiceId: id, kind: "other", description: "Opening balance", amount: c.amount, calcNote: c.note || "Carried in from the previous records" });
        await refreshInvoice(ctx, id);
        bills++;
      } else {
        await ctx.db.insert("renterCredits", { renterId: c.renterId, amount: -c.amount, openingKey: c.key });
        credits++;
      }
    }
    await audit(ctx, u, "import.opening", "invoices", "bulk", `bills=${bills} credits=${credits}`);
    return { bills, credits };
  },
});


/** What is already in the system, for the go-live checklist at the top of the import screen. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "propertyManager", "financeOfficer", "approver");
    const [units, renters, agreements, opening] = await Promise.all([
      ctx.db.query("units").collect(), ctx.db.query("renters").collect(), ctx.db.query("agreements").collect(),
      ctx.db.query("invoices").withIndex("by_period", (q) => q.eq("period", "opening")).collect(),
    ]);
    return {
      units: units.length, buildings: new Set(units.map((u) => u.buildingId)).size, renters: renters.length,
      agreements: agreements.length, activeAgreements: agreements.filter((a) => a.status === "active").length,
      openingBills: opening.length, openingTotal: opening.reduce((a, i) => a + i.total, 0),
    };
  },
});
