import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { etb, modules, newTest, storePdf, utc, world, type T } from "./helpers";

/**
 * The isolation test. Two companies, each with realistic records in every table. One person from company A, holding every role,
 * calls EVERY public query and mutation the server has, with company B's ids in every id argument, and the other way round.
 * The list of functions is read from the code, so a new function is tested the day it is written. Afterwards:
 *  - nothing that came back may contain a record, name or email of the other company;
 *  - the other company's records must be exactly as they were;
 *  - no record of the calling company may point at a record of the other company.
 */
const TENANT_TABLES = ["buildings", "floors", "units", "renters", "renterDocuments", "agreements", "agreementTerms", "invoices", "invoiceLines", "invoiceAdjustments", "payments", "paymentAllocations", "renterCredits", "deposits", "meters", "meterReadings", "sharedCosts", "sharedCostAllocations", "handovers", "invites", "organization", "settings", "bankStatementEntries", "smsMessages", "smsTemplates", "auditLog", "memberships", "accessRequests", "smsConfig", "dataExports", "fileOwners"] as const;

async function fill(w: Awaited<ReturnType<typeof world>>, tag: string) {
  const api = w.api;
  const unitId = await w.unit(`${tag}-1`, 100); const unit2 = await w.unit(`${tag}-2`, 50);
  const renterId = await w.renter(`Renter ${tag}`); const renter2 = await w.renter(`Spare ${tag}`);
  const agreementId = await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(20000) });
  const draft = await w.pm.mutation(api.agreements.createDraft, { unitId: unit2, renterId: renter2, startsAt: utc(2027, 1), endsAt: utc(2028, 1), rent: { kind: "fixed", amount: etb(5000) }, dueDay: 5, depositAmount: 0 });
  await w.pm.mutation(api.agreements.recordHandover, { agreementId, kind: "moveIn", keys: 1, condition: "good" });
  await w.fin.mutation(api.deposits.receive, { agreementId, amount: etb(1000), method: "cash", reference: `${tag}-DEP` });
  const meterId = await w.pm.mutation(api.utilities.addMeter, { unitId, kind: "electricity", serial: `M-${tag}` });
  const rd = await w.pm.mutation(api.utilities.enterReading, { meterId, value: 10, readAt: utc(2026, 9, 30) });
  await w.fin.mutation(api.utilities.approveReading, { readingId: rd.id });
  const cost = await w.fin.mutation(api.utilities.createSharedCost, { buildingId: w.buildingId, kind: "cleaning", period: "2026-09", total: etb(900) });
  await w.ap.mutation(api.utilities.approveSharedCost, { sharedCostId: cost.id });
  await w.fin.mutation(api.billing.generate, { period: "2026-09" });
  const invs = await w.fin.query(api.billing.list, { period: "2026-09" });
  await w.fin.mutation(api.billing.issue, { invoiceIds: invs.map((i) => i._id) });
  const adj = await w.fin.mutation(api.billing.requestAdjustment, { invoiceId: invs[0]!._id, delta: etb(10), reason: "x" });
  const pay = await w.fin.mutation(api.payments.record, { renterId, amount: etb(25000), method: "transfer", reference: `${tag}-PAY`, receivedAt: utc(2026, 9, 20), evidenceFileId: await w.t.run((c) => storePdf(c as never)) });
  await w.ap.mutation(api.payments.confirm, { paymentId: pay }); await w.fin.mutation(api.payments.apply, { paymentId: pay }); // overpays: leaves credit
  await w.fin.mutation(api.payments.record, { renterId: renter2, amount: etb(7), method: "cash", reference: `${tag}-PAY2`, receivedAt: utc(2026, 9, 21) });
  await w.pm.mutation(api.renters.addDocument, { renterId, kind: "Business licence", fileId: await w.t.run((c) => storePdf(c as never)) });
  await w.fin.mutation(api.bank.importStatement, { batch: `${tag}-S1`, entries: [{ postedAt: utc(2026, 9, 20), amount: etb(25000), reference: `${tag}-BANK`, description: `${tag} statement` }] });
  await w.fin.mutation(api.smsQueue.saveTemplate, { kind: "overdue", lang: "en", body: `${tag}: {renter}, bill {bill} is overdue. {org}`, enabled: true });
  await w.fin.mutation(api.smsQueue.sendBroadcast, { audience: { kind: "activeLeases" }, body: `Notice from ${tag}` });
  const admin = w.as(await w.mk(`admin${tag}`, ["accessAdmin", "superAdmin"]));
  await admin.mutation(api.invites.create, { email: `invitee@${tag}.et`, roles: ["auditor"], buildingScope: "all" });
  const { code } = await admin.mutation(api.users.rotateJoinCode, {});
  const askerId = await w.t.run((c) => c.db.insert("users", { email: `asker@${tag}.et`, name: `Asker ${tag}`, active: true }));
  await w.as(askerId).mutation(api.users.requestToJoin, { code, note: "hello" });
  await w.t.run(async (c) => {
    await c.db.insert("dataExports", { orgId: w.orgId, requestedBy: w.pmId, status: "ready" });
    await c.db.insert("smsConfig", { orgId: w.orgId, apiUrl: "https://sms.example/send", apiKeyEnc: "x.y", sender: tag, updatedBy: w.pmId });
    await c.db.insert("organization", { orgId: w.orgId, name: `${tag} Legal Name PLC`, tin: "0012345678" });
  });
  return { unitId, unit2, renterId, renter2, agreementId, draft, meterId, readingId: rd.id, costId: cost.id, pay, adj, invs };
}

type V = { type: string; tableName?: string; value?: any; fieldType?: any };
function sample(v: V, ids: Map<string, Id<any>>, name: string): unknown {
  switch (v.type) {
    case "id": return ids.get(v.tableName!) ?? "j57" + "0".repeat(29);
    case "string": return /period/i.test(name) ? "2026-09" : /email/i.test(name) ? "x@y.et" : /phone/i.test(name) ? "+251911000000" : /code|slug/i.test(name) ? "abcdef" : /^(kind)$/.test(name) ? "x" : "x";
    case "number": return 1;
    case "boolean": return false;
    case "null": return null;
    case "literal": return v.value;
    case "union": return sample(v.value[0], ids, name);
    case "array": return [sample(v.value, ids, name)];
    case "object": return Object.fromEntries(Object.entries(v.value as Record<string, { fieldType: V; optional: boolean }>).map(([k, f]) => [k, sample(f.fieldType, ids, k)]));
    case "record": return {};
    default: return "x";
  }
}

async function publicFunctions() {
  const out: { module: string; name: string; kind: "query" | "mutation"; args: Record<string, { fieldType: V; optional: boolean }> }[] = [];
  for (const [path, load] of Object.entries(modules)) {
    const m = path.replace("../convex/", "").replace(/\.ts$/, "");
    if (m.includes("/") || m.startsWith("_")) continue;
    const exp = (await load()) as Record<string, any>;
    for (const [name, f] of Object.entries(exp)) {
      if (!f || !f.isPublic) continue;
      const kind = f.isQuery ? "query" : f.isMutation ? "mutation" : null;
      if (!kind) continue;
      out.push({ module: m, name, kind, args: JSON.parse(f.exportArgs()).value });
    }
  }
  return out;
}

async function snapshot(t: T, orgId: Id<"organizations">) {
  return t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of TENANT_TABLES) out[table] = (await (ctx.db.query(table as never) as any).collect()).filter((d: any) => d.orgId === orgId).sort((a: any, b: any) => (a._id < b._id ? -1 : 1));
    out.organizations = [await ctx.db.get(orgId)];
    return out;
  });
}

async function probe(t: T, from: Awaited<ReturnType<typeof world>>, to: Awaited<ReturnType<typeof world>>, fns: Awaited<ReturnType<typeof publicFunctions>>, toTag: string) {
  const spyId = await from.mk("spy", ["superAdmin", "propertyManager", "financeOfficer", "approver", "auditor", "accessAdmin"]);
  const spy = from.as(spyId);
  // everything that belongs to the other company
  const snap0 = await snapshot(t, to.orgId);
  const ids = new Map<string, Id<any>>(); const secrets = new Set<string>();
  for (const [table, rows] of Object.entries(snap0)) for (const r of rows as any[]) { if (!r) continue; if (!ids.has(table)) ids.set(table, r._id); secrets.add(r._id); }
  const files = await t.run(async (ctx) => (await ctx.db.query("fileOwners").collect()).filter((f) => f.orgId === to.orgId));
  if (files[0]) ids.set("_storage", files[0].storageId);
  ids.set("organizations", to.orgId);
  const theirUsers = await t.run(async (ctx) => (await ctx.db.query("memberships").collect()).filter((m) => m.orgId === to.orgId));
  ids.set("users", theirUsers[0]!.userId); for (const m of theirUsers) secrets.add(m.userId);
  for (const f of files) secrets.add(f.storageId);
  const words = [`${toTag} Legal Name`, `Renter ${toTag}`, `Spare ${toTag}`, `${toTag}-1`, `${toTag}-PAY`, `${toTag}-BANK`, `@${toTag}.et`, `M-${toTag}`, `${toTag}-DEP`, `Notice from ${toTag}`, `Asker ${toTag}`];
  const leaks: string[] = [];
  let called = 0, refused = 0;
  for (const f of fns) {
    const args = Object.fromEntries(Object.entries(f.args).map(([k, a]) => [k, sample(a.fieldType, ids, k)]));
    const ref = (from.api as any)[f.module][f.name];
    try {
      const res = f.kind === "query" ? await spy.query(ref, args) : await spy.mutation(ref, args);
      called++;
      const text = JSON.stringify(res ?? null);
      const sent = JSON.stringify(args); // an id the caller sent in and gets echoed back (in a "not found" list) tells them nothing
      for (const s of [...secrets, ...words]) if (text.includes(s) && !sent.includes(s)) { leaks.push(`${f.module}.${f.name} returned ${s.slice(0, 40)}`); break; }
    } catch { refused++; }
  }
  // the other company's records are exactly as they were
  const snap1 = await snapshot(t, to.orgId);
  for (const table of Object.keys(snap0)) if (JSON.stringify(snap0[table]) !== JSON.stringify(snap1[table])) leaks.push(`${to.orgId}: ${table} changed`);
  // no record of the calling company points at the other company
  const mine = await snapshot(t, from.orgId);
  for (const [table, rows] of Object.entries(mine)) for (const r of rows as any[]) {
    if (table === "auditLog") continue; // the history records what was attempted
    const text = JSON.stringify(r ?? null);
    for (const s of secrets) if (text.includes(s)) { leaks.push(`${table} of the caller points at ${s.slice(0, 30)}`); break; }
  }
  return { leaks, called, refused, count: fns.length };
}

describe("two companies cannot see or change each other's records", () => {
  it("every public function, both directions", async () => {
    const t = newTest();
    const A = await world({ t, slug: "alpha-co", name: "Alpha Co" });
    const B = await world({ t, slug: "beta-tower", name: "Beta Tower Co" });
    await fill(A, "alpha"); await fill(B, "beta");
    const fns = await publicFunctions();
    expect(fns.length).toBeGreaterThan(120); // the list really is read from the code
    const ab = await probe(t, A, B, fns, "beta");
    const ba = await probe(t, B, A, fns, "alpha");
    expect([...ab.leaks, ...ba.leaks]).toEqual([]);
    expect(ab.called + ab.refused).toBe(fns.length);
    expect(ab.refused).toBeGreaterThan(30); // most calls with the other company's ids must be refused
  }, 300_000);
});
