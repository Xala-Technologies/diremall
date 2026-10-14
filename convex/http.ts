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
    const given = req.headers.get("x-webhook-secret") ?? "";
    // constant-time comparison
    let diff = given.length ^ (secret ?? "").length;
    for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ (secret ?? "").charCodeAt(i % Math.max(1, (secret ?? "").length));
    if (!secret || diff !== 0) return new Response("forbidden", { status: 403 });
    let body: { id?: string; status?: string };
    try { body = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
    if (typeof body.id !== "string" || (body.status !== "delivered" && body.status !== "failed")) return new Response("bad request", { status: 400 });
    try { await ctx.runMutation(internal.smsQueue.deliveryReceipt, { id: body.id as any, status: body.status }); } catch { return new Response("bad request", { status: 400 }); }
    return new Response("ok");
  }),
});

export default http;
