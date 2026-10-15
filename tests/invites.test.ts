import { describe, expect, it } from "vitest";
import { applySignup } from "../convex/lib/signup";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { modules, world } from "./helpers";

async function setup() {
  const w = await world();
  const adminId = await w.mk("admin", ["accessAdmin"]);
  const superId = await w.mk("boss", ["superAdmin"]);
  return { ...w, admin: w.as(adminId), boss: w.as(superId), adminId, superId };
}
/** What the sign-up flow does: create the user record carrying the typed code, then run the checks. */
const signUp = async (w: Awaited<ReturnType<typeof setup>>, email: string, code: string | undefined) =>
  w.t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email, name: "New", ...(code ? { inviteCode: code } : {}) });
    await applySignup(ctx as never, id);
    return (await ctx.db.get(id))!;
  });

describe("invitation-only sign-up", () => {
  it("a valid code activates the account with the invited roles, once", async () => {
    const w = await setup();
    const { code } = await w.admin.mutation(w.api.invites.create, { email: "New.Person@x.et", roles: ["financeOfficer"], buildingScope: "all" });
    const u = await signUp(w, "new.person@x.et", code.toLowerCase().replace("-", " "));
    expect(u.active).toBe(true);
    expect(u.roles).toEqual(["financeOfficer"]);
    expect(u.inviteCode).toBeUndefined(); // never kept
    await expect(signUp(w, "new.person@x.et", code)).rejects.toThrow(/invite_invalid/); // used up
  });

  it("refuses a missing or wrong code, someone else's email, and an expired invitation", async () => {
    const w = await setup();
    const { code } = await w.admin.mutation(w.api.invites.create, { email: "a@x.et", roles: ["propertyManager"], buildingScope: "all" });
    await expect(signUp(w, "a@x.et", undefined)).rejects.toThrow(/invite_invalid/);
    await expect(signUp(w, "a@x.et", "AAAAA-AAAAA")).rejects.toThrow(/invite_invalid/);
    await expect(signUp(w, "attacker@x.et", code)).rejects.toThrow(/invite_invalid/); // a stolen code only works for its own email
    await w.t.run(async (ctx) => { const i = (await ctx.db.query("invites").collect())[0]!; await ctx.db.patch(i._id, { expiresAt: Date.now() - 1 }); });
    await expect(signUp(w, "a@x.et", code)).rejects.toThrow(/invite_invalid/);
  });

  it("a new invitation replaces the old one, and a cancelled one stops working", async () => {
    const w = await setup();
    const first = await w.admin.mutation(w.api.invites.create, { email: "b@x.et", roles: ["auditor"], buildingScope: "all" });
    const second = await w.admin.mutation(w.api.invites.create, { email: "b@x.et", roles: ["auditor"], buildingScope: "all" });
    await expect(signUp(w, "b@x.et", first.code)).rejects.toThrow(/invite_invalid/);
    const [row] = await w.admin.query(w.api.invites.list, {});
    await w.admin.mutation(w.api.invites.revoke, { id: row!._id });
    await expect(signUp(w, "b@x.et", second.code)).rejects.toThrow(/invite_invalid/);
  });

  it("only access admins invite, only a super admin can invite a super admin, and existing emails are refused", async () => {
    const w = await setup();
    await expect(w.pm.mutation(w.api.invites.create, { email: "c@x.et", roles: ["auditor"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await expect(w.admin.mutation(w.api.invites.create, { email: "c@x.et", roles: ["superAdmin"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await w.boss.mutation(w.api.invites.create, { email: "c@x.et", roles: ["superAdmin"], buildingScope: "all" });
    await expect(w.admin.mutation(w.api.invites.create, { email: "pm@x.et", roles: ["auditor"], buildingScope: "all" })).rejects.toThrow(/email_already_registered/);
    await expect(w.admin.mutation(w.api.invites.create, { email: "d@x.et", roles: [], buildingScope: "all" })).rejects.toThrow(/roles_required/);
  });

  it("the first administrator needs no invitation, but only while no super admin exists", async () => {
    const t = convexTest(schema, modules); // an empty deployment
    const first = await t.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "first@x.et" }); await applySignup(ctx as never, id); return (await ctx.db.get(id))!; });
    expect(first.roles).toEqual(["superAdmin"]);
    await expect(t.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "second@x.et" }); await applySignup(ctx as never, id); })).rejects.toThrow(/invite_invalid/);
  });
});
