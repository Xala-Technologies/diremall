import { mutation } from "./_generated/server";
import { requireRole } from "./lib/access";

/** Short-lived upload URL for contracts, plans, evidence. Download URLs are only issued after a scope check. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, "propertyManager", "financeOfficer");
    return await ctx.storage.generateUploadUrl();
  },
});
