import { describe, expect, it } from "vitest";
import { shouldBootstrap } from "../convex/lib/signup";
import { lockDuration } from "../convex/mfa";
import { csvCell } from "../src/lib/csv";
import { etb, storePdf, utc, world } from "./helpers";

describe("csv export", () => {
  it("defuses spreadsheet formulas but leaves numbers and amounts alone", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-cmd|' /C calc'!A0")).toContain("'-cmd");
    expect(csvCell("-1,200.00")).toBe(`"-1,200.00"`); // an amount, not a formula
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell("Abebe Trading PLC")).toBe("Abebe Trading PLC");
    expect(csvCell("Tigist, Beauty Salon")).toBe(`"Tigist, Beauty Salon"`);
  });
});

describe("first super admin", () => {
  it("only the named address, and only while no super admin exists", () => {
    expect(shouldBootstrap({ only: "boss@x.et", email: "boss@x.et", userCount: 5, hasPlatformAdmin: false })).toBe(true); // others signed up first
    expect(shouldBootstrap({ only: "boss@x.et", email: "Boss@X.et ", userCount: 1, hasPlatformAdmin: false })).toBe(true);
    expect(shouldBootstrap({ only: "boss@x.et", email: "intruder@x.et", userCount: 1, hasPlatformAdmin: false })).toBe(false);
    expect(shouldBootstrap({ only: "boss@x.et", email: "boss@x.et", userCount: 2, hasPlatformAdmin: true })).toBe(false);
    expect(shouldBootstrap({ email: "a@x.et", userCount: 1, hasPlatformAdmin: false })).toBe(true); // dev: very first account
    expect(shouldBootstrap({ email: "b@x.et", userCount: 2, hasPlatformAdmin: false })).toBe(false);
  });
});

describe("two-step lockout", () => {
  it("lasts longer after every repeat, up to a day", () => {
    expect(lockDuration(0)).toBe(5 * 60_000);
    expect(lockDuration(1)).toBe(10 * 60_000);
    expect(lockDuration(3)).toBe(40 * 60_000);
    expect(lockDuration(30)).toBe(24 * 3_600_000);
  });
});

describe("uploads", () => {
  it("rejects files that are not PDF or images, or are too large", async () => {
    const { t, api, pm, unit, renter, pmId } = await world();
    const unitId = await unit("S-1", 50), renterId = await renter("R");
    const agreementId = await pm.mutation(api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 9), endsAt: utc(2027, 9), rent: { kind: "fixed", amount: etb(1000) }, dueDay: 5, depositAmount: 0 });
    const exe = await t.run((c) => storePdf(c as never, "application/x-msdownload"));
    await expect(pm.mutation(api.agreements.attachSignedCopy, { agreementId, fileId: exe })).rejects.toThrow(/file_type_not_allowed/);
    const big = await t.run(async (c) => { const id = await storePdf(c as never); await (c.db as never as { patch: (i: unknown, v: object) => Promise<void> }).patch(id, { size: 16 * 1024 * 1024 }); return id; });
    await expect(pm.mutation(api.agreements.attachSignedCopy, { agreementId, fileId: big })).rejects.toThrow(/file_too_large/);
    const ok = await t.run((c) => storePdf(c as never, "image/png"));
    await pm.mutation(api.agreements.attachSignedCopy, { agreementId, fileId: ok });
    void pmId;
  });
});
