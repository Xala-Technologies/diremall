import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { sha256Hex } from "./lib/totp";

const http = httpRouter();
auth.addHttpRoutes(http);

const sameText = (a: string, b: string) => { let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(1, b.length)); return diff === 0; };

async function receipt(ctx: any, req: Request, orgId?: string) {
  let body: { id?: string; status?: string };
  try { body = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  if (typeof body.id !== "string" || (body.status !== "delivered" && body.status !== "failed")) return new Response("bad request", { status: 400 });
  try { await ctx.runMutation(internal.smsQueue.deliveryReceipt, { id: body.id as any, status: body.status, ...(orgId ? { orgId: orgId as any } : {}) }); } catch { return new Response("bad request", { status: 400 }); }
  return new Response("ok");
}

// Delivery receipts from a company's own SMS gateway: POST /sms/delivery/<company> {id, status} with header x-webhook-secret
// (the secret shown once when the gateway was saved). A receipt can only change that company's messages.
http.route({
  pathPrefix: "/sms/delivery/",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const slug = new URL(req.url).pathname.replace(/^\/sms\/delivery\//, "");
    const target = slug ? await ctx.runQuery(internal.smsQueue.webhookTarget, { slug }) : null;
    const given = req.headers.get("x-webhook-secret") ?? "";
    if (!target?.secretHash || !given || !sameText(await sha256Hex(given), target.secretHash)) return new Response("forbidden", { status: 403 });
    return receipt(ctx, req, target.orgId);
  }),
});

// Receipts from the platform's shared gateway: POST /sms/delivery with the platform secret (SMS_WEBHOOK_SECRET).
http.route({
  path: "/sms/delivery",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.SMS_WEBHOOK_SECRET;
    const given = req.headers.get("x-webhook-secret") ?? "";
    if (!secret || !sameText(given, secret)) return new Response("forbidden", { status: 403 });
    return receipt(ctx, req);
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
