import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./access";
import { inOrg } from "./tenant";

type Ctx = QueryCtx | MutationCtx;

/** What a company is using against its plan. A limit of 0 means no limit. */
export async function usage(ctx: Ctx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  const [units, members, invites] = await Promise.all([
    inOrg(ctx, "units", orgId).collect(),
    ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    inOrg(ctx, "invites", orgId).collect(),
  ]);
  const seats = members.filter((m) => m.status === "active").length + invites.filter((i) => !i.usedAt && i.expiresAt > Date.now()).length;
  return { units: units.length, seats, limits: org?.limits ?? { units: 0, seats: 0, smsPerMonth: 0 } };
}

export async function assertUnitsFree(ctx: Ctx, orgId: Id<"organizations">, adding = 1) {
  const u = await usage(ctx, orgId);
  if (u.limits.units > 0 && u.units + adding > u.limits.units) fail("plan_unit_limit");
}

export async function assertSeatFree(ctx: Ctx, orgId: Id<"organizations">, adding = 1) {
  const u = await usage(ctx, orgId);
  if (u.limits.seats > 0 && u.seats + adding > u.limits.seats) fail("plan_seat_limit");
}

/** What each plan allows. 0 means no limit. The platform can set any company's limits by hand. */
export const PLANS: Record<string, { label: string; units: number; seats: number; smsPerMonth: number; trialDays?: number }> = {
  trial: { label: "Trial", units: 50, seats: 5, smsPerMonth: 200, trialDays: 30 },
  starter: { label: "Starter", units: 100, seats: 5, smsPerMonth: 500 },
  standard: { label: "Standard", units: 500, seats: 20, smsPerMonth: 3000 },
  enterprise: { label: "Enterprise", units: 0, seats: 0, smsPerMonth: 0 },
};
