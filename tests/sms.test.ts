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

import { DEFAULT_TEMPLATES, PLACEHOLDERS, TEMPLATE_KINDS, checkTemplate, renderTemplate, sampleVars, smsDate } from "../convex/lib/smsTemplates";

describe("sms templates", () => {
  it("renders placeholders, tidies leftover spaces and punctuation, and blanks missing values", () => {
    expect(renderTemplate("Dear {renter}, bill {bill} is due on {due}. {org}", { renter: "Abebe", bill: "INV-1", due: "5 Oct 2026", org: "Dire Mall" })).toBe("Dear Abebe, bill INV-1 is due on 5 Oct 2026. Dire Mall");
    expect(renderTemplate("Hello {renter} {unit} , thanks.", { renter: "Abebe" })).toBe("Hello Abebe, thanks.");
  });

  it("checks a template: empty, too long, unknown or stray braces", () => {
    const allowed = PLACEHOLDERS.dueSoon;
    expect(checkTemplate(allowed, "Hi {renter}, pay {amount} by {due}").ok).toBe(true);
    expect(checkTemplate(allowed, " ").problems).toEqual([{ code: "empty" }]);
    expect(checkTemplate(allowed, "x".repeat(481)).problems).toEqual([{ code: "too_long" }]);
    expect(checkTemplate(allowed, "Hi {renter} {receipt}").problems).toEqual([{ code: "unknown_placeholder", detail: "receipt" }]);
    expect(checkTemplate(allowed, "Hi {renter} {oops").problems).toEqual([{ code: "stray_brace" }]);
  });

  it("every built-in template is valid for its own placeholders, in both languages, and fits a reasonable number of segments", () => {
    for (const kind of TEMPLATE_KINDS) for (const lang of ["en", "am"] as const) {
      const body = DEFAULT_TEMPLATES[kind][lang];
      expect(checkTemplate(PLACEHOLDERS[kind], body), `${kind}:${lang}`).toEqual({ ok: true, problems: [] });
      const out = renderTemplate(body, sampleVars(kind, lang, "Dire Mall"));
      expect(out).not.toMatch(/[{}]/);
      expect(smsSegments(out).segments, `${kind}:${lang}`).toBeLessThanOrEqual(lang === "en" ? 2 : 4);
    }
  });

  it("writes dates in the calendar the reader uses", () => {
    expect(smsDate(Date.UTC(2026, 9, 5), "en")).toBe("5 Oct 2026");
    expect(smsDate(Date.UTC(2026, 8, 11), "am")).toBe("1 መስከረም 2019"); // Ethiopian new year
  });
});
