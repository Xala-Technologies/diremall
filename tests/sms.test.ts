import { describe, expect, it } from "vitest";
import { smsSegments } from "../src/lib/sms";

describe("sms segments", () => {
  it("counts Latin text at 160 per segment (153 when it spans several)", () => {
    expect(smsSegments("")).toEqual({ segments: 0, unicode: false, length: 0 });
    expect(smsSegments("a".repeat(160))).toMatchObject({ segments: 1, unicode: false });
    expect(smsSegments("a".repeat(161))).toMatchObject({ segments: 2 });
    expect(smsSegments("a".repeat(306))).toMatchObject({ segments: 2 });
    expect(smsSegments("a".repeat(307))).toMatchObject({ segments: 3 });
  });
  it("counts the extended characters twice", () => {
    expect(smsSegments("€".repeat(81))).toMatchObject({ length: 162, segments: 2 });
  });
  it("treats Amharic as unicode: 70 per segment (67 when it spans several)", () => {
    expect(smsSegments("ክፍያዎ ደርሷል")).toMatchObject({ unicode: true, segments: 1 });
    expect(smsSegments("አ".repeat(70))).toMatchObject({ segments: 1 });
    expect(smsSegments("አ".repeat(71))).toMatchObject({ segments: 2 });
    expect(smsSegments("አ".repeat(135))).toMatchObject({ segments: 3 });
  });
  it("the reminder text we send fits in one Latin segment or flags the cost when it does not", () => {
    const body = "Reminder: bill INV-2026-10-0001 of ETB 345,000.00 was due on 2026-10-05. Please pay as soon as possible. Thank you.";
    expect(smsSegments(body)).toMatchObject({ unicode: false, segments: 1 });
  });
});
