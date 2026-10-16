import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AM, EN } from "../src/lib/dictionary";

/** Every error the server can raise must have a readable message in both languages, or staff see "something went wrong (code)". */
describe("error messages", () => {
  const files = [...readdirSync("convex").filter((f) => f.endsWith(".ts")).map((f) => `convex/${f}`), ...readdirSync("convex/lib").map((f) => `convex/lib/${f}`)];
  const codes = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/(?:fail|new ConvexError)\("([a-z0-9_]+)"\)/g)) codes.add(m[1]!);
  it("has an English and an Amharic message for every code", () => {
    const missing = { en: [] as string[], am: [] as string[] };
    for (const c of codes) { if (!(`err.${c}` in EN)) missing.en.push(c); if (!(`err.${c}` in AM)) missing.am.push(c); }
    expect(missing).toEqual({ en: [], am: [] });
  });
});
