import { describe, expect, it } from "vitest";
import { escalatedRent, monthsBetween } from "../convex/lib/billing";
import { etb, utc, world, storePdf } from "./helpers";

describe("rent escalation", () => {
  it("raises rent by the percentage every interval, compounding", () => {
    const esc = { percent: 10, everyMonths: 12 };
    expect(escalatedRent(etb(100000), esc, utc(2026, 9), utc(2027, 8)).amount).toBe(etb(100000)); // 11 months: not yet
    expect(escalatedRent(etb(100000), esc, utc(2026, 9), utc(2027, 9)).amount).toBe(etb(110000));
    expect(escalatedRent(etb(100000), esc, utc(2026, 9), utc(2028, 9)).amount).toBe(etb(121000));
    expect(escalatedRent(etb(100000), undefined, utc(2026, 9), utc(2030, 9)).steps).toBe(0);
    expect(monthsBetween(utc(2026, 9), utc(2026, 8))).toBe(0);
  });

  it("is applied when bills are prepared and explained on the bill", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const renterId = await w.renter("R");
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2025, 9), endsAt: utc(2028, 9), rent: { kind: "fixed", amount: etb(100000) }, dueDay: 5, depositAmount: 0, escalation: { percent: 10, everyMonths: 12 } });
    const f = await w.t.run((c) => storePdf(c as never));
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: f });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id });
    await w.ap.mutation(w.api.agreements.approve, { agreementId: id });
    await w.fin.mutation(w.api.billing.generate, { period: "2025-09" });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    expect((await w.fin.query(w.api.billing.list, { period: "2025-09" }))[0]!.total).toBe(etb(100000));
    const y2 = (await w.fin.query(w.api.billing.list, { period: "2026-09" }))[0]!;
    expect(y2.total).toBe(etb(110000));
    expect((await w.fin.query(w.api.billing.get, { invoiceId: y2._id })).lines[0]!.calcNote).toMatch(/\+10% × 1/);
    await expect(w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2030, 1), endsAt: utc(2031, 1), rent: { kind: "fixed", amount: 1 }, dueDay: 5, depositAmount: 0, escalation: { percent: 0, everyMonths: 12 } })).rejects.toThrow(/invalid_escalation/);
  });
});

describe("unit reservation and receipts", () => {
  it("a lease starting in the future reserves the unit and does not mark it occupied yet", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const renterId = await w.renter("R");
    const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 2);
    const start = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1);
    const id = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: start, endsAt: start + 365 * 86_400_000, rent: { kind: "fixed", amount: etb(1000) }, dueDay: 5, depositAmount: 0 });
    const f = await w.t.run((c) => storePdf(c as never));
    await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId: id, fileId: f });
    await w.pm.mutation(w.api.agreements.submitForReview, { agreementId: id });
    await w.ap.mutation(w.api.agreements.approve, { agreementId: id });
    const [u] = (await w.pm.query(w.api.properties.listUnits, {}));
    expect(u!.status).toBe("vacant");
    expect(u!.reservedFrom).toBe(start);
    expect(u!.renterName).toBe("R");
  });

  it("applying a payment issues one receipt number and the receipt lists what it paid", async () => {
    const w = await world();
    const unitId = await w.unit("A-1", 10); const renterId = await w.renter("R");
    await w.activeAgreement(unitId, renterId, { kind: "fixed", amount: etb(1000) });
    await w.fin.mutation(w.api.billing.generate, { period: "2026-09" });
    const [d] = await w.fin.query(w.api.billing.list, { period: "2026-09" });
    await w.fin.mutation(w.api.billing.issue, { invoiceIds: [d!._id] });
    const p = await w.fin.mutation(w.api.payments.record, { renterId, amount: etb(1200), method: "cash", reference: "C1", receivedAt: utc(2026, 9, 3) });
    await w.ap.mutation(w.api.payments.confirm, { paymentId: p });
    await w.fin.mutation(w.api.payments.apply, { paymentId: p });
    const r = await w.fin.query(w.api.payments.get, { paymentId: p });
    expect(r.payment.receiptNumber).toBe("RCT-2026-0001");
    expect(r.lines).toEqual([{ invoiceNumber: "INV-2026-09-0001", period: "2026-09", unitNumber: "A-1", amount: etb(1000) }]);
    expect(r.credit).toBe(etb(200));
  });
});
