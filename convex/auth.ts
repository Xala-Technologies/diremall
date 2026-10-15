import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { applySignup } from "./lib/signup";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid_email");
        // the invite code rides along on the new user record until the account is created, then it is removed
        const code = typeof params.inviteCode === "string" && params.inviteCode.trim() ? params.inviteCode.trim() : undefined;
        return { email, name: String(params.name ?? ""), ...(code ? { inviteCode: code } : {}) };
      },
    }),
  ],
  callbacks: {
    // New accounts start inactive with no roles; the very first account bootstraps as super admin.
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (existingUserId) return;
      // The first account bootstraps as super admin. Set BOOTSTRAP_ADMIN_EMAIL on the deployment to restrict that to one address.
      await applySignup(ctx as never, userId, process.env.BOOTSTRAP_ADMIN_EMAIL);
    },
  },
});
