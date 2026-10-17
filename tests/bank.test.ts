import { describe, expect, it } from "vitest";
import { etb, utc, world } from "./helpers";

async function withPayment(amount = 250000, reference = "CBE-778") {
  const w = await world();
  const renterId = await w.renter("Abebe Trading");
  const paymentId = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(amount), method: "bankDeposit", reference, receivedAt: utc(2026, 9, 4) });
  return { ...w, renterId, paymentId };
}
const line = (amount: number, reference: string, extra: object = {}) => ({ postedAt: utc(2026, 9, 4), amount: etb(amount), reference, ...extra });

describe("bank statements", () => {
  it("imports lines with their narration, and skips a line that was already imported", async () => {
    const w = await world();
    const a = await w.fin.mutation(w.api.bank.importStatement, { batch: "cbe-sep", bank: "CBE", entries: [line(250000, "FT1", { description: "Rent, Sep" }), line(1000, "FT2")] });
    expect(a).toEqual({ imported: 2, duplicates: 0 });
    // an overlapping statement under another name: FT1 is already there
    const b = await w.fin.mutation(w.api.bank.importStatement, { batch: "cbe-sep-2", entries: [line(250000, "FT1"), line(5000, "FT3")] });
    expect(b).toEqual({ imported: 1, duplicates: 1 });
    await expect(w.fin.mutation(w.api.bank.importStatement, { batch: "cbe-sep", entries: [line(1, "X")] })).rejects.toThrow(/batch_already_imported/);
    await expect(w.fin.mutation(w.api.bank.importStatement, { batch: "empty", entries: [] })).rejects.toThrow(/import_empty/);
    const { lines, totals } = await w.fin.query(w.api.bank.statement, {});
    expect(lines).toHaveLength(3);
    expect(totals.toMatch).toEqual({ n: 3, amount: etb(256000) });
    expect(lines.find((l) => l.reference === "FT1")).toMatchObject({ description: "Rent, Sep", bank: "CBE" });
    const batches = await w.fin.query(w.api.bank.batches, {});
    expect(batches.map((x) => [x.batch, x.lines, x.toMatch]).sort()).toEqual([["cbe-sep", 2, 2], ["cbe-sep-2", 1, 1]]);
  });

  it("suggests the payment with the same amount, finds others by search, and refuses an amount that differs", async () => {
    const w = await withPayment();
    const other = await w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(240000), method: "transfer", reference: "TT-9", receivedAt: utc(2026, 9, 5) });
    await w.fin.mutation(w.api.bank.importStatement, { batch: "b", entries: [line(250000, "FT-CBE-778 ABEBE")] });
    const { lines: [l] } = await w.fin.query(w.api.bank.statement, { batch: "b" });
    const c1 = await w.fin.query(w.api.bank.candidates, { entryId: l!._id });
    expect(c1.map((c) => c.paymentId)).toEqual([w.paymentId]);
    expect(c1[0]).toMatchObject({ difference: 0, referenceMatches: true, taken: false });
    const c2 = await w.fin.query(w.api.bank.candidates, { entryId: l!._id, q: "abebe" });
    expect(c2.map((c) => c.paymentId).sort()).toEqual([w.paymentId, other].sort());
    await expect(w.fin.mutation(w.api.bank.confirmMatch, { entryId: l!._id, paymentId: other })).rejects.toThrow(/amount_differs/);
    await w.fin.mutation(w.api.bank.confirmMatch, { entryId: l!._id, paymentId: w.paymentId });
    const s = await w.fin.query(w.api.bank.statement, { batch: "b" });
    expect(s.totals.matched.n).toBe(1);
    expect(s.lines[0]!.payment).toMatchObject({ paymentId: w.paymentId, renterName: "Abebe Trading" });
    // the same payment cannot back a second line
    await w.fin.mutation(w.api.bank.importStatement, { batch: "c", entries: [line(250000, "FT-OTHER")] });
    const { lines: [l2] } = await w.fin.query(w.api.bank.statement, { batch: "c" });
    await expect(w.fin.mutation(w.api.bank.confirmMatch, { entryId: l2!._id, paymentId: w.paymentId })).rejects.toThrow(/payment_already_matched/);
  });

  it("ignores a line that is not rent with a reason, and reopening a match needs an approver", async () => {
    const w = await withPayment();
    await w.fin.mutation(w.api.bank.importStatement, { batch: "b", entries: [line(250000, "FT1"), line(25, "CHG")] });
    const { lines } = await w.fin.query(w.api.bank.statement, { batch: "b" });
    const rent = lines.find((l) => l.reference === "FT1")!, charge = lines.find((l) => l.reference === "CHG")!;
    await expect(w.fin.mutation(w.api.bank.ignore, { entryId: charge._id, reason: " " })).rejects.toThrow(/reason_required/);
    await w.fin.mutation(w.api.bank.ignore, { entryId: charge._id, reason: "Bank charge" });
    await expect(w.fin.mutation(w.api.bank.confirmMatch, { entryId: charge._id, paymentId: w.paymentId })).rejects.toThrow(/entry_ignored/);
    let s = await w.fin.query(w.api.bank.statement, { batch: "b" });
    expect(s.totals).toMatchObject({ ignored: { n: 1, amount: etb(25) }, toMatch: { n: 1 } });
    await w.fin.mutation(w.api.bank.reopen, { entryId: charge._id });
    expect((await w.fin.query(w.api.bank.statement, { batch: "b" })).totals.ignored.n).toBe(0);

    await w.fin.mutation(w.api.bank.confirmMatch, { entryId: rent._id, paymentId: w.paymentId });
    await expect(w.fin.mutation(w.api.bank.ignore, { entryId: rent._id, reason: "x" })).rejects.toThrow(/entry_already_matched/);
    await expect(w.fin.mutation(w.api.bank.reopen, { entryId: rent._id })).rejects.toThrow(/forbidden/);
    await w.ap.mutation(w.api.bank.reopen, { entryId: rent._id });
    s = await w.fin.query(w.api.bank.statement, { batch: "b" });
    expect(s.totals.matched.n).toBe(0);
    const log = await w.t.run((c) => c.db.query("auditLog").collect());
    expect(log.map((x) => x.action)).toEqual(expect.arrayContaining(["bank.import", "bank.match", "bank.ignore", "bank.reopen"]));
  });

  it("matching never creates a payment or changes collections", async () => {
    const w = await withPayment();
    await w.fin.mutation(w.api.bank.importStatement, { batch: "b", entries: [line(250000, "FT1")] });
    const before = await w.t.run((c) => c.db.query("payments").collect());
    const { lines: [l] } = await w.fin.query(w.api.bank.statement, { batch: "b" });
    await w.fin.mutation(w.api.bank.confirmMatch, { entryId: l!._id, paymentId: w.paymentId });
    const after = await w.t.run((c) => c.db.query("payments").collect());
    expect(after.map((p) => [p._id, p.status, p.amount])).toEqual(before.map((p) => [p._id, p.status, p.amount]));
  });

  it("property staff cannot import or match; building-limited finance staff are refused", async () => {
    const w = await world();
    await expect(w.pm.mutation(w.api.bank.importStatement, { batch: "b", entries: [line(1, "X")] })).rejects.toThrow(/forbidden/);
    const other = await w.t.run((c) => c.db.insert("buildings", { orgId: w.orgId, name: "Other" }));
    const lim = w.as(await w.mk("limfin", ["financeOfficer"], [other]));
    await expect(lim.mutation(w.api.bank.importStatement, { batch: "b", entries: [line(1, "X")] })).rejects.toThrow(/forbidden_building/);
  });
});
