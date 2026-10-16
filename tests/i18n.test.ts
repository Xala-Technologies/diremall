import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AM, EN } from "../src/lib/dictionary";

/** A label that is not in the dictionary shows its raw key on screen. Every fixed label used by the screens must exist in both languages. */
describe("labels", () => {
  const files = globSync("src/**/*.{ts,tsx}").filter((f) => !f.endsWith("dictionary.ts"));
  const used = new Map<string, string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([A-Za-z0-9_.]+)"\)/g)) if (!used.has(m[1]!)) used.set(m[1]!, f);
  it("exist in English and Amharic", () => {
    const missing = [...used].filter(([k]) => !(k in EN) || !(k in AM)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });
  it("have no English text left behind in Amharic that looks untranslated", () => {
    const same = Object.keys(EN).filter((k) => AM[k] === EN[k] && /[A-Za-z]{5,}/.test(EN[k]!) && !/^(email|TIN|VAT|PDF|CSV|Excel|SMS)/.test(EN[k]!) && !k.startsWith("sms.err") && !/^[A-Z0-9 .\-\/()]+$/.test(EN[k]!)).slice(0, 15);
    expect(same, `still in English in the Amharic file: ${same.join(", ")}`).toEqual([]);
  });
});
