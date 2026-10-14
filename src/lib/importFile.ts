import { readSheet } from "read-excel-file/browser";

/** Read the first sheet of a .xlsx, or a .csv/.txt (comma, semicolon or tab separated), as rows of text. */
export async function readTable(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const rows = await readSheet(file);
    return rows.map((r) => r.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
  }
  return parseCsv(await file.text());
}

export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ሀ-፿]/g, "");

export type ColumnSpec<K extends string> = Record<K, string[]>;

/** Match the header row to the expected columns (any order, forgiving names) and return one object per data row. */
export function mapRows<K extends string>(table: string[][], spec: ColumnSpec<K>): { rows: ({ row: number } & Record<K, string>)[]; missing: K[] } {
  const keys = Object.keys(spec) as K[];
  const header = (table[0] ?? []).map(norm);
  const index = {} as Record<K, number>;
  const missing: K[] = [];
  for (const k of keys) {
    const i = header.findIndex((h) => spec[k].map(norm).includes(h));
    if (i < 0) missing.push(k); else index[k] = i;
  }
  if (missing.length) return { rows: [], missing };
  const rows = table.slice(1).map((cells, i) => ({ row: i + 2, ...Object.fromEntries(keys.map((k) => [k, (cells[index[k]] ?? "").trim()])) } as { row: number } & Record<K, string>))
    .filter((r) => keys.some((k) => r[k] !== "")); // skip blank lines
  return { rows, missing };
}

export const UNIT_COLUMNS: ColumnSpec<"building" | "floor" | "unit" | "area" | "category" | "rate"> = {
  building: ["building", "building name"], floor: ["floor", "level"], unit: ["unit", "unit number", "number", "unit no"],
  area: ["area", "area m2", "area (m²)", "area_m2", "size"], category: ["category", "type", "use"], rate: ["rate", "rate per m2", "rate per m² (etb)", "rate_per_m2", "rate per m2 etb", "rate_per_m2_etb"],
};
export const RENTER_COLUMNS: ColumnSpec<"kind" | "name" | "tin" | "license" | "phone" | "email" | "rep"> = {
  kind: ["type", "kind"], name: ["name", "full name", "company"], tin: ["tin", "tax id"], license: ["business licence no.", "business license", "licence", "license", "licence no"],
  phone: ["phone", "telephone", "mobile"], email: ["email", "e-mail"], rep: ["legal representative", "representative", "rep"],
};

export const UNIT_TEMPLATE = [
  { building: "Dire Mall Main Building", floor: "Ground", unit: "G-01", area_m2: 150, category: "retail", rate_per_m2_etb: 2300 },
  { building: "Dire Mall Main Building", floor: "1st floor", unit: "A-101", area_m2: 120, category: "office", rate_per_m2_etb: 1800 },
];
export const RENTER_TEMPLATE = [
  { type: "company", name: "Abebe Trading PLC", tin: "0012345678", "business licence no.": "DD/2020/123", phone: "0911 20 01 01", email: "info@abebe.example", "legal representative": "Abebe Kebede" },
  { type: "individual", name: "Hiwot Tailoring", tin: "", "business licence no.": "", phone: "0911 20 01 03", email: "", "legal representative": "" },
];
