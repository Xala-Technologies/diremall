/** Reads a bank statement (already split into cells) into the money-in lines the app needs. */

export type StatementLine = { row: number; postedAt: number; amount: number; reference: string; description: string };
export type StatementProblem = { row: number; code: "date" | "amount" };
export type StatementRead = {
  lines: StatementLine[];
  /** money-out rows are skipped: only deposits can be rent */
  debits: number;
  problems: StatementProblem[];
  headerFound: boolean;
  /** which columns were recognised, for the preview ("Date, Narration, Credit …") */
  columns: string[];
  totalCredits: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const NAMES = {
  date: ["date", "postingdate", "valuedate", "transactiondate", "transdate", "txndate", "bookingdate"],
  description: ["description", "narration", "narrative", "details", "particulars", "remarks", "transactiondetails"],
  reference: ["reference", "ref", "refno", "referenceno", "transactionid", "txnid", "trxid", "transactionref", "chequeno", "receiptno", "voucher"],
  credit: ["credit", "creditamount", "deposit", "deposits", "cr", "moneyin", "paidin"],
  debit: ["debit", "debitamount", "withdrawal", "withdrawals", "dr", "moneyout", "paidout"],
  amount: ["amount", "transactionamount", "amt"],
} as const;
type Field = keyof typeof NAMES;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** 2026-10-15, 15/10/2026, 15-10-2026, 15.10.2026, 15 Oct 2026, 15-Oct-26. Day first when it is ambiguous. Returns UTC midnight. */
export function parseStatementDate(raw: string): number | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, ""); // drop a time of day
  let y: number, m: number, d: number;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (r) { y = +r[1]!; m = +r[2]!; d = +r[3]!; }
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    let a = +r[1]!, b = +r[2]!; y = +r[3]!;
    if (y < 100) y += 2000;
    if (a <= 12 && b > 12) { m = a; d = b; } else { d = a; m = b; } // 10/15/2026 can only be month first; 10/11/2026 is read day first
  } else if ((r = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ ,-]*(\d{2,4})$/.exec(s))) {
    d = +r[1]!; m = MONTHS.indexOf(r[2]!.toLowerCase()) + 1; y = +r[3]!; if (y < 100) y += 2000;
    if (m === 0) return null;
  } else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
  const ms = Date.UTC(y, m - 1, d);
  return new Date(ms).getUTCDate() === d ? ms : null; // rejects 31 Feb
}

/** "1,200.50", "ETB 1,200.50", "(1,200.50)", "1200.50 CR" → santim (negative for brackets or DR); null when it is not a number. */
export function parseStatementAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bDR\b/i.test(s)) sign = -1;
  s = s.replace(/\b(CR|DR|ETB|BIRR)\b/gi, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

export function parseStatement(table: string[][]): StatementRead {
  const out: StatementRead = { lines: [], debits: 0, problems: [], headerFound: false, columns: [], totalCredits: 0 };
  // find the header row: statements often start with the account holder, number and period
  let headerAt = -1; let map: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    const found: Partial<Record<Field, number>> = {};
    table[i]!.forEach((cell, c) => {
      const n = norm(cell);
      for (const f of Object.keys(NAMES) as Field[]) if (found[f] === undefined && (NAMES[f] as readonly string[]).includes(n)) found[f] = c;
    });
    if (found.date !== undefined && (found.credit !== undefined || found.amount !== undefined || found.debit !== undefined)) { headerAt = i; map = found; break; }
  }
  let first = 0;
  if (headerAt >= 0) { out.headerFound = true; first = headerAt + 1; out.columns = (Object.keys(map) as Field[]).sort((a, b) => map[a]! - map[b]!); }
  else { map = { date: 0, amount: 1, reference: 2 }; out.columns = ["date", "amount", "reference"]; } // the simple three-column file: date, amount, reference

  for (let i = first; i < table.length; i++) {
    const cells = table[i]!; const row = i + 1;
    const at = (f: Field) => (map[f] === undefined ? "" : (cells[map[f]!] ?? "").trim());
    if (cells.every((c) => !c.trim())) continue;
    const dateText = at("date");
    const creditText = at("credit"), debitText = at("debit"), amountText = at("amount");
    let amount: number | null = null; let isDebit = false;
    if (map.credit !== undefined || map.debit !== undefined) {
      const cr = parseStatementAmount(creditText), dr = parseStatementAmount(debitText);
      if (cr !== null && cr > 0) amount = cr;
      else if (dr !== null && dr !== 0) isDebit = true;
      else if (!creditText && !debitText) continue; // opening balance, totals, blank
      else out.problems.push({ row, code: "amount" });
    } else {
      const a = parseStatementAmount(amountText);
      if (a === null) { if (dateText) out.problems.push({ row, code: "amount" }); continue; }
      if (a < 0) isDebit = true; else if (a > 0) amount = a;
    }
    if (isDebit) { out.debits++; continue; }
    if (amount === null) continue;
    const postedAt = dateText ? parseStatementDate(dateText) : null;
    if (postedAt === null) { if (dateText || amount) out.problems.push({ row, code: "date" }); continue; }
    const description = at("description");
    out.lines.push({ row, postedAt, amount, reference: at("reference") || description.slice(0, 80), description });
    out.totalCredits += amount;
  }
  return out;
}
