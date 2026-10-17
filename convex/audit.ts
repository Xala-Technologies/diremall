import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRole } from "./lib/access";

export const recent = query({
  args: { entity: v.optional(v.string()), entityId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const u = await requireRole(ctx, "auditor", "accessAdmin");
    const limit = Math.min(a.limit ?? 100, 500);
    const rows = a.entity && a.entityId
      ? await ctx.db.query("auditLog").withIndex("by_entity", (q) => q.eq("entity", a.entity!).eq("entityId", a.entityId!)).order("desc").filter((q) => q.eq(q.field("orgId"), u.orgId)).take(limit)
      : await ctx.db.query("auditLog").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).order("desc").take(limit);
    return Promise.all(rows.map(async (r) => ({ ...r, actorName: (await ctx.db.get(r.actorId))?.name ?? "" })));
  },
});
