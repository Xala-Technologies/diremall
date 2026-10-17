import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { READ_ROLES, assertBuilding, fail, requireRole } from "./lib/access";
import { assertRenterVisible, assertUnitVisible } from "./lib/scope";
import { sha256Hex } from "./lib/totp";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/**
 * Checks an uploaded file once it is attached to a record: PDF or a common image, at most 15 MB.
 * The browser also limits this, but the server cannot rely on the browser. The failed request is rolled back, so the
 * stray upload is never attached to anything.
 */
export async function assertUploadOk(ctx: MutationCtx, orgId: Id<"organizations">, fileId: Id<"_storage">) {
  const meta = await ctx.db.system.get(fileId);
  if (!meta) return fail("file_missing");
  if (meta.size > MAX_FILE_BYTES) return fail("file_too_large");
  if (!FILE_TYPES.includes(meta.contentType ?? "")) return fail("file_type_not_allowed");
  // a file belongs to the first company that attaches it: another company cannot attach (and so cannot read) the same file
  const owner = await ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", fileId)).first();
  if (owner && owner.orgId !== orgId) return fail("file_not_yours");
  if (!owner) await ctx.db.insert("fileOwners", { orgId, storageId: fileId });
}

/** Short-lived upload URL for contracts, plans, evidence. Download URLs are only issued after a scope check. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "propertyManager", "financeOfficer");
    return await ctx.storage.generateUploadUrl();
  },
});

const TICKET_MS = 2 * 60 * 1000;

/**
 * Asks for a link to one stored document. The user's role and building scope are checked here; the link then works for
 * two minutes, so a copied or forwarded link soon stops working.
 */
export const ticket = mutation({
  args: { kind: v.union(v.literal("signed"), v.literal("evidence"), v.literal("renterDoc"), v.literal("plan")), id: v.string() },
  handler: async (ctx, { kind, id }) => {
    const u = await requireRole(ctx, ...READ_ROLES);
    let storageId: Id<"_storage"> | undefined;
    if (kind === "signed") {
      const ag = ctx.db.normalizeId("agreements", id); const row = ag ? await ctx.db.get(ag) : null;
      if (!row || row.orgId !== u.orgId) return fail("not_found");
      await assertUnitVisible(ctx, u, row.unitId); storageId = row.signedFileId;
    } else if (kind === "evidence") {
      const pid = ctx.db.normalizeId("payments", id); const row = pid ? await ctx.db.get(pid) : null;
      if (!row || row.orgId !== u.orgId) return fail("not_found");
      await assertRenterVisible(ctx, u, row.renterId); storageId = row.evidenceFileId;
    } else if (kind === "renterDoc") {
      const did = ctx.db.normalizeId("renterDocuments", id); const row = did ? await ctx.db.get(did) : null;
      if (!row || row.orgId !== u.orgId) return fail("not_found");
      await assertRenterVisible(ctx, u, row.renterId); storageId = row.fileId;
    } else {
      const fid = ctx.db.normalizeId("floors", id); const row = fid ? await ctx.db.get(fid) : null;
      if (!row || row.orgId !== u.orgId) return fail("not_found");
      assertBuilding(u, row.buildingId); storageId = row.planFileId;
    }
    if (!storageId) return fail("not_found");
    const meta = await ctx.db.system.get(storageId);
    if (!meta) return fail("file_missing");
    // tidy: drop a few expired links each time
    for (const old of await ctx.db.query("fileTickets").withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now())).take(20)) await ctx.db.delete(old._id);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const contentType = FILE_TYPES.includes(meta.contentType ?? "") ? (meta.contentType as string) : "application/octet-stream";
    await ctx.db.insert("fileTickets", { tokenHash: await sha256Hex(token), storageId, contentType, userId: u._id, expiresAt: Date.now() + TICKET_MS });
    return { token };
  },
});

/** Used by the download route: the document behind a still-valid link, or null. */
export const redeem = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const hash = await sha256Hex(token);
    const t = await ctx.db.query("fileTickets").withIndex("by_hash", (q) => q.eq("tokenHash", hash)).first();
    if (!t || t.expiresAt < Date.now()) return null;
    const user = await ctx.db.get(t.userId);
    if (!user || !user.active) return null; // a deactivated person's links die with the account
    return { storageId: t.storageId, contentType: t.contentType };
  },
});
