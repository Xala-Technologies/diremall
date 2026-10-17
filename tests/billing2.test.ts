import { describe, expect, it } from "vitest";
import { etbInWords, numberInWords } from "../src/lib/words";
import { etb, utc, world } from "./helpers";

describe("amount in words", () => {
  it("writes birr and santim out", () => {
    expect(etbInWords(etb(230000))).toBe("Two hundred thirty thousand birr only");
    expect(etbInWords(etb(1250.5))).toBe("One thousand two hundred fifty birr and fifty santim only");
    expect(etbInWords(etb(1000000))).toBe("One million birr only");
    expect(etbInWords(etb(21))).toBe("Twenty-one birr only");
    expect(etbInWords(0)).toBe("Zero birr only");
    expect(etbInWords(etb(345000))).toBe("Three hundred forty-five thousand birr only");
    expect(numberInWords(1000000000)).toBe("one billion");
  });
});

async function withBill() {
  const w = await world();
  const unitId = await w.unit("A-101", 100);
  const renterId = await w.renter("Abebe");
  await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(10000) });
  await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
  const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
  return { ...w, renterId, draftId: d!._id };
}

describe("payment reminders", () => {
  it("sends one SMS per bill per day, and never for drafts or paid bills", async () => {
    const w = await withBill();
    expect((await w.fin.mutation(w.api.billing.sendReminders, { invoiceIds: [w.draftId] })).skipped).toEqual([{ invoiceId: w.draftId, reason: "not_issued" }]);
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [w.draftId] });
    const r1 = await w.fin.mutation(w.api.billing.sendReminders, { invoiceIds: [w.draftId, w.draftId] });
    expect(r1).toEqual({ sent: 1, skipped: [] });
    const again = await w.fin.mutation(w.api.billing.sendReminders, { invoiceIds: [w.draftId] });
    expect(again).toEqual({ sent: 0, skipped: [{ invoiceId: w.draftId, reason: "already_reminded_today" }] });
    const sms = await w.t.run((c) => c.db.query("smsMessages").collect());
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ kind: "dueReminder", status: "queued", invoiceId: w.draftId });
    expect(sms[0]!.body).toMatch(/bill INV-2026-09-0001 of ETB 10,000\.00 was due on 5 Sep 2026 and is \d+ days overdue/);
    // once paid in full, nothing more is sent
    const p = await w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(10000), method: "cash", reference: "C1", receivedAt: utc(2026, 9, 4) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p });
    await w.fin.mutation(w.api.payments.apply, { paymentId: p });
    await w.t.run(async (c) => { for (const m of await c.db.query("smsMessages").collect()) await c.db.delete(m._id); });
    expect((await w.fin.mutation(w.api.billing.sendReminders, { invoiceIds: [w.draftId] })).skipped[0]!.reason).toBe("already_paid");
  });

  it("only finance staff send reminders, and not for another building's bills", async () => {
    const w = await withBill();
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [w.draftId] });
    await expect(w.pm.mutation(w.api.billing.sendReminders, { invoiceIds: [w.draftId] })).rejects.toThrow(/forbidden/);
    const other = await w.t.run((c) => c.db.insert("buildings", { orgId: w.orgId, name: "Other" }));
    const lim = w.as(await w.mk("lim", ["financeOfficer"], [other]));
    await expect(lim.mutation(w.api.billing.sendReminders, { invoiceIds: [w.draftId] })).rejects.toThrow(/forbidden/);
  });
});

describe("organisation details", () => {
  it("are saved by an approver, validated and cleaned, and readable by every signed-in user", async () => {
    const w = await world();
    expect(await w.pm.query(w.api.settings.org, {})).toMatchObject({ name: "Dire Mall" });
    await expect(w.pm.mutation(w.api.settings.setOrg, { name: "X" })).rejects.toThrow(/forbidden/);
    await expect(w.ap.mutation(w.api.settings.setOrg, { name: "Dire Mall PLC", tin: "123" })).rejects.toThrow(/invalid_tin/);
    await expect(w.ap.mutation(w.api.settings.setOrg, { name: " " })).rejects.toThrow(/name_required/);
    await w.ap.mutation(w.api.settings.setOrg, { name: " Dire Mall PLC ", tin: "0012345678", vatNumber: "123 456 789", phone: "0251 11 22 33", bankAccounts: " CBE 1000123456789 \\n Awash 0132 ", city: "Dire Dawa", address: "" });
    const o = await w.pm.query(w.api.settings.org, {});
    expect(o).toMatchObject({ name: "Dire Mall PLC", tin: "0012345678", vatNumber: "123456789", city: "Dire Dawa" });
    expect((o as { address?: string }).address).toBeUndefined();
    await w.ap.mutation(w.api.settings.setOrg, { name: "Dire Mall PLC" }); // a second save replaces, never duplicates
    expect(await w.t.run((c) => c.db.query("organization").collect())).toHaveLength(1);
  });
});
