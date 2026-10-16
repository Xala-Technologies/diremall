import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { etb, utc, world } from "./helpers";

const DAY = 86_400_000;
afterEach(() => vi.useRealTimers());
const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });

/** One lease with the September bill issued (10,000 ETB, due 5 Sep 2026). */
async function withBill() {
  const w = await world();
  const unitId = await w.unit("A-101", 100);
  const renterId = await w.renter("Abebe");
  await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(10000) });
  await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
  const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
  await w.fin.mutation(w.api.billing.issue, { invoiceIds: [d!._id] });
  return { ...w, unitId, renterId, invoiceId: d!._id };
}
const messages = (w: Awaited<ReturnType<typeof withBill>>) => w.t.run((c) => c.db.query("smsMessages").collect());
const daily = (w: Awaited<ReturnType<typeof withBill>>) => w.t.mutation(internal.smsQueue.queueDueReminders, {});

describe("the reminder schedule", () => {
  it("reminds before the due date, then chases on the configured days, one message per step", async () => {
    const w = await withBill();
    at("2026-09-02T05:00:00Z"); // 3 days before the 5th
    expect(await daily(w)).toBe(1);
    expect((await messages(w))[0]).toMatchObject({ template: "dueSoon", kind: "dueReminder", lang: "en", status: "queued" });
    expect((await messages(w))[0]!.body).toBe("Dear Abebe, bill INV-2026-09-0001 of ETB 10,000.00 is due on 5 Sep 2026 (3 days). Please pay on time. Dire Mall");
    expect(await daily(w)).toBe(0); // the same day again adds nothing
    at("2026-09-04T05:00:00Z"); expect(await daily(w)).toBe(0); // already reminded for this bill
    at("2026-09-06T05:00:00Z"); expect(await daily(w)).toBe(1); // 1 day overdue: first step
    at("2026-09-08T05:00:00Z"); expect(await daily(w)).toBe(0); // nothing new until day 7
    at("2026-09-12T05:00:00Z"); expect(await daily(w)).toBe(1); // 7 days
    at("2026-10-05T05:00:00Z"); expect(await daily(w)).toBe(1); // 30 days
    at("2026-12-01T05:00:00Z"); expect(await daily(w)).toBe(0); // no step beyond 30
    expect((await messages(w)).map((m) => m.template)).toEqual(["dueSoon", "overdue", "overdue", "overdue"]);
  });

  it("an old overdue bill gets only the latest step, not all of them at once", async () => {
    const w = await withBill();
    at("2026-10-16T05:00:00Z"); // 41 days late
    expect(await daily(w)).toBe(1);
    expect((await messages(w))[0]!.dedupeKey).toBe(`overdue30:${w.invoiceId}`);
    expect((await messages(w))[0]!.body).toContain("is 41 days overdue");
  });

  it("follows the rules saved in Settings, and an approver is needed to change them", async () => {
    const w = await withBill();
    await expect(w.fin.mutation(w.api.smsQueue.saveRules, { before: 2, overdue1: 3, overdue2: 0, overdue3: 0, quietStart: 21, quietEnd: 7, dailyCap: 1, receipts: true, issued: false })).rejects.toThrow(/forbidden/);
    await w.ap.mutation(w.api.smsQueue.saveRules, { before: 2, overdue1: 3, overdue2: 0, overdue3: 0, quietStart: 21, quietEnd: 7, dailyCap: 1, receipts: true, issued: false });
    expect(await w.fin.query(w.api.smsQueue.rules, {})).toMatchObject({ before: 2, overdue1: 3, overdue2: 0, quietStart: 21, quietEnd: 7, dailyCap: 1 });
    at("2026-09-03T05:00:00Z"); expect(await daily(w)).toBe(1); // 2 days before
    at("2026-09-07T05:00:00Z"); expect(await daily(w)).toBe(0); // 2 days late is before the first step (3)
    at("2026-09-09T05:00:00Z"); expect(await daily(w)).toBe(1);
    for (const bad of [{ before: 31 }, { overdue1: -1 }, { overdue1: 5, overdue2: 5 }, { quietStart: 24 }, { dailyCap: 11 }, { before: 1.5 }]) {
      await expect(w.ap.mutation(w.api.smsQueue.saveRules, { before: 3, overdue1: 1, overdue2: 7, overdue3: 30, quietStart: 20, quietEnd: 8, dailyCap: 2, receipts: true, issued: false, ...bad })).rejects.toThrow();
    }
  });
});

describe("who is messaged and in what language", () => {
  it("writes to Amharic readers in Amharic with Ethiopian dates, and skips opted-out renters and bad numbers", async () => {
    const w = await withBill();
    await w.t.run((c) => c.db.patch(w.renterId, { smsLanguage: "am" }));
    at("2026-09-06T05:00:00Z"); await daily(w);
    const m = (await messages(w))[0]!;
    expect(m).toMatchObject({ lang: "am", template: "overdue" });
    expect(m.body).toContain("ውድ Abebe");
    expect(m.body).toContain("30 ነሐሴ 2018"); // 5 Sep 2026 in the Ethiopian calendar
    expect(m.segments).toBeGreaterThan(1); // Amharic uses 70-character segments

    await w.t.run(async (c) => { for (const x of await c.db.query("smsMessages").collect()) await c.db.delete(x._id); await c.db.patch(w.renterId, { smsOptOut: true }); });
    expect(await daily(w)).toBe(0);
    await w.t.run((c) => c.db.patch(w.renterId, { smsOptOut: false, phone: "12" }));
    expect(await daily(w)).toBe(0);
    expect(await messages(w)).toEqual([]);
  });

  it("uses the edited wording, and nothing is sent for a template switched off", async () => {
    const w = await withBill();
    await w.fin.mutation(w.api.smsQueue.saveTemplate, { kind: "overdue", lang: "en", body: "{org}: {renter}, {amount} is {days} days late on {bill}.", enabled: true });
    at("2026-09-08T05:00:00Z"); await daily(w);
    expect((await messages(w))[0]!.body).toBe("Dire Mall: Abebe, ETB 10,000.00 is 3 days late on INV-2026-09-0001.");
    await w.fin.mutation(w.api.smsQueue.saveTemplate, { kind: "overdue", lang: "en", body: "x {renter}", enabled: false });
    await w.t.run(async (c) => { for (const x of await c.db.query("smsMessages").collect()) await c.db.delete(x._id); });
    expect(await daily(w)).toBe(0);
    await w.fin.mutation(w.api.smsQueue.resetTemplate, { kind: "overdue", lang: "en" });
    expect(await daily(w)).toBe(1); // back to the built-in text, switched on
    expect((await messages(w))[0]!.body).toMatch(/^Dear Abebe, bill INV/);
  });

  it("validates edited wording and limits who can edit it", async () => {
    const w = await withBill();
    const save = (body: string, who = w.fin) => who.mutation(w.api.smsQueue.saveTemplate, { kind: "dueSoon", lang: "en", body, enabled: true });
    await expect(save("Hi {renter}, receipt {receipt}")).rejects.toThrow(/template_unknown_placeholder/);
    await expect(save("  ")).rejects.toThrow(/template_empty/);
    await expect(save("x".repeat(500))).rejects.toThrow(/template_too_long/);
    await expect(save("Hi {renter {due}")).rejects.toThrow(/template_stray_brace|template_unknown/);
    await expect(save("Hi {renter}", w.pm)).rejects.toThrow(/forbidden/);
    const t = (await w.pm.query(w.api.smsQueue.templates, {})).templates.find((x) => x.kind === "dueSoon")!;
    expect(t.langs.en).toMatchObject({ edited: false, enabled: true });
    await save("Hi {renter}, {amount} by {due}.");
    expect((await w.pm.query(w.api.smsQueue.templates, {})).templates.find((x) => x.kind === "dueSoon")!.langs.en).toMatchObject({ edited: true, body: "Hi {renter}, {amount} by {due}." });
  });

  it("sends the payment receipt from its template with the receipt number, unless receipts are off", async () => {
    const w = await withBill();
    const pay = async (ref: string) => { const p = await w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(2000), method: "cash", reference: ref, receivedAt: utc(2026, 9, 4), notDuplicate: true }); await w.ap.mutation(w.api.payments.confirm, { paymentId: p }); await w.fin.mutation(w.api.payments.apply, { paymentId: p }); };
    await pay("C1");
    const [ack] = (await messages(w)).filter((m) => m.template === "paymentReceived");
    expect(ack!.body).toMatch(/^Dear Abebe, we received your payment of ETB 2,000\.00\. Receipt RCT-2026-0001\. Thank you\. Dire Mall$/);
    await w.ap.mutation(w.api.smsQueue.saveRules, { before: 3, overdue1: 1, overdue2: 7, overdue3: 30, quietStart: 20, quietEnd: 8, dailyCap: 2, receipts: false, issued: false });
    await pay("C2");
    expect((await messages(w)).filter((m) => m.template === "paymentReceived")).toHaveLength(1);
  });

  it("can tell renters their bill is ready when that is switched on", async () => {
    const w = await world();
    const unitId = await w.unit("A-101", 100), renterId = await w.renter("Abebe");
    await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(10000) });
    await w.ap.mutation(w.api.smsQueue.saveRules, { before: 3, overdue1: 1, overdue2: 7, overdue3: 30, quietStart: 20, quietEnd: 8, dailyCap: 2, receipts: true, issued: true });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: (await w.fin.query(w.api.billing.list, { period: "2026-09" })).map((b) => b._id) });
    const [m] = await w.t.run((c) => c.db.query("smsMessages").collect());
    expect(m).toMatchObject({ template: "billIssued", kind: "billIssued" });
    expect(m!.body).toBe("Dear Abebe, your bill INV-2026-09-0001 of ETB 10,000.00 for unit A-101 is ready. Please pay by 5 Sep 2026. Dire Mall");
  });
});

describe("sending politely", () => {
  const claim = (w: Awaited<ReturnType<typeof withBill>>) => w.t.mutation(internal.smsQueue.claimQueued, {});
  const queue = (w: Awaited<ReturnType<typeof withBill>>, extra: object = {}) => w.t.run((c) => c.db.insert("smsMessages", { renterId: w.renterId, kind: "custom", body: "Hello", status: "queued", ...extra } as never));

  it("holds messages during quiet hours (Ethiopian time) and sends them in the morning; tests go straight out", async () => {
    const w = await withBill();
    await queue(w); await queue(w, { urgent: true, renterId: undefined, to: "+251911222333" });
    at("2026-10-16T19:30:00Z"); // 22:30 in Ethiopia
    expect((await claim(w)).map((m) => m.to)).toEqual(["+251911222333"]); // only the urgent test
    at("2026-10-17T06:00:00Z"); // 09:00
    expect(await claim(w)).toHaveLength(1);
  });

  it("limits automatic messages per renter per day, but not announcements", async () => {
    const w = await withBill();
    const sent = (status: string) => w.t.run((c) => c.db.insert("smsMessages", { renterId: w.renterId, kind: "dueReminder", body: "old", status, sentAt: Date.now() - 3_600_000 } as never));
    at("2026-10-16T08:00:00Z");
    await sent("delivered"); await sent("accepted"); // two already today: the default limit
    await queue(w, { kind: "dueReminder" }); await queue(w, { kind: "custom" });
    const out = await claim(w);
    expect(out).toHaveLength(1); // the announcement goes, the extra reminder waits
    expect((await messages(w)).filter((m) => m.status === "queued")).toHaveLength(1);
  });

  it("cancels a reminder for a bill that has been paid, or a renter who opted out, and fails an invalid number", async () => {
    const w = await withBill();
    at("2026-10-16T08:00:00Z");
    await queue(w, { kind: "dueReminder", invoiceId: w.invoiceId });
    const p = await w.fin.mutation(w.api.payments.record, { renterId: w.renterId, amount: etb(10000), method: "cash", reference: "P", receivedAt: utc(2026, 9, 4) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p }); await w.fin.mutation(w.api.payments.apply, { paymentId: p });
    await w.t.run(async (c) => { for (const x of await c.db.query("smsMessages").collect()) if (x.template === "paymentReceived") await c.db.delete(x._id); });
    await queue(w); await w.t.run((c) => c.db.patch(w.renterId, { smsOptOut: true }));
    expect(await claim(w)).toEqual([]);
    expect((await messages(w)).map((m) => m.status).sort()).toEqual(["cancelled", "cancelled"]);
    await w.t.run((c) => c.db.patch(w.renterId, { smsOptOut: false, phone: "12" }));
    await queue(w);
    expect(await claim(w)).toEqual([]);
    expect((await messages(w)).find((m) => m.status === "failed")!.lastError).toBe("no_valid_phone");
  });

  it("retries a 'slow down' reply after a growing wait, gives up after three tries, and never resends an uncertain one", async () => {
    const w = await withBill();
    at("2026-10-16T08:00:00Z");
    const id = await queue(w);
    for (const [n, wait] of [[1, 15], [2, 60]] as const) {
      expect(await claim(w)).toHaveLength(1);
      await w.t.mutation(internal.smsQueue.finish, { id, outcome: "rate_limited", error: "gateway_429" });
      const m = (await messages(w))[0]!;
      expect(m).toMatchObject({ status: "queued", attempts: n, lastError: "gateway_429" });
      expect(m.sendAfter).toBe(Date.now() + wait * 60_000);
      expect(await claim(w)).toEqual([]); // still waiting
      at(new Date(Date.now() + wait * 60_000 + 1000).toISOString());
    }
    expect(await claim(w)).toHaveLength(1);
    await w.t.mutation(internal.smsQueue.finish, { id, outcome: "rate_limited" });
    expect((await messages(w))[0]!.status).toBe("failed"); // third attempt used up
    // a refusal is final; silence is uncertain and is only resent by a person
    const a = await queue(w), b = await queue(w);
    await claim(w);
    await w.t.mutation(internal.smsQueue.finish, { id: a, outcome: "rejected", error: "gateway_400" });
    await w.t.mutation(internal.smsQueue.finish, { id: b, outcome: "unsure", error: "no_answer" });
    expect((await messages(w)).filter((m) => [a, b].includes(m._id)).map((m) => [m.status, m.lastError]).sort()).toEqual([["failed", "gateway_400"], ["uncertain", "no_answer"]]);
    expect(await claim(w)).toEqual([]);
    await w.fin.mutation(w.api.smsQueue.retry, { id: b });
    expect((await messages(w)).find((m) => m._id === b)).toMatchObject({ status: "queued", attempts: 0 });
  });
});

describe("announcements and the gateway test", () => {
  async function building() {
    const w = await withBill();
    const unit2 = await w.unit("A-102", 50), r2 = await w.renter("Selam"), r3 = await w.renter("Hiwot");
    await w.activeAgreement(unit2, r2, { kind: "fixed", amount: etb(5000) });
    await w.t.run(async (c) => { await c.db.patch(r2, { smsLanguage: "am" }); });
    return { ...w, r2, r3 };
  }

  it("previews who would get it and who is left out, then queues one message each in their language", async () => {
    const w = await building();
    const r4 = await w.renter("NoPhone"); const u4 = await w.unit("A-103", 30);
    await w.activeAgreement(u4, r4, { kind: "fixed", amount: etb(100) });
    await w.t.run((c) => c.db.patch(r4, { phone: "12" }));
    const pre = await w.pm.query(w.api.smsQueue.audiencePreview, { audience: { kind: "activeLeases" } });
    expect(pre).toMatchObject({ count: 2, noPhone: 1, optedOut: 0, amharic: 1 });
    const r = await w.pm.mutation(w.api.smsQueue.sendBroadcast, { audience: { kind: "activeLeases" }, body: "Dear {renter}, water will be off on Sunday. {org}", bodyAm: "ውድ {renter}፣ እሑድ ውሃ ይቋረጣል። {org}" });
    expect(r).toMatchObject({ queued: 2, noPhone: 1 });
    const out = (await messages(w)).filter((m) => m.batch === r.batch).sort((a, b) => a.body.localeCompare(b.body));
    expect(out.map((m) => m.body)).toEqual(["Dear Abebe, water will be off on Sunday. Dire Mall", "ውድ Selam፣ እሑድ ውሃ ይቋረጣል። Dire Mall"]);
    expect(out.every((m) => m.kind === "custom" && m.template === "broadcast")).toBe(true);
    // without an Amharic text, Amharic readers get the English one
    const en = await w.pm.mutation(w.api.smsQueue.sendBroadcast, { audience: { kind: "renters", renterIds: [w.r2] }, body: "Notice for {unit}." });
    expect((await messages(w)).find((m) => m.batch === en.batch)).toMatchObject({ body: "Notice for A-102.", lang: "en" });
  });

  it("can aim at overdue renters or one building, respects opt-out and checks the text", async () => {
    const w = await building();
    at("2026-10-16T08:00:00Z");
    expect((await w.pm.query(w.api.smsQueue.audiencePreview, { audience: { kind: "overdue" } })).count).toBe(1); // only Abebe has an unpaid bill
    await w.t.run((c) => c.db.patch(w.renterId, { smsOptOut: true }));
    expect(await w.pm.query(w.api.smsQueue.audiencePreview, { audience: { kind: "overdue" } })).toMatchObject({ count: 0, optedOut: 1 });
    expect((await w.pm.query(w.api.smsQueue.audiencePreview, { audience: { kind: "building", buildingId: w.buildingId } })).count).toBe(1);
    await expect(w.pm.mutation(w.api.smsQueue.sendBroadcast, { audience: { kind: "activeLeases" }, body: "Hi {receipt}" })).rejects.toThrow(/template_unknown_placeholder/);
    await expect(w.pm.mutation(w.api.smsQueue.sendBroadcast, { audience: { kind: "activeLeases" }, body: "" })).rejects.toThrow(/template_empty/);
    const other = await w.t.run((c) => c.db.insert("buildings", { name: "Other" }));
    const lim = w.as(await w.mk("lim", ["propertyManager"], [other]));
    expect((await lim.query(w.api.smsQueue.audiencePreview, { audience: { kind: "activeLeases" } })).count).toBe(0);
    await expect(lim.query(w.api.smsQueue.audiencePreview, { audience: { kind: "building", buildingId: w.buildingId } })).rejects.toThrow(/forbidden_building/);
  });

  it("sends a test message to a typed number now, a few times an hour at most, to people who may", async () => {
    const w = await withBill();
    await expect(w.pm.mutation(w.api.smsQueue.sendTest, { phone: "0911 22 33 44", lang: "en" })).rejects.toThrow(/forbidden/);
    await expect(w.fin.mutation(w.api.smsQueue.sendTest, { phone: "12", lang: "en" })).rejects.toThrow(/invalid_phone/);
    for (let i = 0; i < 5; i++) await w.fin.mutation(w.api.smsQueue.sendTest, { phone: "0911 22 33 44", lang: i === 1 ? "am" : "en" });
    await expect(w.fin.mutation(w.api.smsQueue.sendTest, { phone: "0911 22 33 44", lang: "en" })).rejects.toThrow(/too_many_tests/);
    const tests = (await messages(w)).filter((m) => m.template === "test");
    expect(tests).toHaveLength(5);
    expect(tests[0]).toMatchObject({ to: "+251911223344", urgent: true, status: "queued", body: "Test message from Dire Mall: your SMS gateway is working." });
    expect(tests[1]!.body).toContain("የሙከራ መልዕክት");
    expect(await w.fin.query(w.api.smsQueue.list, {})).toEqual(expect.arrayContaining([expect.objectContaining({ renterName: "+251911223344" })]));
  });
});
