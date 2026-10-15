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

// Document downloads: /files/<token>, where the token comes from files:ticket (role and building checked, valid 2 minutes).
http.route({
  pathPrefix: "/files/",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const token = new URL(req.url).pathname.replace(/^\/files\//, "");
    if (!/^[a-f0-9]{64}$/.test(token)) return new Response("not found", { status: 404 });
    const found = await ctx.runMutation(internal.files.redeem, { token });
    if (!found) return new Response("link expired", { status: 410, headers: { "Cache-Control": "no-store" } });
    const blob = await ctx.storage.get(found.storageId);
    if (!blob) return new Response("not found", { status: 404 });
    return new Response(blob, { status: 200, headers: {
      "Content-Type": found.contentType, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    } });
  }),
});

export default http;
