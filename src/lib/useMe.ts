"use client";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Current staff member and a role check. Buttons are hidden for roles that lack them; the server enforces the same rules. */
export function useMe() {
  const me = useQuery(api.users.me);
  const can = (...roles: string[]) => !!me && (me.roles.includes("superAdmin") || roles.some((r) => (me.roles as string[]).includes(r)));
  return { me, can };
}
