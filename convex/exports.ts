import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { audit, fail, hasRole, requireUser } from "./lib/access";
import { sha256Hex } from "./lib/totp";
import { EXPORT_TABLES } from "./tenancy";

/**
 * "Take all my data with me": a company's administrators can ask for a complete JSON copy of their records. It is built in the
 * background, one page per table at a time, and downloaded through the same short-lived link the documents use. It is also the
 * way out when a company leaves: a cancelled company can still ask for it.
 */
async function requester(ctx: Parameters<typeof requireUser>[0]) {
  const u = await requireUser(ctx, { allowFrozen: true });
  if (!hasRole(u, "approver")) return fail("forbidden");
  return u;
}

export const request = mutation({
  args: {},
  handler: async (ctx) => {
    const u = await requester(ctx);
    const recent = await ctx.db.query("dataExports").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).order("desc").take(5);
    if (recent.some((e) => e.status === "building" && e._creationTime > Date.now() - 15 * 60_000)) fail("export_in_progress");
    if (recent.filter((e) => e._creationTime > Date.now() - 24 * 3_600_000).length >= 3) fail("too_many_exports");
    const id = await ctx.db.insert("dataExports", { orgId: u.orgId, requestedBy: u._id, status: "building" });
    await ctx.scheduler.runAfter(0, internal.exports.build, { exportId: id });
    await audit(ctx, u, "export.request", "dataExports", id);
    return { exportId: id };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const u = await requester(ctx);
    const rows = await ctx.db.query("dataExports").withIndex("by_org", (q) => q.eq("orgId", u.orgId)).order("desc").take(10);
    return rows.map((e) => ({ _id: e._id, at: e._creationTime, status: e.status, rows: e.rows ?? 0, error: e.error ?? "" }));
  },
});

/** A link to download a finished export. Valid for two minutes, like every document link. */
export const link = mutation({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, { exportId }) => {
    const u = await requester(ctx);
    const e = await ctx.db.get(exportId);
    if (!e || e.orgId !== u.orgId || e.status !== "ready" || !e.storageId) return fail("not_found");
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    await ctx.db.insert("fileTickets", { tokenHash: await sha256Hex(token), storageId: e.storageId, contentType: "application/json", userId: u._id, expiresAt: Date.now() + 2 * 60_000 });
    await audit(ctx, u, "export.download", "dataExports", exportId);
    return { token };
  },
});

export const page = internalQuery({
  args: { orgId: v.id("organizations"), table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { orgId, table, cursor }) => {
    if (!(EXPORT_TABLES as readonly string[]).includes(table)) return { rows: [], next: null as string | null };
    const q = table === "memberships" || table === "accessRequests" || table === "smsConfig" ? ctx.db.query(table as never).withIndex("by_org" as never, (x: any) => x.eq("orgId", orgId)) : (ctx.db.query(table as never) as any).withIndex("by_org", (x: any) => x.eq("orgId", orgId));
    const r = await (q as any).paginate({ numItems: 300, cursor });
    // secrets never leave: the SMS key is stored encrypted and is left out of the copy
    const rows = (r.page as Record<string, unknown>[]).map((d) => (table === "smsConfig" ? { ...d, apiKeyEnc: undefined, webhookSecretHash: undefined } : d));
    return { rows, next: r.isDone ? null : (r.continueCursor as string) };
  },
});

export const setResult = internalMutation({
  args: { exportId: v.id("dataExports"), status: v.union(v.literal("ready"), v.literal("failed")), storageId: v.optional(v.id("_storage")), rows: v.optional(v.number()), error: v.optional(v.string()) },
  handler: async (ctx, { exportId, ...r }) => { await ctx.db.patch(exportId, r); },
});

export const build = internalAction({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, { exportId }) => {
    const job = await ctx.runQuery(internal.exports.job, { exportId });
    if (!job) return;
    try {
      const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), company: job.company, tables: {} as Record<string, unknown[]> };
      let total = 0;
      for (const table of EXPORT_TABLES) {
        const rows: unknown[] = []; let cursor: string | null = null;
        do { const r: { rows: unknown[]; next: string | null } = await ctx.runQuery(internal.exports.page, { orgId: job.orgId, table, cursor }); rows.push(...r.rows); cursor = r.next; } while (cursor);
        (out.tables as Record<string, unknown[]>)[table] = rows; total += rows.length;
      }
      const storageId: Id<"_storage"> = await ctx.storage.store(new Blob([JSON.stringify(out)], { type: "application/json" }));
      await ctx.runMutation(internal.exports.setResult, { exportId, status: "ready", storageId, rows: total });
    } catch (e) {
      await ctx.runMutation(internal.exports.setResult, { exportId, status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "failed" });
    }
  },
});

export const job = internalQuery({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, { exportId }) => {
    const e = await ctx.db.get(exportId); if (!e) return null;
    const org = await ctx.db.get(e.orgId); if (!org) return null;
    return { orgId: e.orgId, company: { name: org.name, slug: org.slug, plan: org.plan, currency: org.currency } };
  },
});
