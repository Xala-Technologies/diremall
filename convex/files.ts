import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { fail, requireRole } from "./lib/access";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/**
 * Checks an uploaded file once it is attached to a record: PDF or a common image, at most 15 MB.
 * The browser also limits this, but the server cannot rely on the browser. The failed request is rolled back, so the
 * stray upload is never attached to anything.
 */
export async function assertUploadOk(ctx: MutationCtx, fileId: Id<"_storage">) {
  const meta = await ctx.db.system.get(fileId);
  if (!meta) return fail("file_missing");
  if (meta.size > MAX_FILE_BYTES) return fail("file_too_large");
  if (!FILE_TYPES.includes(meta.contentType ?? "")) return fail("file_type_not_allowed");
}

/** Short-lived upload URL for contracts, plans, evidence. Download URLs are only issued after a scope check. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "propertyManager", "financeOfficer");
    return await ctx.storage.generateUploadUrl();
  },
});
