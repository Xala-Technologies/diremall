import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { sha256Hex } from "./totp";

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
 * Runs when a new account has just been created. The first administrator is set up directly; everyone else must hold an
 * unused, unexpired invitation for exactly this email address and present its code. Otherwise this throws, which
 * cancels the whole sign-up (and even if it did not, the account would be inactive with no roles).
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
  if (!invite) throw new Error("invite_invalid");
  await ctx.db.patch(invite._id, { usedAt: Date.now() });
  await ctx.db.patch(userId, { roles: invite.roles, buildingScope: invite.buildingScope, active: true, lang: "en" });
}
