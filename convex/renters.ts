import { v } from "convex/values";
import { assertUploadOk } from "./files";
import { mutation, query } from "./_generated/server";
import { READ_ROLES, audit, canSeeBuilding, fail, requireRole } from "./lib/access";
import { unitMap } from "./lib/bulk";
import { assertRenterVisible } from "./lib/scope";
import { isEmail, isPhone, isTin, normalizePhone } from "./lib/validate";

const extra = {
  businessLicenseNo: v.optional(v.string()),
  email: v.optional(v.string()),
  legalRepresentative: v.optional(v.string()),
  idNumber: v.optional(v.string()),
  address: v.optional(v.string()),
  contactPerson: v.optional(v.string()),
  contactPhone: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  licenseExpiresAt: v.optional(v.number()),
  notes: v.optional(v.string()),
};
const fields = {
  kind: v.union(v.literal("individual"), v.literal("company")),
  name: v.string(),
  tin: v.optional(v.string()),
  phone: v.string(),
  ...extra,
};

const blank = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

/** Trim, validate and normalise what was typed. Throws a readable error code for the first problem. */
function clean(kind: "individual" | "company", a: { name?: string; tin?: string; phone?: string; email?: string; contactPhone?: string; idNumber?: string; businessLicenseNo?: string; legalRepresentative?: string; address?: string; contactPerson?: string; vatNumber?: string; notes?: string; licenseExpiresAt?: number }) {
  if (a.name !== undefined && !a.name.trim()) fail("name_and_phone_required");
  if (a.phone !== undefined && !a.phone.trim()) fail("name_and_phone_required");
  if (a.phone && !isPhone(a.phone)) fail("invalid_phone");
  if (blank(a.contactPhone) && !isPhone(a.contactPhone!)) fail("invalid_phone");
  if (blank(a.tin) && !isTin(a.tin!)) fail("invalid_tin");
  if (blank(a.email) && !isEmail(a.email!)) fail("invalid_email");
  if (blank(a.vatNumber) && !/^\d{6,15}$/.test(a.vatNumber!.replace(/\s/g, ""))) fail("invalid_vat");
  void kind;
  return {
    name: a.name?.trim(), tin: blank(a.tin)?.replace(/\s/g, ""), phone: a.phone ? normalizePhone(a.phone) : undefined,
    email: blank(a.email), contactPhone: blank(a.contactPhone) ? normalizePhone(a.contactPhone!) : undefined,
    idNumber: blank(a.idNumber), businessLicenseNo: blank(a.businessLicenseNo), legalRepresentative: blank(a.legalRepresentative),
    address: blank(a.address), contactPerson: blank(a.contactPerson), vatNumber: blank(a.vatNumber)?.replace(/\s/g, ""), notes: blank(a.notes),
    licenseExpiresAt: a.licenseExpiresAt || undefined, // 0 clears it
  };
}

async function assertTinFree(ctx: { db: { query: (t: "renters") => { withIndex: (n: "by_tin", f: (q: { eq: (f: "tin", v: string) => unknown }) => unknown) => { collect: () => Promise<{ _id: string }[]> } } } }, tin: string | undefined, exceptId?: string) {
  if (!tin) return;
  const same = await ctx.db.query("renters").withIndex("by_tin", (q) => q.eq("tin", tin) as never).collect();
  if (same.some((r) => r._id !== exceptId)) fail("tin_already_registered");
}

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    const c = clean(a.kind, a);
    if (!c.name || !c.phone) fail("name_and_phone_required");
    if (a.kind === "company" && !c.tin) fail("company_needs_tin");
    if (a.kind === "individual" && !c.tin && !c.idNumber) fail("individual_needs_identifier");
    await assertTinFree(ctx as never, c.tin);
    const id = await ctx.db.insert("renters", { kind: a.kind, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) } as never);
    await audit(ctx, u, "renter.create", "renters", id, c.name!);
    return id;
  },
});

export const update = mutation({
  args: { renterId: v.id("renters"), patch: v.object({ name: v.optional(v.string()), tin: v.optional(v.string()), phone: v.optional(v.string()), ...extra }) },
  handler: async (ctx, { renterId, patch }) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    await assertRenterVisible(ctx, u, renterId);
    const renter = (await ctx.db.get(renterId)) ?? fail("not_found");
    const c = clean(renter.kind, patch);
    // Every field the form sends replaces the old value; a blank clears it.
    const next = { ...renter, ...Object.fromEntries(Object.keys(patch).map((k) => [k, (c as Record<string, unknown>)[k]])) };
    if (!next.name || !next.phone) fail("name_and_phone_required");
    if (next.kind === "company" && !next.tin) fail("company_needs_tin");
    if (next.kind === "individual" && !next.tin && !next.idNumber) fail("individual_needs_identifier");
    await assertTinFree(ctx as never, next.tin, renterId);
    const { _id, _creationTime, ...doc } = next;
    void _id; void _creationTime;
    await ctx.db.replace(renterId, doc);
    await audit(ctx, u, "renter.update", "renters", renterId, Object.keys(patch).join(","));
  },
});

export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    const all = await ctx.db.query("renters").withIndex("by_name").collect();
    const q = search?.trim().toLowerCase();
    const matching = all.filter((r) => !q || `${r.name} ${r.tin ?? ""} ${r.phone}`.toLowerCase().includes(q));
    if (u.buildingScope === "all") return matching;
    // limited to some buildings: a renter is visible with no lease yet, or a lease in one of those buildings.
    // Leases and units are read once as a whole, not once per renter.
    const [leases, units] = await Promise.all([ctx.db.query("agreements").collect(), unitMap(ctx)]);
    const byRenter = new Map<string, boolean[]>();
    for (const a of leases) { const un = units.get(a.unitId); byRenter.set(a.renterId, [...(byRenter.get(a.renterId) ?? []), !!un && canSeeBuilding(u, un.buildingId)]); }
    return matching.filter((r) => { const flags = byRenter.get(r._id); return !flags || flags.some(Boolean); });
  },
});

export const get = query({
  args: { renterId: v.id("renters") },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertRenterVisible(ctx, u, renterId);
    const renter = (await ctx.db.get(renterId)) ?? fail("not_found");
    const all = await ctx.db.query("agreements").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
    const agreements = [];
    for (const ag of all) { const un = await ctx.db.get(ag.unitId); if (un && canSeeBuilding(u, un.buildingId)) agreements.push(ag); }
    const docs = await ctx.db.query("renterDocuments").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
    const documents = docs.map((d) => ({ _id: d._id, kind: d.kind }));
    return { renter, agreements, documents };
  },
});

export const addDocument = mutation({
  args: { renterId: v.id("renters"), kind: v.string(), fileId: v.id("_storage") },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    await assertRenterVisible(ctx, u, a.renterId);
    await assertUploadOk(ctx, a.fileId);
    const id = await ctx.db.insert("renterDocuments", { ...a, uploadedBy: u._id });
    await audit(ctx, u, "renter.document", "renters", a.renterId, a.kind);
    return id;
  },
});
