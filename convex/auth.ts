import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

/**
 * Who becomes the first super admin. With BOOTSTRAP_ADMIN_EMAIL set, only that address, and only while no super admin
 * exists (so someone else signing up first cannot block it). Without it, only the very first account ever created.
 */
export function shouldBootstrap(o: { only?: string; email?: string; userCount: number; hasSuperAdmin: boolean }): boolean {
  if (o.hasSuperAdmin) return false;
  if (o.only) return (o.email ?? "").trim().toLowerCase() === o.only;
  return o.userCount === 1;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid_email");
        return { email, name: String(params.name ?? "") };
      },
    }),
  ],
  callbacks: {
    // New accounts start inactive with no roles; the very first account bootstraps as super admin.
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (existingUserId) return;
      // The first account bootstraps as super admin. Set BOOTSTRAP_ADMIN_EMAIL on the deployment to restrict that to one address.
      const me = await ctx.db.get(userId);
      const only = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      const users = await ctx.db.query("users").take(500);
      const first = shouldBootstrap({ only, email: me?.email, userCount: users.length, hasSuperAdmin: users.some((u) => u.active && (u.roles ?? []).includes("superAdmin")) });
      await ctx.db.patch(userId, first
        ? { roles: ["superAdmin"], buildingScope: "all", active: true, lang: "en" }
        : { roles: [], buildingScope: [], active: false, lang: "en" });
    },
  },
});
