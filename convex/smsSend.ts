"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Sends queued messages through whichever SMS gateway Dire Mall contracts.
 * Configure SMS_API_URL, SMS_API_KEY and SMS_SENDER in the Convex environment.
 * With no gateway configured, messages simply stay queued.
 */
export const dispatch = internalAction({
  args: {},
  handler: async (ctx) => {
    const url = process.env.SMS_API_URL;
    const key = process.env.SMS_API_KEY;
    if (!url || !key) return { sent: 0, reason: "gateway_not_configured" };
    const batch = await ctx.runMutation(internal.smsQueue.claimQueued, {});
    let sent = 0;
    for (const m of batch) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ to: m.to, from: process.env.SMS_SENDER ?? "DireMall", message: m.body, reference: m.id }),
        });
        await ctx.runMutation(internal.smsQueue.setStatus, { id: m.id, status: res.ok ? "accepted" : res.status >= 500 ? "uncertain" : "failed" });
        if (res.ok) sent++;
      } catch {
        // network failure: we cannot tell whether the gateway got it
        await ctx.runMutation(internal.smsQueue.setStatus, { id: m.id, status: "uncertain" });
      }
    }
    return { sent };
  },
});
