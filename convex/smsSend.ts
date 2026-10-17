"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { decryptSecret } from "./lib/crypto";

/**
 * Sends queued messages, company by company, through each company's own SMS gateway (set in its Settings, key stored encrypted).
 * A company without one falls back to the platform's shared gateway if there is one (SMS_API_URL, SMS_API_KEY, SMS_SENDER in the
 * Convex environment); with neither, its messages stay queued. Quiet hours, the daily limit and retry back-off are applied when
 * messages are claimed (see smsQueue.claimQueued).
 */
export const dispatch = internalAction({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, { orgId }) => {
    const targets: { orgId: Id<"organizations">; slug: string; name: string; config: { apiUrl: string; apiKeyEnc: string; sender: string } | null }[] = await ctx.runQuery(internal.smsQueue.dispatchTargets, { orgId });
    let sent = 0;
    for (const t of targets) {
      let url = process.env.SMS_API_URL, key = process.env.SMS_API_KEY, sender = process.env.SMS_SENDER ?? t.name.slice(0, 11);
      if (t.config) {
        try { key = await decryptSecret(t.config.apiKeyEnc); url = t.config.apiUrl; sender = t.config.sender; } catch { continue; } // cannot decrypt: leave its messages queued
      }
      if (!url || !key) continue;
      const batch = await ctx.runMutation(internal.smsQueue.claimQueued, { orgId: t.orgId });
      for (const m of batch) {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ to: m.to, from: sender, message: m.body, reference: m.id }),
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
    }
    return { sent };
  },
});
