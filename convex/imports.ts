import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { audit, canSeeBuilding, fail, requireRole } from "./lib/access";
import { isEmail, isPhone, isTin, normalizePhone, parseNumber } from "./lib/validate";

/**
 * Bulk import from a spreadsheet. Nothing is saved until every row is valid (all or nothing),
 * and the same checks run again at save time, so a screen can never push in bad data.
 */
const MAX_ROWS = 1000;
export type Issue = { row: number; field: string; code: string };

const unitRow = v.object({ row: v.number(), building: v.string(), floor: v.string(), unit: v.string(), area: v.string(), category: v.string(), rate: v.string() });
const renterRow = v.object({ row: v.number(), kind: v.string(), name: v.string(), tin: v.string(), license: v.string(), phone: v.string(), email: v.string(), rep: v.string() });
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
  const clean: { kind: "company" | "individual"; name: string; tin?: string; businessLicenseNo?: string; phone: string; email?: string; legalRepresentative?: string }[] = [];
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
    if (!name || !kind || !phone || !isPhone(phone) || (kind === "company" && !tin) || (tin && !isTin(tin)) || (r.email.trim() && !isEmail(r.email))) continue;

    const nameKey = `${key(name)}|${normalizePhone(phone)}`;
    if ((tin && seenTin.has(tin)) || seenName.has(nameKey)) { bad(tin ? "tin" : "name", "duplicate_in_file"); continue; }
    if (tin) seenTin.add(tin); seenName.add(nameKey);
    if (tin && (await ctx.db.query("renters").withIndex("by_tin", (q) => q.eq("tin", tin)).first())) { bad("tin", "already_exists"); continue; }
    const sameName = await ctx.db.query("renters").withIndex("by_name", (q) => q.eq("name", name)).collect();
    if (sameName.some((x) => normalizePhone(x.phone) === normalizePhone(phone))) { bad("name", "already_exists"); continue; }
    clean.push({ kind: kind!, name, ...(tin ? { tin } : {}), ...(r.license.trim() ? { businessLicenseNo: r.license.trim() } : {}), phone: normalizePhone(phone), ...(r.email.trim() ? { email: r.email.trim() } : {}), ...(r.rep.trim() ? { legalRepresentative: r.rep.trim() } : {}) });
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
