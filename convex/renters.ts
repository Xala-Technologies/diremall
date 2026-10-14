import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { READ_ROLES, audit, fail, requireRole } from "./lib/access";
import { assertRenterVisible, renterVisible } from "./lib/scope";

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
    const out = [];
    for (const r of all) {
      if (q && !`${r.name} ${r.tin ?? ""} ${r.phone}`.toLowerCase().includes(q)) continue;
      if (await renterVisible(ctx, u, r._id)) out.push(r);
    }
    return out;
  },
});

export const get = query({
  args: { renterId: v.id("renters") },
  handler: async (ctx, { renterId }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    await assertRenterVisible(ctx, u, renterId);
    const renter = (await ctx.db.get(renterId)) ?? fail("not_found");
    const agreements = await ctx.db.query("agreements").withIndex("by_renter", (q) => q.eq("renterId", renterId)).collect();
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
    const id = await ctx.db.insert("renterDocuments", { ...a, uploadedBy: u._id });
    await audit(ctx, u, "renter.document", "renters", a.renterId, a.kind);
    return id;
  },
});
