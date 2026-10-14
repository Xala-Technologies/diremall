import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

// Delivery receipts from the SMS gateway: POST {id, status} with header x-webhook-secret.
http.route({
  path: "/sms/delivery",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.SMS_WEBHOOK_SECRET;
    if (!secret || req.headers.get("x-webhook-secret") !== secret) return new Response("forbidden", { status: 403 });
    const { id, status } = await req.json();
    if (!["delivered", "failed"].includes(status)) return new Response("bad status", { status: 400 });
    await ctx.runMutation(internal.smsQueue.setStatus, { id, status });
    return new Response("ok");
  }),
});

export default http;
