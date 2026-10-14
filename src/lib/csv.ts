/** Download rows as CSV (opens in Excel). Same rows as on screen, so totals match. */
export function downloadCsv(filename: string, rows: Record<string, string | number | null | undefined>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Parse a simple bank-statement CSV: date, amount, reference (header row optional). */
export function parseStatementCsv(text: string): { postedAt: number; amount: number; reference: string }[] {
  const out: { postedAt: number; amount: number; reference: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 3) continue;
    const postedAt = Date.parse(cells[0]!);
    const amount = Math.round(Number(cells[1]!.replace(/[,\s]/g, "")) * 100);
    if (Number.isNaN(postedAt) || Number.isNaN(amount) || amount <= 0) continue; // skips header and debits
    out.push({ postedAt, amount, reference: cells.slice(2).join(" ") });
  }
  return out;
}
