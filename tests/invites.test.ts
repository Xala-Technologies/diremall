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

  it("refuses a wrong code, someone else's email, and an expired invitation", async () => {
    const w = await setup();
    const { code } = await w.admin.mutation(w.api.invites.create, { email: "a@x.et", roles: ["propertyManager"], buildingScope: "all" });
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
    const second = await t.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "second@x.et" }); await applySignup(ctx as never, id); return (await ctx.db.get(id))!; });
    expect(second).toMatchObject({ active: false, accessStatus: "pending" }); // not an administrator: a request
  });
});

describe("requests for access", () => {
  it("someone who signs up without an invitation waits, with no access, until an access admin decides", async () => {
    const w = await setup();
    const u = await signUp(w, "newbie@x.et", undefined);
    expect(u).toMatchObject({ active: false, accessStatus: "pending", roles: [] });
    expect(u.requestedAt).toBeGreaterThan(0);
    const me = w.as(u._id);
    await expect(me.query(w.api.properties.listBuildings, {})).rejects.toThrow(/inactive/); // no data while waiting
    expect(await me.query(w.api.users.myAccess, {})).toMatchObject({ status: "pending" });
    expect(await w.admin.query(w.api.users.pendingCount, {})).toBe(1);
    expect(await w.pm.query(w.api.users.pendingCount, {})).toBe(0); // only those who decide see the count
    const r = await w.admin.query(w.api.users.requests, {});
    expect(r.pending.map((x) => x.email)).toEqual(["newbie@x.et"]);
    expect((await w.admin.query(w.api.users.list, {})).some((x) => x.email === "newbie@x.et")).toBe(false); // not in the staff list yet
    await expect(w.pm.query(w.api.users.requests, {})).rejects.toThrow(/forbidden/);
  });

  it("approving gives exactly the roles and buildings chosen; only a super admin can make an administrator", async () => {
    const w = await setup();
    const u = await signUp(w, "newbie@x.et", undefined);
    await expect(w.admin.mutation(w.api.users.approveRequest, { userId: u._id, roles: [], buildingScope: "all" })).rejects.toThrow(/roles_required/);
    await expect(w.admin.mutation(w.api.users.approveRequest, { userId: u._id, roles: ["propertyManager"], buildingScope: [] })).rejects.toThrow(/scope_required/);
    await expect(w.admin.mutation(w.api.users.approveRequest, { userId: u._id, roles: ["superAdmin"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await expect(w.pm.mutation(w.api.users.approveRequest, { userId: u._id, roles: ["propertyManager"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await w.admin.mutation(w.api.users.approveRequest, { userId: u._id, roles: ["financeOfficer"], buildingScope: [w.buildingId] });
    const after = await w.t.run((c) => c.db.get(u._id));
    expect(after).toMatchObject({ active: true, roles: ["financeOfficer"], buildingScope: [w.buildingId] }); expect(after!.accessStatus).toBeUndefined();
    expect(await w.as(u._id).query(w.api.users.myAccess, {})).toEqual({ status: "active" });
    expect((await w.admin.query(w.api.users.list, {})).some((x) => x.email === "newbie@x.et")).toBe(true);
    await expect(w.admin.mutation(w.api.users.approveRequest, { userId: u._id, roles: ["auditor"], buildingScope: "all" })).rejects.toThrow(/not_a_request/); // already decided
    const v = await signUp(w, "vip@x.et", undefined);
    await w.boss.mutation(w.api.users.approveRequest, { userId: v._id, roles: ["superAdmin"], buildingScope: "all" });
    expect((await w.t.run((c) => c.db.get(v._id)))!.roles).toEqual(["superAdmin"]);
  });

  it("declining needs a reason the person can read, can be reopened, and a request can be removed", async () => {
    const w = await setup();
    const u = await signUp(w, "no@x.et", undefined);
    await expect(w.admin.mutation(w.api.users.rejectRequest, { userId: u._id, reason: "  " })).rejects.toThrow(/reason_required/);
    await w.admin.mutation(w.api.users.rejectRequest, { userId: u._id, reason: "Not an employee" });
    expect(await w.as(u._id).query(w.api.users.myAccess, {})).toEqual({ status: "rejected", reason: "Not an employee" });
    expect((await w.admin.query(w.api.users.requests, {})).declined.map((x) => x.reason)).toEqual(["Not an employee"]);
    expect(await w.admin.query(w.api.users.pendingCount, {})).toBe(0);
    await w.admin.mutation(w.api.users.reopenRequest, { userId: u._id });
    expect(await w.admin.query(w.api.users.pendingCount, {})).toBe(1);
    await w.admin.mutation(w.api.users.deleteRequest, { userId: u._id });
    expect(await w.t.run((c) => c.db.get(u._id))).toBeNull();
    const log = (await w.t.run((c) => c.db.query("auditLog").collect())).map((a) => a.action);
    expect(log).toEqual(expect.arrayContaining(["access.reject", "access.reopen", "access.delete"]));
  });

  it("stops accepting requests when too many are waiting, and a wrong invitation code is still an error", async () => {
    const w = await setup();
    await w.t.run(async (ctx) => { for (let i = 0; i < 100; i++) await ctx.db.insert("users", { email: `p${i}@x.et`, active: false, accessStatus: "pending" }); });
    await expect(signUp(w, "late@x.et", undefined)).rejects.toThrow(/too_many_requests/);
    await expect(signUp(w, "other@x.et", "WRONG-CODE1")).rejects.toThrow(/invite_invalid/);
  });
});
