"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Sends queued messages through whichever SMS gateway Dire Mall contracts.
 * Configure SMS_API_URL, SMS_API_KEY and SMS_SENDER in the Convex environment.
 * With no gateway configured, messages simply stay queued. Quiet hours, the daily limit and retry back-off are applied when
 * messages are claimed (see smsQueue.claimQueued).
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
          signal: AbortSignal.timeout(15_000),
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ to: m.to, from: process.env.SMS_SENDER ?? "DireMall", message: m.body, reference: m.id }),
        });
        // 2xx accepted; 429 "slow down" is retried later; 5xx and silence are "uncertain" (it may have been delivered, so we
        // do not resend on our own); any other refusal is final
        const outcome = res.ok ? "accepted" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "unsure" : "rejected";
        await ctx.runMutation(internal.smsQueue.finish, { id: m.id, outcome, ...(res.ok ? {} : { error: `gateway_${res.status}` }) });
        if (res.ok) sent++;
      } catch {
        await ctx.runMutation(internal.smsQueue.finish, { id: m.id, outcome: "unsure", error: "no_answer" });
      }
    }
    return { sent };
  },
});
