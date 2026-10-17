import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * Moves a deployment that was built for one company into the multi-company model. Safe to run twice.
 *   npx convex run tenancy:moveIntoCompany '{"name":"Dire Mall","slug":"dire-mall"}'
 * 1. creates the company (or finds it by slug),
 * 2. puts every business record into it,
 * 3. turns each person's roles and buildings into a membership and each waiting request into an access request,
 * 4. makes the first administrator a platform admin (or the address in BOOTSTRAP_PLATFORM_EMAIL).
 */
export const TENANT_TABLES = [
  "buildings", "floors", "units", "renters", "renterDocuments", "agreements", "agreementTerms", "invoices", "invoiceLines", "invoiceAdjustments", "payments",
  "paymentAllocations", "renterCredits", "deposits", "meters", "meterReadings", "sharedCosts", "sharedCostAllocations", "handovers", "invites", "organization",
  "settings", "bankStatementEntries", "smsMessages", "smsTemplates", "auditLog",
] as const;

/** Everything a company's export contains, and everything deleting a company removes. */
export const EXPORT_TABLES = [...TENANT_TABLES, "memberships", "accessRequests", "smsConfig"] as const;
/** What deleting a company removes besides the exported tables. */
const PURGE_EXTRA = ["fileOwners"] as const;

export const createCompany = internalMutation({
  args: { name: v.string(), slug: v.string() },
  handler: async (ctx, { name, slug }): Promise<Id<"organizations">> => {
    const existing = await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (existing) return existing._id;
    return ctx.db.insert("organizations", {
      name, slug, status: "active", plan: "enterprise", limits: { units: 0, seats: 0, smsPerMonth: 0 },
      currency: "ETB", tzOffsetHours: 3, defaultLang: "en", defaultCalendar: "gregorian", country: "ET",
    });
  },
});

export const tagPage = internalMutation({
  args: { table: v.string(), orgId: v.id("organizations"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, orgId, cursor }) => {
    const page = await (ctx.db.query(table as never) as any).paginate({ numItems: 200, cursor });
    let changed = 0;
    for (const row of page.page as { _id: Id<any>; orgId?: Id<"organizations"> }[]) if (!row.orgId) { await ctx.db.patch(row._id, { orgId } as never); changed++; }
    return { next: page.isDone ? null : (page.continueCursor as string), changed };
  },
});

export const movePeople = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }): Promise<{ memberships: number; requests: number; platform: number }> => {
    const users = await ctx.db.query("users").collect();
    const bootstrap = process.env.BOOTSTRAP_PLATFORM_EMAIL?.trim().toLowerCase();
    const firstSuper = users.filter((u) => (u.roles ?? []).includes("superAdmin")).sort((a, b) => a._creationTime - b._creationTime)[0];
    let memberships = 0, requests = 0, platform = 0;
    for (const u of users) {
      const had = await ctx.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", u._id)).unique();
      if (u.accessStatus && !had) {
        if (!(await ctx.db.query("accessRequests").withIndex("by_user", (q) => q.eq("userId", u._id)).first())) {
          await ctx.db.insert("accessRequests", { orgId, userId: u._id, status: u.accessStatus, note: u.accessNote, requestedAt: u.requestedAt ?? u._creationTime, decisionReason: u.decisionReason, decidedAt: u.decidedAt }); requests++;
        }
      } else if (!had && (u.roles ?? []).length > 0) {
        await ctx.db.insert("memberships", { orgId, userId: u._id, roles: u.roles ?? [], buildingScope: u.buildingScope ?? "all", status: u.active ? "active" : "suspended" }); memberships++;
        await ctx.db.patch(u._id, { activeOrgId: orgId, active: true });
      }
      const makePlatform = bootstrap ? (u.email ?? "").toLowerCase() === bootstrap : firstSuper?._id === u._id;
      if (makePlatform && u.platformRole !== "platformAdmin") { await ctx.db.patch(u._id, { platformRole: "platformAdmin", active: true }); platform++; }
    }
    return { memberships, requests, platform };
  },
});

export const moveIntoCompany = internalAction({
  args: { name: v.string(), slug: v.string() },
  handler: async (ctx, { name, slug }): Promise<unknown> => {
    const orgId: Id<"organizations"> = await ctx.runMutation(internal.tenancy.createCompany, { name, slug });
    const counts: Record<string, number> = {};
    for (const table of TENANT_TABLES) {
      let cursor: string | null = null; counts[table] = 0;
      do {
        const r: { next: string | null; changed: number } = await ctx.runMutation(internal.tenancy.tagPage, { table, orgId, cursor });
        counts[table]! += r.changed; cursor = r.next;
      } while (cursor);
    }
    const people: { memberships: number; requests: number; platform: number } = await ctx.runMutation(internal.tenancy.movePeople, { orgId });
    return { orgId, tagged: counts, ...people };
  },
});


// ---------------------------------------------------------------------------------------------------------------
// Deleting a company for good (only after it has been cancelled)
// ---------------------------------------------------------------------------------------------------------------

/** One page of one table: its rows and any stored files they point to are removed. Returns how many are left to look at. */
export const purgePage = internalMutation({
  args: { orgId: v.id("organizations"), table: v.string() },
  handler: async (ctx, { orgId, table }) => {
    if (!(EXPORT_TABLES as readonly string[]).includes(table) && !(PURGE_EXTRA as readonly string[]).includes(table)) return 0;
    const rows = await (ctx.db.query(table as never) as any).withIndex("by_org", (q: any) => q.eq("orgId", orgId)).take(200) as Record<string, any>[];
    for (const r of rows) {
      for (const f of ["fileId", "signedFileId", "evidenceFileId", "planFileId"]) if (r[f]) await ctx.storage.delete(r[f]).catch(() => undefined);
      await ctx.db.delete(r._id);
    }
    return rows.length;
  },
});

export const purgeFinish = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    for (const s of await ctx.db.query("supportSessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) await ctx.db.delete(s._id);
    for (const e of await ctx.db.query("dataExports").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()) { if (e.storageId) await ctx.storage.delete(e.storageId).catch(() => undefined); await ctx.db.delete(e._id); }
    for (const u of await ctx.db.query("users").collect()) if (u.activeOrgId === orgId) await ctx.db.patch(u._id, { activeOrgId: undefined });
    await ctx.db.delete(orgId);
  },
});

export const purge = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }): Promise<number> => {
    let total = 0;
    for (const table of [...EXPORT_TABLES, ...PURGE_EXTRA]) { for (let i = 0; i < 500; i++) { const n: number = await ctx.runMutation(internal.tenancy.purgePage, { orgId, table }); total += n; if (n === 0) break; } }
    await ctx.runMutation(internal.tenancy.purgeFinish, { orgId });
    return total;
  },
});
