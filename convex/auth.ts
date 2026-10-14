import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return { email: String(params.email).trim().toLowerCase(), name: String(params.name ?? "") };
      },
    }),
  ],
  callbacks: {
    // New accounts start inactive with no roles; the very first account bootstraps as super admin.
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (existingUserId) return;
      const first = (await ctx.db.query("users").take(2)).length === 1;
      await ctx.db.patch(userId, first
        ? { roles: ["superAdmin"], buildingScope: "all", active: true, lang: "en" }
        : { roles: [], buildingScope: [], active: false, lang: "en" });
    },
  },
});
