import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { sha256Hex } from "./totp";

/** More waiting requests than this stops further ones, so nobody can flood the administrator with sign-ups. */
export const MAX_PENDING = 100;

export const normalizeInviteCode = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Who becomes the first super admin. With BOOTSTRAP_ADMIN_EMAIL set, only that address, and only while no super admin
 * exists (so someone else signing up first cannot block it). Without it, only the very first account ever created.
 */
export function shouldBootstrap(o: { only?: string; email?: string; userCount: number; hasSuperAdmin: boolean }): boolean {
  if (o.hasSuperAdmin) return false;
  if (o.only) return (o.email ?? "").trim().toLowerCase() === o.only;
  return o.userCount === 1;
}

/**
 * Runs when a new account has just been created. The first administrator is set up directly. Someone with an unused,
 * unexpired invitation for exactly this email address gets the invited roles at once. Someone with a wrong code is
 * refused. Anyone else becomes a pending request: inactive, no roles, until an access admin approves or declines.
 */
export async function applySignup(ctx: MutationCtx, userId: Id<"users">, bootstrapEmail?: string) {
  const me = await ctx.db.get(userId);
  const code = me?.inviteCode ?? "";
  if (code) await ctx.db.patch(userId, { inviteCode: undefined }); // never keep the code
  const users = await ctx.db.query("users").take(500);
  const first = shouldBootstrap({
    only: bootstrapEmail?.trim().toLowerCase(), email: me?.email, userCount: users.length,
    hasSuperAdmin: users.some((u) => u.active && (u.roles ?? []).includes("superAdmin")),
  });
  if (first) {
    await ctx.db.patch(userId, { roles: ["superAdmin"], buildingScope: "all", active: true, lang: "en" });
    return;
  }
  const email = (me?.email ?? "").trim().toLowerCase();
  const invites = (await ctx.db.query("invites").take(1000)).filter((i) => i.email === email);
  const hash = code ? await sha256Hex(normalizeInviteCode(code)) : "";
  const invite = invites.find((i) => !i.usedAt && i.expiresAt > Date.now() && i.codeHash === hash);
  if (!invite) {
    // A wrong code is an error the person can fix. No code at all is a request for access, decided by an administrator.
    if (code) throw new Error("invite_invalid");
    const waiting = users.filter((u) => u.accessStatus === "pending").length;
    if (waiting >= MAX_PENDING) throw new Error("too_many_requests");
    await ctx.db.patch(userId, { roles: [], active: false, accessStatus: "pending", requestedAt: Date.now(), lang: "en" });
    return;
  }
  await ctx.db.patch(invite._id, { usedAt: Date.now() });
  await ctx.db.patch(userId, { roles: invite.roles, buildingScope: invite.buildingScope, active: true, lang: "en" });
}
