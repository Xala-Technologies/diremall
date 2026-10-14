import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

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
      const first = (await ctx.db.query("users").take(2)).length === 1 && (!only || me?.email === only);
      await ctx.db.patch(userId, first
        ? { roles: ["superAdmin"], buildingScope: "all", active: true, lang: "en" }
        : { roles: [], buildingScope: [], active: false, lang: "en" });
    },
  },
});
