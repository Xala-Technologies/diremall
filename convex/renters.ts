import { v } from "convex/values";
import { assertUploadOk } from "./files";
import { mutation, query } from "./_generated/server";
import { READ_ROLES, audit, canSeeBuilding, fail, requireRole } from "./lib/access";
import { unitMap } from "./lib/bulk";
import { assertRenterVisible } from "./lib/scope";

const fields = {
  kind: v.union(v.literal("individual"), v.literal("company")),
  name: v.string(),
  tin: v.optional(v.string()),
  businessLicenseNo: v.optional(v.string()),
  phone: v.string(),
  email: v.optional(v.string()),
  legalRepresentative: v.optional(v.string()),
};

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    if (!a.name.trim() || !a.phone.trim()) fail("name_and_phone_required");
    if (a.kind === "company" && !a.tin) fail("company_needs_tin");
    const id = await ctx.db.insert("renters", a);
    await audit(ctx, u, "renter.create", "renters", id, a.name);
    return id;
  },
});

export const update = mutation({
  args: { renterId: v.id("renters"), patch: v.object({ name: v.optional(v.string()), tin: v.optional(v.string()), businessLicenseNo: v.optional(v.string()), phone: v.optional(v.string()), email: v.optional(v.string()), legalRepresentative: v.optional(v.string()) }) },
  handler: async (ctx, { renterId, patch }) => {
    const u = await requireRole(ctx, "propertyManager", "financeOfficer");
    await assertRenterVisible(ctx, u, renterId);
    if ((patch.name !== undefined && !patch.name.trim()) || (patch.phone !== undefined && !patch.phone.trim())) fail("name_and_phone_required");
    await ctx.db.patch(renterId, patch);
    await audit(ctx, u, "renter.update", "renters", renterId, JSON.stringify(patch));
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
    const documents = await Promise.all(docs.map(async (d) => ({ _id: d._id, kind: d.kind, url: await ctx.storage.getUrl(d.fileId) })));
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
