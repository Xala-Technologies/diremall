import { describe, expect, it } from "vitest";
import { applySignup } from "../convex/lib/signup";
import { newTest, world } from "./helpers";

async function setup() {
  const w = await world();
  const adminId = await w.mk("admin", ["accessAdmin"]);
  const superId = await w.mk("boss", ["superAdmin"]);
  return { ...w, admin: w.as(adminId), boss: w.as(superId), adminId, superId };
}
type W = Awaited<ReturnType<typeof setup>>;
/** What the sign-up flow does: create the account carrying what was typed, then run the checks. */
const signUp = async (w: { t: W["t"] }, email: string, typed: { invite?: string; company?: string; note?: string } = {}) =>
  w.t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email, name: "New", ...(typed.invite ? { inviteCode: typed.invite } : {}), ...(typed.company ? { companyCode: typed.company } : {}), ...(typed.note ? { accessNote: typed.note } : {}) });
    await applySignup(ctx as never, id, "platform@x.et");
    return (await ctx.db.get(id))!;
  });
const membership = (w: { t: W["t"] }, orgId: unknown, userId: unknown) => w.t.run((c) => c.db.query("memberships").withIndex("by_org_user", (q) => q.eq("orgId", orgId as never).eq("userId", userId as never)).unique());

describe("invitations", () => {
  it("a valid code puts the person in the company with the invited roles, once", async () => {
    const w = await setup();
    const { code } = await w.admin.mutation(w.api.invites.create, { email: "New.Person@x.et", roles: ["financeOfficer"], buildingScope: "all" });
    const u = await signUp(w, "new.person@x.et", { invite: code.toLowerCase().replace("-", " ") });
    expect(u.active).toBe(true); expect(u.inviteCode).toBeUndefined(); expect(u.activeOrgId).toBe(w.orgId);
    expect((await membership(w, w.orgId, u._id))!.roles).toEqual(["financeOfficer"]);
    await expect(signUp(w, "new.person@x.et", { invite: code })).rejects.toThrow(/invite_invalid/); // used up
  });

  it("refuses a wrong code, someone else's email, and an expired invitation", async () => {
    const w = await setup();
    const { code } = await w.admin.mutation(w.api.invites.create, { email: "a@x.et", roles: ["propertyManager"], buildingScope: "all" });
    await expect(signUp(w, "a@x.et", { invite: "AAAAA-AAAAA" })).rejects.toThrow(/invite_invalid/);
    await expect(signUp(w, "attacker@x.et", { invite: code })).rejects.toThrow(/invite_invalid/); // a stolen code only works for its own email
    await w.t.run(async (ctx) => { const i = (await ctx.db.query("invites").collect())[0]!; await ctx.db.patch(i._id, { expiresAt: Date.now() - 1 }); });
    await expect(signUp(w, "a@x.et", { invite: code })).rejects.toThrow(/invite_invalid/);
  });

  it("a new invitation replaces the old one, and a cancelled one stops working", async () => {
    const w = await setup();
    const first = await w.admin.mutation(w.api.invites.create, { email: "b@x.et", roles: ["auditor"], buildingScope: "all" });
    const second = await w.admin.mutation(w.api.invites.create, { email: "b@x.et", roles: ["auditor"], buildingScope: "all" });
    await expect(signUp(w, "b@x.et", { invite: first.code })).rejects.toThrow(/invite_invalid/);
    const [row] = await w.admin.query(w.api.invites.list, {});
    await w.admin.mutation(w.api.invites.revoke, { id: row!._id });
    await expect(signUp(w, "b@x.et", { invite: second.code })).rejects.toThrow(/invite_invalid/);
  });

  it("only access admins invite, only an administrator can invite an administrator, and people already in the company are refused", async () => {
    const w = await setup();
    await expect(w.pm.mutation(w.api.invites.create, { email: "c@x.et", roles: ["auditor"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await expect(w.admin.mutation(w.api.invites.create, { email: "c@x.et", roles: ["superAdmin"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await w.boss.mutation(w.api.invites.create, { email: "c@x.et", roles: ["superAdmin"], buildingScope: "all" });
    const pmEmail = (await w.t.run((c) => c.db.get(w.pmId)))!.email!;
    await expect(w.admin.mutation(w.api.invites.create, { email: pmEmail, roles: ["auditor"], buildingScope: "all" })).rejects.toThrow(/already_a_member/);
    await expect(w.admin.mutation(w.api.invites.create, { email: "d@x.et", roles: [], buildingScope: "all" })).rejects.toThrow(/roles_required/);
    await expect(w.admin.mutation(w.api.invites.create, { email: "d@x.et", roles: ["auditor"], buildingScope: [] })).rejects.toThrow(/scope_required/);
  });

  it("an invitation cannot name another company's building", async () => {
    const w = await setup(); const other = await world({ t: w.t, slug: "other-co", name: "Other Co" });
    await expect(w.admin.mutation(w.api.invites.create, { email: "e@x.et", roles: ["auditor"], buildingScope: [other.buildingId] })).rejects.toThrow(/not_found/);
  });

  it("a person who already has an account joins a second company with an invitation, and keeps both", async () => {
    const a = await setup(); const b = await world({ t: a.t, slug: "second-co", name: "Second Co" });
    const adminB = b.as(await b.mk("adminB", ["accessAdmin", "superAdmin"]));
    const pmEmail = (await a.t.run((c) => c.db.get(a.pmId)))!.email!;
    const { code } = await adminB.mutation(b.api.invites.create, { email: pmEmail, roles: ["auditor"], buildingScope: "all" });
    await expect(a.pm.mutation(a.api.invites.accept, { code: "WRONG-CODE0" })).rejects.toThrow(/invite_invalid/);
    await a.pm.mutation(a.api.invites.accept, { code });
    const me = (await a.pm.query(a.api.users.me, {}))!;
    expect(me.companies.map((c) => c.name).sort()).toEqual(["Dire Mall", "Second Co"]);
    await a.pm.mutation(a.api.users.switchCompany, { orgId: b.orgId });
    expect((await a.pm.query(a.api.users.me, {}))!.org!.name).toBe("Second Co");
    await expect(a.pm.query(a.api.properties.listBuildings, {})).resolves.toHaveLength(1); // only Second Co's building now
    await expect(a.pm.mutation(a.api.users.switchCompany, { orgId: (await world({ t: a.t, slug: "third", name: "Third" })).orgId })).rejects.toThrow(/forbidden/);
  });
});

describe("the platform admin", () => {
  it("the first account becomes the platform admin; with a named address, only that one", async () => {
    const t = newTest();
    const first = await t.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "first@x.et" }); await applySignup(ctx as never, id); return (await ctx.db.get(id))!; });
    expect(first.platformRole).toBe("platformAdmin"); expect(first.activeOrgId).toBeUndefined();
    const second = await t.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "second@x.et" }); await applySignup(ctx as never, id); return (await ctx.db.get(id))!; });
    expect(second.platformRole).toBeUndefined(); expect(second.active).toBe(true); // an account with no company
    const t2 = newTest();
    await t2.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "other@x.et" }); await applySignup(ctx as never, id, "boss@x.et"); });
    const boss = await t2.run(async (ctx) => { const id = await ctx.db.insert("users", { email: "Boss@x.et" }); await applySignup(ctx as never, id, "boss@x.et"); return (await ctx.db.get(id))!; });
    expect(boss.platformRole).toBe("platformAdmin");
  });
});

describe("joining with a company code, and requests for access", () => {
  it("someone with the company code asks to join, waits with no access, and the access manager decides", async () => {
    const w = await setup();
    const { code } = await w.admin.mutation(w.api.users.rotateJoinCode, {});
    const u = await signUp(w, "newbie@x.et", { company: code.toLowerCase(), note: "new accountant" });
    expect(u.companyCode).toBeUndefined(); expect(u.activeOrgId).toBeUndefined();
    const me = w.as(u._id);
    expect((await me.query(w.api.users.me, {}))).toMatchObject({ ready: false, problem: "no_company" });
    await expect(me.query(w.api.properties.listBuildings, {})).rejects.toThrow(/no_company/);
    expect(await me.query(w.api.users.myAccess, {})).toMatchObject({ status: "pending", company: "Dire Mall" });
    expect(await w.admin.query(w.api.users.pendingCount, {})).toBe(1);
    expect(await w.pm.query(w.api.users.pendingCount, {})).toBe(0);
    const r = await w.admin.query(w.api.users.requests, {});
    expect(r.pending.map((x) => [x.email, x.note])).toEqual([["newbie@x.et", "new accountant"]]);
    expect((await w.admin.query(w.api.users.list, {})).some((x) => x.email === "newbie@x.et")).toBe(false);
    await expect(w.pm.query(w.api.users.requests, {})).rejects.toThrow(/forbidden/);
    const id = r.pending[0]!._id;
    await expect(w.admin.mutation(w.api.users.approveRequest, { requestId: id, roles: [], buildingScope: "all" })).rejects.toThrow(/roles_required/);
    await expect(w.admin.mutation(w.api.users.approveRequest, { requestId: id, roles: ["propertyManager"], buildingScope: [] })).rejects.toThrow(/scope_required/);
    await expect(w.admin.mutation(w.api.users.approveRequest, { requestId: id, roles: ["superAdmin"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await expect(w.pm.mutation(w.api.users.approveRequest, { requestId: id, roles: ["propertyManager"], buildingScope: "all" })).rejects.toThrow(/forbidden/);
    await w.admin.mutation(w.api.users.approveRequest, { requestId: id, roles: ["financeOfficer"], buildingScope: [w.buildingId] });
    expect(await me.query(w.api.users.myAccess, {})).toEqual({ status: "active" });
    expect((await membership(w, w.orgId, u._id))).toMatchObject({ roles: ["financeOfficer"], buildingScope: [w.buildingId], status: "active" });
    await expect(me.query(w.api.properties.listBuildings, {})).resolves.toHaveLength(1);
    expect((await w.admin.query(w.api.users.list, {})).some((x) => x.email === "newbie@x.et")).toBe(true);
  });

  it("a wrong or switched-off company code is refused, and a code only reaches its own company", async () => {
    const w = await setup(); const other = await world({ t: w.t, slug: "other-co", name: "Other Co" });
    const otherAdmin = other.as(await other.mk("oadmin", ["accessAdmin"]));
    await expect(signUp(w, "x@x.et", { company: "NOSUCHCODE" })).rejects.toThrow(/company_code_invalid/);
    const { code } = await otherAdmin.mutation(other.api.users.rotateJoinCode, {});
    const u = await signUp(w, "y@x.et", { company: code });
    expect((await w.admin.query(w.api.users.requests, {})).pending).toHaveLength(0); // Dire Mall sees nothing
    expect((await otherAdmin.query(other.api.users.requests, {})).pending.map((x) => x.email)).toEqual(["y@x.et"]);
    await otherAdmin.mutation(other.api.users.disableJoinCode, {});
    await expect(signUp(w, "z@x.et", { company: code })).rejects.toThrow(/company_code_invalid/);
    void u;
  });

  it("declining needs a reason the person can read, can be reopened, and a request can be removed", async () => {
    const w = await setup(); const { code } = await w.admin.mutation(w.api.users.rotateJoinCode, {});
    const u = await signUp(w, "no@x.et", { company: code });
    const id = (await w.admin.query(w.api.users.requests, {})).pending[0]!._id;
    await expect(w.admin.mutation(w.api.users.rejectRequest, { requestId: id, reason: "  " })).rejects.toThrow(/reason_required/);
    await w.admin.mutation(w.api.users.rejectRequest, { requestId: id, reason: "Not an employee" });
    expect(await w.as(u._id).query(w.api.users.myAccess, {})).toMatchObject({ status: "rejected", reason: "Not an employee" });
    expect(await w.admin.query(w.api.users.pendingCount, {})).toBe(0);
    await w.admin.mutation(w.api.users.reopenRequest, { requestId: id });
    expect(await w.admin.query(w.api.users.pendingCount, {})).toBe(1);
    await w.admin.mutation(w.api.users.deleteRequest, { requestId: id });
    expect((await w.admin.query(w.api.users.requests, {})).pending).toHaveLength(0);
  });

  it("an existing account can ask to join from inside the app, and stops at the request limit", async () => {
    const w = await setup(); const { code } = await w.admin.mutation(w.api.users.rotateJoinCode, {});
    const loner = await w.t.run((c) => c.db.insert("users", { email: "loner@x.et", active: true }));
    await w.as(loner).mutation(w.api.users.requestToJoin, { code, note: "hello" });
    await w.as(loner).mutation(w.api.users.requestToJoin, { code }); // asking twice is harmless
    expect((await w.admin.query(w.api.users.requests, {})).pending).toHaveLength(1);
    await w.t.run(async (ctx) => { for (let i = 0; i < 100; i++) { const id = await ctx.db.insert("users", { email: `p${i}@x.et`, active: true }); await ctx.db.insert("accessRequests", { orgId: w.orgId, userId: id, status: "pending", requestedAt: Date.now() }); } });
    const late = await w.t.run((c) => c.db.insert("users", { email: "late@x.et", active: true }));
    await expect(w.as(late).mutation(w.api.users.requestToJoin, { code })).rejects.toThrow(/too_many_requests/);
  });
});

describe("staff in a company", () => {
  it("an access manager changes only people in their own company", async () => {
    const w = await setup(); const other = await world({ t: w.t, slug: "other-co", name: "Other Co" });
    const theirs = await other.member(other.pmId);
    await expect(w.admin.mutation(w.api.users.setAccess, { membershipId: theirs, roles: ["auditor"], buildingScope: "all", active: true })).rejects.toThrow(/not_found/);
    await expect(w.admin.mutation(w.api.users.setAccess, { membershipId: await w.member(w.pmId), roles: ["propertyManager"], buildingScope: [other.buildingId], active: true })).rejects.toThrow(/not_found/);
    expect((await w.admin.query(w.api.users.list, {})).every((x) => !x.email.includes("other-co"))).toBe(true);
  });

  it("switching a person off ends their access to that company at once; the last administrator cannot be removed", async () => {
    const w = await setup();
    await w.admin.mutation(w.api.users.setAccess, { membershipId: await w.member(w.pmId), roles: ["propertyManager"], buildingScope: "all", active: false });
    await expect(w.pm.query(w.api.properties.listBuildings, {})).rejects.toThrow(/no_company/);
    await expect(w.boss.mutation(w.api.users.setAccess, { membershipId: await w.member(w.superId), roles: ["propertyManager"], buildingScope: "all", active: true })).rejects.toThrow(/last_super_admin/);
  });
});
