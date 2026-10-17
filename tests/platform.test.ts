import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { applySignup } from "../convex/lib/signup";
import { etb, newTest, utc, world } from "./helpers";

async function platform(t: ReturnType<typeof newTest>) {
  const id = await t.run((c) => c.db.insert("users", { name: "Root", email: "root@platform.et", active: true, platformRole: "platformAdmin" }));
  return { id, as: t.withIdentity({ subject: `${id}|session` }) };
}
const signUp = (t: ReturnType<typeof newTest>, email: string, invite?: string) =>
  t.run(async (ctx) => { const id = await ctx.db.insert("users", { email, name: email, ...(invite ? { inviteCode: invite } : {}) }); await applySignup(ctx as never, id, "root@platform.et"); return id; });

describe("the platform console", () => {
  it("creates a company with an invitation for its first administrator, who then works only inside it", async () => {
    const t = newTest(); const root = await platform(t);
    const made = await root.as.mutation((await import("../convex/_generated/api")).api.platform.createCompany, { name: "Acme Malls", slug: "acme", adminEmail: "owner@acme.et", plan: "trial", country: "et" });
    expect(made.code).toMatch(/[A-Z0-9]/);
    const org = (await t.run((c) => c.db.get(made.orgId)))!;
    expect(org).toMatchObject({ status: "trial", plan: "trial", currency: "ETB", limits: { units: 50, seats: 5, smsPerMonth: 200 } }); expect(org.trialEndsAt).toBeGreaterThan(Date.now());
    const ownerId = await signUp(t, "owner@acme.et", made.code);
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    const { api } = await import("../convex/_generated/api");
    expect((await owner.query(api.users.me, {}))).toMatchObject({ ready: true, platformAdmin: false, roles: ["superAdmin"], org: { name: "Acme Malls", slug: "acme" } });
    await expect(owner.query(api.platform.companies, {})).rejects.toThrow(/forbidden/); // a company administrator is not on the platform team
    const b = await owner.mutation(api.properties.createBuilding, { name: "Acme Plaza" }); expect(b).toBeTruthy();
  });

  it("only the platform team may use it, and creating a company validates its details", async () => {
    const t = newTest(); const root = await platform(t); const w = await world({ t });
    const { api } = await import("../convex/_generated/api");
    await expect(w.pm.query(api.platform.overview, {})).rejects.toThrow(/forbidden/);
    await expect(w.t.query(api.platform.overview, {})).rejects.toThrow(/unauthenticated/);
    const base = { name: "X", slug: "x-co", adminEmail: "a@x.et", plan: "starter" };
    await expect(root.as.mutation(api.platform.createCompany, { ...base, slug: "Bad Slug!" })).rejects.toThrow(/invalid_slug/);
    await expect(root.as.mutation(api.platform.createCompany, { ...base, slug: "dire-mall" })).rejects.toThrow(/slug_taken/);
    await expect(root.as.mutation(api.platform.createCompany, { ...base, plan: "gold" })).rejects.toThrow(/unknown_plan/);
    await expect(root.as.mutation(api.platform.createCompany, { ...base, adminEmail: "nope" })).rejects.toThrow(/invalid_email/);
    await expect(root.as.mutation(api.platform.createCompany, { ...base, currency: "BIRR" })).rejects.toThrow(/invalid_currency/);
    await root.as.mutation(api.platform.createCompany, base);
    const list = await root.as.query(api.platform.companies, {});
    expect(list.map((c) => c.slug).sort()).toEqual(["dire-mall", "x-co"]);
    expect(await root.as.query(api.platform.overview, {})).toMatchObject({ companies: 2, active: 2 });
  });

  it("a platform admin sees counts and health, never a company's records, until a support session is opened", async () => {
    const t = newTest(); const root = await platform(t); const w = await world({ t }); const { api } = await import("../convex/_generated/api");
    const u = await w.unit("A-1", 50); await w.activeAgreement(u, await w.renter("Abebe"));
    const row = (await root.as.query(api.platform.companies, {}))[0]!;
    expect(row).toMatchObject({ units: 1, seats: 3 }); expect(JSON.stringify(row)).not.toContain("Abebe");
    const h = await root.as.query(api.platform.health, { orgId: w.orgId }); expect(h.problems).toEqual([]); expect(h.checked.units).toBe(1);
    await expect(root.as.query(api.properties.listBuildings, {})).rejects.toThrow(/no_company/);
  });

  it("support sessions: a reason, read only, limited time, visible to the company, ended on demand", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t = newTest(); const root = await platform(t); const w = await world({ t }); const { api } = await import("../convex/_generated/api");
      const boss = w.as(await w.mk("boss", ["superAdmin"]));
      await expect(root.as.mutation(api.platform.startSupport, { orgId: w.orgId, reason: "too short", minutes: 30 })).rejects.toThrow(/support_reason_required/);
      await expect(root.as.mutation(api.platform.startSupport, { orgId: w.orgId, reason: "Customer reported a wrong total on a bill", minutes: 500 })).rejects.toThrow(/invalid_minutes/);
      await root.as.mutation(api.platform.startSupport, { orgId: w.orgId, reason: "Customer reported a wrong total on a bill", minutes: 30 });
      expect((await root.as.query(api.properties.listBuildings, {})).map((b) => b.name)).toEqual(["Dire Mall"]); // reading works
      await expect(root.as.mutation(api.properties.createBuilding, { name: "Planted" })).rejects.toThrow(/forbidden/); // writing does not
      expect(await boss.query(api.settings.supportOpen, {})).toMatchObject({ until: expect.any(Number) });
      const seen = await boss.query(api.settings.supportAccess, {}); expect(seen[0]).toMatchObject({ reason: "Customer reported a wrong total on a bill", open: true });
      expect((await root.as.query(api.platform.mySupport, {}))!.company).toBe("Dire Mall");
      vi.setSystemTime(Date.now() + 31 * 60_000); // expires on its own
      await expect(root.as.query(api.properties.listBuildings, {})).rejects.toThrow(/no_company/);
      expect(await boss.query(api.settings.supportOpen, {})).toBeNull();
      await root.as.mutation(api.platform.startSupport, { orgId: w.orgId, reason: "Second look at the same bill", minutes: 10 });
      await root.as.mutation(api.platform.endSupport, {});
      await expect(root.as.query(api.properties.listBuildings, {})).rejects.toThrow(/no_company/);
      expect((await root.as.query(api.platform.company, { orgId: w.orgId })).log.map((l) => l.action)).toEqual(expect.arrayContaining(["support.start", "support.end"]));
    } finally { vi.useRealTimers(); }
  });
});

describe("company standing and plan limits", () => {
  it("a suspended company can be read but not changed; reactivating restores it; a reason is required", async () => {
    const t = newTest(); const root = await platform(t); const w = await world({ t }); const { api } = await import("../convex/_generated/api");
    await expect(root.as.mutation(api.platform.setStatus, { orgId: w.orgId, status: "suspended" })).rejects.toThrow(/reason_required/);
    await root.as.mutation(api.platform.setStatus, { orgId: w.orgId, status: "suspended", reason: "Unpaid invoice" });
    await expect(w.pm.mutation(api.properties.createBuilding, { name: "Nope" })).rejects.toThrow(/org_suspended/);
    expect(await w.pm.query(api.properties.listBuildings, {})).toHaveLength(1);
    expect((await w.pm.query(api.users.me, {}))!.org!.frozen).toBe("org_suspended");
    await root.as.mutation(api.platform.setStatus, { orgId: w.orgId, status: "active" });
    await w.pm.mutation(api.properties.createBuilding, { name: "Fine now" });
  });

  it("an ended trial freezes the company; a past-due one too", async () => {
    const t = newTest(); const w = await world({ t, status: "trial" }); const { api } = await import("../convex/_generated/api");
    await t.run((c) => c.db.patch(w.orgId, { trialEndsAt: Date.now() + 86_400_000 }));
    await w.pm.mutation(api.properties.createBuilding, { name: "In trial" });
    await t.run((c) => c.db.patch(w.orgId, { trialEndsAt: Date.now() - 1000 }));
    await expect(w.pm.mutation(api.properties.createBuilding, { name: "After trial" })).rejects.toThrow(/org_trial_ended/);
    await t.run((c) => c.db.patch(w.orgId, { status: "past_due", trialEndsAt: undefined }));
    await expect(w.pm.mutation(api.properties.createBuilding, { name: "Past due" })).rejects.toThrow(/org_suspended/);
  });

  it("units, staff seats and SMS are limited by the plan, and only the platform can raise the limits", async () => {
    const t = newTest(); const root = await platform(t); const w = await world({ t, limits: { units: 2, seats: 5, smsPerMonth: 2 } }); const { api } = await import("../convex/_generated/api");
    await w.unit("U1", 10); await w.unit("U2", 10);
    await expect(w.unit("U3", 10)).rejects.toThrow(/plan_unit_limit/);
    const import3 = await w.pm.mutation(api.imports.commitUnits, { rows: [{ row: 2, building: "Dire Mall", floor: "Ground", unit: "I-1", area: "10", category: "retail", rate: "1" }] }).catch((e) => String(e));
    expect(String(import3)).toMatch(/plan_unit_limit/);
    const admin = w.as(await w.mk("admin", ["accessAdmin"])); // seats used: pm, fin, ap, admin = 4
    await admin.mutation(api.invites.create, { email: "s1@x.et", roles: ["auditor"], buildingScope: "all" }); // 5
    await expect(admin.mutation(api.invites.create, { email: "s2@x.et", roles: ["auditor"], buildingScope: "all" })).rejects.toThrow(/plan_seat_limit/);
    await expect(w.ap.mutation(api.platform.updatePlan, { orgId: w.orgId, plan: "standard", units: 500, seats: 20, smsPerMonth: 3000 })).rejects.toThrow(/forbidden/);
    await root.as.mutation(api.platform.updatePlan, { orgId: w.orgId, plan: "standard", units: 500, seats: 20, smsPerMonth: 3000 });
    await w.unit("U3", 10); await admin.mutation(api.invites.create, { email: "s2@x.et", roles: ["auditor"], buildingScope: "all" });
    await expect(root.as.mutation(api.platform.updatePlan, { orgId: w.orgId, plan: "x", units: -1, seats: 1, smsPerMonth: 1 })).rejects.toThrow(/invalid_limit/);
    // SMS: two messages allowed this month
    const r = await w.renter("Abebe"); await w.activeAgreement(await w.unit("U4", 10), r);
    await t.run((c) => c.db.patch(w.orgId, { limits: { units: 0, seats: 0, smsPerMonth: 1 } }));
    await w.fin.mutation(api.smsQueue.sendBroadcast, { audience: { kind: "activeLeases" }, body: "Hello {renter}" });
    await expect(w.fin.mutation(api.smsQueue.sendBroadcast, { audience: { kind: "activeLeases" }, body: "Again {renter}" })).rejects.toThrow(/sms_limit_reached/);
  });
});

describe("each company is its own world", () => {
  it("bill and receipt numbers, settings, templates and tariffs are separate per company", async () => {
    const t = newTest(); const A = await world({ t, slug: "alpha-co", name: "Alpha" }); const B = await world({ t, slug: "beta-co", name: "Beta" }); const { api } = await import("../convex/_generated/api");
    for (const w of [A, B]) {
      const u = await w.unit("U1", 100); const r = await w.renter("R"); await w.activeAgreement(u, r, { kind: "fixed", amount: etb(1000) });
      await w.fin.mutation(api.billing.generate, { period: "2026-10" });
      await w.fin.mutation(api.billing.issue, { invoiceIds: (await w.fin.query(api.billing.list, { period: "2026-10" })).map((i) => i._id) });
      const pay = await w.fin.mutation(api.payments.record, { renterId: r, amount: etb(500), method: "cash", reference: "SAME-REF", receivedAt: utc(2026, 10, 5) }); // the same reference is fine in two companies
      await w.ap.mutation(api.payments.confirm, { paymentId: pay }); await w.fin.mutation(api.payments.apply, { paymentId: pay });
    }
    for (const w of [A, B]) {
      expect((await w.fin.query(api.billing.list, { period: "2026-10" }))[0]!.number).toBe("INV-2026-10-0001");
      expect((await w.fin.query(api.payments.list, {}))[0]!.receiptNumber).toBe("RCT-2026-0001");
    }
    await A.ap.mutation(api.settings.set, { key: "tariff.water", value: 777 });
    expect((await B.ap.query(api.settings.get, {}))["tariff.water"]).toBeUndefined();
    await A.ap.mutation(api.smsQueue.saveTemplate, { kind: "overdue", lang: "en", body: "Alpha says {renter} {bill} {amount}", enabled: true });
    expect((await B.fin.query(api.smsQueue.templates, {})).templates.find((x) => x.kind === "overdue")!.langs.en!.edited).toBe(false);
    // two renters with the same TIN in different companies are fine
    await A.pm.mutation(api.renters.create, { kind: "company", name: "Same Ltd", tin: "0099999999", phone: "+251911000001" });
    await B.pm.mutation(api.renters.create, { kind: "company", name: "Same Ltd", tin: "0099999999", phone: "+251911000001" });
    await expect(B.pm.mutation(api.renters.create, { kind: "company", name: "Dup", tin: "0099999999", phone: "+251911000002" })).rejects.toThrow(/tin_already_registered/);
  });

  it("a company sets its own currency and timezone, and quiet hours follow its timezone", async () => {
    const t = newTest(); const w = await world({ t }); const { api } = await import("../convex/_generated/api");
    await w.ap.mutation(api.settings.setCompany, { currency: "USD", tzOffsetHours: -5, defaultLang: "en", defaultCalendar: "gregorian" });
    expect(await w.fin.query(api.settings.company, {})).toMatchObject({ currency: "USD", tzOffsetHours: -5 });
    await expect(w.ap.mutation(api.settings.setCompany, { currency: "dollars", tzOffsetHours: 0, defaultLang: "en", defaultCalendar: "gregorian" })).rejects.toThrow(/invalid_currency/);
    await expect(w.pm.mutation(api.settings.setCompany, { currency: "USD", tzOffsetHours: 0, defaultLang: "en", defaultCalendar: "gregorian" })).rejects.toThrow(/forbidden/);
    const { inQuietHours, localHour } = await import("../convex/lib/sms");
    const noonUtc = Date.UTC(2026, 9, 16, 12);
    expect(localHour(noonUtc, 3)).toBe(15); expect(localHour(noonUtc, -5)).toBe(7);
    expect(inQuietHours(Date.UTC(2026, 9, 16, 18), 20, 8, 3)).toBe(true); // 21:00 in Ethiopia
    expect(inQuietHours(Date.UTC(2026, 9, 16, 18), 20, 8, -5)).toBe(false); // 13:00 in New York
  });
});

describe("the company's own SMS gateway", () => {
  const KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  beforeEach(() => { process.env.SECRETS_ENC_KEY = KEY; });
  afterEach(() => { delete process.env.SECRETS_ENC_KEY; });

  it("stores the key encrypted, never shows it again, and keeps each company's gateway apart", async () => {
    const t = newTest(); const A = await world({ t, slug: "alpha-co", name: "Alpha" }); const B = await world({ t, slug: "beta-co", name: "Beta" }); const { api } = await import("../convex/_generated/api");
    await expect(A.ap.mutation(api.smsQueue.saveGateway, { apiUrl: "http://insecure.example", apiKey: "k", sender: "Alpha" })).rejects.toThrow(/invalid_gateway_url/);
    await expect(A.ap.mutation(api.smsQueue.saveGateway, { apiUrl: "https://sms.example/send", sender: "Alpha" })).rejects.toThrow(/gateway_key_required/);
    await expect(A.fin.mutation(api.smsQueue.saveGateway, { apiUrl: "https://sms.example/send", apiKey: "k", sender: "Alpha" })).rejects.toThrow(/forbidden/);
    const saved = await A.ap.mutation(api.smsQueue.saveGateway, { apiUrl: "https://sms.example/send", apiKey: "super-secret-key", sender: "Alpha" });
    expect(saved.webhookSecret).toMatch(/^whsec_/); expect(saved.webhookPath).toBe("/sms/delivery/alpha-co");
    const row = (await t.run((c) => c.db.query("smsConfig").collect()))[0]!;
    expect(JSON.stringify(row)).not.toContain("super-secret-key"); expect(row.apiKeyEnc).toContain(".");
    const { decryptSecret } = await import("../convex/lib/crypto"); expect(await decryptSecret(row.apiKeyEnc)).toBe("super-secret-key");
    expect(JSON.stringify(await A.fin.query(api.smsQueue.gateway, {}))).not.toContain("super-secret-key");
    expect(await A.fin.query(api.smsQueue.gateway, {})).toMatchObject({ configured: true, source: "own", sender: "Alpha" });
    expect(await B.fin.query(api.smsQueue.gateway, {})).toMatchObject({ configured: false, source: "none" });
    const again = await A.ap.mutation(api.smsQueue.saveGateway, { apiUrl: "https://sms.example/v2", sender: "Alpha2" }); expect(again.webhookSecret).toBeNull(); // key kept, secret not shown twice
    const targets = await t.query(internal.smsQueue.dispatchTargets, {}); expect(targets).toEqual([]); // nothing queued yet
    await A.ap.mutation(api.smsQueue.removeGateway, {}); expect(await A.fin.query(api.smsQueue.gateway, {})).toMatchObject({ source: "none" });
  });

  it("refuses to store a key when the platform has no encryption key", async () => {
    delete process.env.SECRETS_ENC_KEY;
    const w = await world(); const { api } = await import("../convex/_generated/api");
    await expect(w.ap.mutation(api.smsQueue.saveGateway, { apiUrl: "https://sms.example/send", apiKey: "k", sender: "X" })).rejects.toThrow(/platform_not_configured/);
  });

  it("a delivery receipt can only change its own company's messages", async () => {
    const t = newTest(); const A = await world({ t, slug: "alpha-co" }); const B = await world({ t, slug: "beta-co" });
    const msg = await t.run((c) => c.db.insert("smsMessages", { orgId: A.orgId, kind: "custom", body: "x", status: "accepted", to: "+251911000000" }));
    expect(await t.mutation(internal.smsQueue.deliveryReceipt, { id: msg, status: "delivered", orgId: B.orgId })).toBe(false);
    expect(await t.mutation(internal.smsQueue.deliveryReceipt, { id: msg, status: "delivered", orgId: A.orgId })).toBe(true);
  });
});

describe("daily jobs run company by company", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());
  it("queue reminders for every live company and skip suspended ones", async () => {
    const t = newTest(); const A = await world({ t, slug: "alpha-co" }); const B = await world({ t, slug: "beta-co" });
    for (const w of [A, B]) {
      const u = await w.unit("U1", 10); const r = await w.renter("R"); await w.activeAgreement(u, r, { kind: "fixed", amount: etb(1000) });
      await t.run(async (c) => { await c.db.insert("invoices", { orgId: w.orgId, number: `X-${w.orgId}`, agreementId: (await c.db.query("agreements").collect()).find((a) => a.orgId === w.orgId)!._id, unitId: u, renterId: r, buildingId: w.buildingId, period: "2026-09", status: "issued", total: 100, dueAt: Date.now() - 5 * 86_400_000, adjustments: 0, paid: 0, creditUsed: 0, due: 100 }); });
    }
    await t.run((c) => c.db.patch(B.orgId, { status: "suspended" }));
    await t.mutation(internal.smsQueue.remindersForAll, {}); await t.finishAllScheduledFunctions(vi.runAllTimers);
    const msgs = await t.run((c) => c.db.query("smsMessages").collect());
    expect(msgs.filter((m) => m.orgId === A.orgId)).toHaveLength(1); expect(msgs.filter((m) => m.orgId === B.orgId)).toHaveLength(0);
  });
});

describe("taking the data out, and leaving", () => {
  it("an administrator exports the company's records (without secrets), and only their own", async () => {
    vi.useFakeTimers();
    const t = newTest(); const A = await world({ t, slug: "alpha-co", name: "Alpha" }); const B = await world({ t, slug: "beta-co", name: "Beta" }); const { api } = await import("../convex/_generated/api");
    await A.renter("Alpha Renter"); await B.renter("Beta Renter");
    await t.run((c) => c.db.insert("smsConfig", { orgId: A.orgId, apiUrl: "https://x.example", apiKeyEnc: "SECRET.CIPHER", sender: "A", updatedBy: A.pmId }));
    await expect(A.pm.mutation(api.exports.request, {})).rejects.toThrow(/forbidden/);
    await A.ap.mutation(api.exports.request, {});
    await expect(A.ap.mutation(api.exports.request, {})).rejects.toThrow(/export_in_progress/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [job] = await A.ap.query(api.exports.list, {}); expect(job).toMatchObject({ status: "ready" }); expect(job!.rows).toBeGreaterThan(5);
    const stored = (await t.run((c) => c.db.query("dataExports").collect()))[0]!;
    const body = JSON.parse(await t.run(async (c) => (await c.storage.get(stored.storageId!))!.text()));
    expect(JSON.stringify(body)).toContain("Alpha Renter"); expect(JSON.stringify(body)).not.toContain("Beta Renter"); expect(JSON.stringify(body)).not.toContain("SECRET.CIPHER");
    expect((await A.ap.mutation(api.exports.link, { exportId: job!._id })).token).toMatch(/^[a-f0-9]{64}$/);
    await expect(B.ap.mutation(api.exports.link, { exportId: job!._id })).rejects.toThrow(/not_found/);
    vi.useRealTimers();
  });

  it("a cancelled company can still export, can be deleted only by typing its name, and leaves nothing behind", async () => {
    vi.useFakeTimers();
    const t = newTest(); const root = await platform(t); const A = await world({ t, slug: "alpha-co", name: "Alpha" }); const B = await world({ t, slug: "beta-co", name: "Beta" }); const { api } = await import("../convex/_generated/api");
    const u = await A.unit("U1", 10); const r = await A.renter("Abebe"); await A.activeAgreement(u, r); await B.renter("Keep Me");
    await expect(root.as.mutation(api.platform.deleteCompany, { orgId: A.orgId, confirmSlug: "alpha-co" })).rejects.toThrow(/cancel_first/);
    await root.as.mutation(api.platform.setStatus, { orgId: A.orgId, status: "cancelled", reason: "Left the platform" });
    await expect(A.pm.mutation(api.properties.createBuilding, { name: "No" })).rejects.toThrow(/org_cancelled/);
    expect(await A.pm.query(api.properties.listBuildings, {})).toHaveLength(1); // still readable
    await A.ap.mutation(api.exports.request, {}); // and exportable
    await expect(root.as.mutation(api.platform.deleteCompany, { orgId: A.orgId, confirmSlug: "wrong" })).rejects.toThrow(/confirmation_does_not_match/);
    await root.as.mutation(api.platform.deleteCompany, { orgId: A.orgId, confirmSlug: "alpha-co" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((c) => c.db.get(A.orgId))).toBeNull();
    const left = await t.run(async (c) => { let n = 0; for (const tb of ["buildings", "units", "renters", "agreements", "memberships", "auditLog", "settings", "deposits", "invoices", "fileOwners", "dataExports"] as const) n += (await (c.db.query(tb) as any).collect()).filter((d: any) => d.orgId === A.orgId).length; return n; });
    expect(left).toBe(0);
    expect((await B.pm.query(api.renters.list, {})).map((x) => x.name)).toEqual(["Keep Me"]); // the other company is untouched
    vi.useRealTimers();
  });
});
