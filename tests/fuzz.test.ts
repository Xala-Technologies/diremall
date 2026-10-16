import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { scan } from "../convex/integrity";
import { etb, storePdf, utc, world } from "./helpers";

/** A small seeded random generator, so a failing run can be repeated exactly. */
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/**
 * Drive the whole system with a long random sequence of real operations (leases, bills, payments, credits, corrections,
 * terminations, deposits, bank lines, readings, shared costs, deletions) and run the books health check after every step.
 * Operations may be refused (that is normal); whatever is accepted must leave the books consistent.
 */
async function play(seed: number, steps: number) {
  const r = rng(seed); const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const w = await world();
  const boss = w.as(await w.mk("boss", ["superAdmin"]));
  const ap2 = w.as(await w.mk("ap2", ["approver"]));
  const fin2 = w.as(await w.mk("fin2", ["financeOfficer"]));
  const units: any[] = [], renters: any[] = [], ags: any[] = [], pays: any[] = [], invs: any[] = [], meters: any[] = [];
  const log: string[] = [];
  const ok = async (name: string, fn: () => Promise<unknown>) => { try { const v = await fn(); log.push(name); return v; } catch { return undefined; } };
  const period = () => `2026-${String(1 + Math.floor(r() * 10)).padStart(2, "0")}`;
  for (let i = 0; i < 8; i++) units.push(await w.unit(`U${i}`, 20 + i * 15)); for (let i = 0; i < 4; i++) renters.push(await w.renter(`R${i}`));
  let refSeq = 1;

  for (let step = 0; step < steps; step++) {
    const op = pick([0, 0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 7, 7, 8, 8, 9, 9, 10, 10, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    if (op === 0) await ok("lease", async () => {
      const start = utc(2026, 1 + Math.floor(r() * 9), 1 + Math.floor(r() * 27)), len = 60 + Math.floor(r() * 500);
      const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId: pick(units), renterId: pick(renters), startsAt: start, endsAt: start + len * 86_400_000, rent: r() < 0.5 ? { kind: "fixed", amount: etb(1000 + Math.floor(r() * 90000)) } : { kind: "perM2", ratePerM2: etb(500 + Math.floor(r() * 3000)) }, dueDay: 1 + Math.floor(r() * 27), depositAmount: etb(Math.floor(r() * 5) * 10000), ...(r() < 0.3 ? { escalation: { percent: 5 + Math.floor(r() * 10), everyMonths: 12 } } : {}) });
      await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: await w.t.run((c) => storePdf(c as never)) });
      await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id });
      await w.ap.mutation(w.api.agreements.approve, { agreementId: id }); ags.push(id);
    });
    else if (op === 1) await ok("generate", () => w.fin.mutation(w.api.billing.generate, { period: period() }));
    else if (op === 2) await ok("issue", async () => { const d = (await w.fin.query(w.api.billing.list, { period: period(), status: "draft" })).map((x) => x._id); await w.fin.mutation(w.api.billing.issue, { invoiceIds: d.slice(0, 20) }); });
    else if (op === 3 || op === 4) await ok("record", async () => { const id = await w.fin.mutation(w.api.payments.record, { renterId: pick(renters), amount: etb(100 + Math.floor(r() * 150000)) + (r() < 0.2 ? 17 : 0), method: pick(["cash", "transfer", "telebirr", "bankDeposit"] as const), reference: `P${refSeq++}`, receivedAt: utc(2026, 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 27)), notDuplicate: true }); pays.push(id); });
    else if (op === 5 || op === 6) await ok("confirm", () => w.ap.mutation(w.api.payments.confirm, { paymentId: pick(pays) }));
    else if (op === 7 || op === 8) await ok("apply", async () => {
      const id = pick(pays); const p = (await w.t.run((c) => c.db.get(id as never))) as any;
      if (r() < 0.4 && p) { const open = await w.fin.query(w.api.payments.openBills, { renterId: p.renterId }); const b = open[0]; if (b) return w.fin.mutation(w.api.payments.apply, { paymentId: id, allocations: [{ invoiceId: b.invoiceId, amount: Math.max(1, Math.min(b.due, Math.floor(p.amount * r()))) }] }); }
      return w.fin.mutation(w.api.payments.apply, { paymentId: id });
    });
    else if (op === 9) await ok("useCredit", async () => { const all = await w.fin.query(w.api.billing.list, { openOnly: true }); await w.fin.mutation(w.api.payments.useCredit, { invoiceId: pick(all)._id }); });
    else if (op === 10) await ok("adjust", async () => { const all = await w.fin.query(w.api.billing.list, { openOnly: true }); const a = pick(all); const id = await w.fin.mutation(w.api.billing.requestAdjustment, { invoiceId: a._id, delta: (r() < 0.6 ? -1 : 1) * etb(1 + Math.floor(r() * 100000)), reason: "fuzz" }); if (r() < 0.8) await w.ap.mutation(w.api.billing.approveAdjustment, { adjustmentId: id }); });
    else if (op === 11) await ok("void", () => w.ap.mutation(w.api.payments.voidPayment, { paymentId: pick(pays), reason: "fuzz" }));
    else if (op === 12) await ok("terminate", () => w.ap.mutation(w.api.agreements.terminate, { agreementId: pick(ags), reason: "fuzz", effectiveAt: utc(2026, 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 27)) }));
    else if (op === 13) await ok("expire", () => w.t.mutation(internal.smsQueue.expireAgreements, {}));
    else if (op === 14) await ok("depositReceive", () => w.fin.mutation(w.api.deposits.receive, { agreementId: pick(ags), amount: etb(1000 + Math.floor(r() * 20000)), method: "cash", reference: `D${refSeq++}` }));
    else if (op === 15) await ok("deduct", async () => { const id = pick(ags); await w.fin.mutation(w.api.deposits.requestDeduction, { agreementId: id, amount: etb(500), reason: "fuzz" }); await w.ap.mutation(w.api.deposits.approveDeduction, { agreementId: id, index: 0 }); });
    else if (op === 16) await ok("refund", () => w.ap.mutation(w.api.deposits.refund, { agreementId: pick(ags), amount: etb(100) }));
    else if (op === 17) await ok("reading", async () => { if (meters.length < 3) meters.push(await w.pm.mutation(w.api.utilities.addMeter, { unitId: pick(units), kind: pick(["water", "electricity"] as const), serial: `M${meters.length}` })); const m = pick(meters); const res = await w.pm.mutation(w.api.utilities.enterReading, { meterId: m, value: Math.floor(r() * 5000), readAt: utc(2026, 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 27)) }); if (res.status === "draft") await w.fin.mutation(w.api.utilities.approveReading, { readingId: res.id }); });
    else if (op === 18) await ok("sharedCost", async () => { const id = await w.fin.mutation(w.api.utilities.createSharedCost, { buildingId: w.buildingId, kind: pick(["generator", "security", "cleaning"] as const), period: period(), total: etb(1000 + Math.floor(r() * 90000)) }); await w.ap.mutation(w.api.utilities.approveSharedCost, { sharedCostId: id.id }); });
    else if (op === 19) await ok("deleteSomething", async () => { const k = r(); if (k < 0.3) await w.pm.mutation(w.api.removals.deleteRenter, { renterId: pick(renters) }); else if (k < 0.6) await w.pm.mutation(w.api.removals.deleteUnit, { unitId: pick(units) }); else await w.pm.mutation(w.api.removals.deleteDraftAgreement, { agreementId: pick(ags) }); });
    else if (op === 20) await ok("bank", async () => { const p = pick(pays); const row = (await w.t.run((c) => c.db.get(p as never))) as any; if (!row) return; await w.fin.mutation(w.api.bank.importStatement, { batch: `B${step}`, entries: [{ postedAt: row.receivedAt, amount: row.amount, reference: `BK${step}` }] }); const e = (await w.ap.query(w.api.bank.statement, { batch: `B${step}` })).lines[0]!; await w.ap.mutation(w.api.bank.confirmMatch, { entryId: e._id, paymentId: p }); });
    else if (op === 21) await ok("archive", () => w.pm.mutation(w.api.properties.setBuildingArchived, { buildingId: w.buildingId, archived: r() < 0.5 }));
    else if (op === 22) await ok("reverse", () => w.ap.mutation(w.api.payments.reverse, { paymentId: pick(pays), reason: "fuzz" }));
    else if (op === 23) await ok("renew", async () => { const id = pick(ags); const ag = (await w.t.run((c) => c.db.get(id as never))) as any; await w.ap.mutation(w.api.agreements.addTerm, { agreementId: id, effectiveFrom: ag.startsAt + (30 + Math.floor(r() * 200)) * 86_400_000, rent: { kind: "fixed", amount: etb(1000 + Math.floor(r() * 90000)) }, dueDay: 1 + Math.floor(r() * 27), depositAmount: etb(Math.floor(r() * 5) * 10000), ...(r() < 0.5 ? { newEndsAt: ag.endsAt + 200 * 86_400_000 } : {}) }); });
    else if (op === 24) await ok("depositToBill", async () => { const id = pick(ags); const ag = (await w.t.run((c) => c.db.get(id as never))) as any; const open = await w.fin.query(w.api.payments.openBills, { renterId: ag.renterId }); const b = open[0]; if (!b) return; await w.fin.mutation(w.api.deposits.requestDeduction, { agreementId: id, amount: Math.max(1, Math.floor(b.due * r())), reason: "fuzz", invoiceId: b.invoiceId }); const dep = (await w.fin.query(w.api.deposits.get, { agreementId: id })); await w.ap.mutation(w.api.deposits.approveDeduction, { agreementId: id, index: dep.deductions.length - 1 }); });
    // the books must agree with themselves after every single step
    const res = await w.t.run((c) => scan(c as never));
    // the reports must add up to the same figures as the records they are built from
    const open = await w.fin.query(w.api.billing.list, { openOnly: true });
    const aging = await w.fin.query(w.api.reports.aging, {});
    const agingTotal = Object.values(aging.totals).reduce((a: number, b: number) => a + b, 0);
    if (agingTotal !== open.reduce((a, b) => a + b.due, 0)) throw new Error(`seed ${seed} step ${step} after [${log.slice(-3).join(", ")}]: arrears ageing ${agingTotal} differs from the open bills ${open.reduce((a, b) => a + b.due, 0)}`);
    const now = Date.now(); const leases = await w.fin.query(w.api.agreements.list, { status: "active" });
    const roll = await w.fin.query(w.api.reports.rentRoll, {});
    const live = leases.filter((a) => a.startsAt <= now && a.endsAt > now).reduce((a, b) => a + b.rent, 0);
    if (roll.totalMonthlyRent !== live) throw new Error(`seed ${seed} step ${step} after [${log.slice(-3).join(", ")}]: rent roll ${roll.totalMonthlyRent} differs from the live leases ${live}`);
    if (res.findings.length) throw new Error(`seed ${seed} step ${step} after [${log.slice(-4).join(", ")}]: ${JSON.stringify(res.findings.slice(0, 3))}`);
  }
  if (process.env.FUZZ_DEBUG) { const c: Record<string, number> = {}; for (const n of log) c[n] = (c[n] ?? 0) + 1; (await import("node:fs")).appendFileSync(process.env.FUZZ_DEBUG!, `${seed} ${JSON.stringify(c)}\n`); }
  return log.length;
}

describe("the books stay consistent under any sequence of operations", () => {
  for (const seed of Array.from({ length: Number(process.env.FUZZ_SEEDS ?? 6) }, (_, i) => i + 1)) it(`seed ${seed}`, async () => { const done = await play(seed, 200); expect(done).toBeGreaterThan(20); }, 120_000);
});
