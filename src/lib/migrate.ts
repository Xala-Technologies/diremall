/** Reads the agreements and opening-balance spreadsheets: dates, money and wording are turned into what the server expects. */
import type { ColumnSpec } from "./importFile";
import { parseStatementAmount, parseStatementDate } from "./statement";

export type ClientProblem = { row: number; field: string; code: string };

export const AGREEMENT_COLUMNS: ColumnSpec<"building" | "unit" | "renter" | "start" | "end" | "basis" | "amount" | "dueDay" | "deposit" | "depositPaid" | "escPercent" | "escMonths"> = {
  building: ["building", "building name"], unit: ["unit", "unit number", "unit no", "shop", "shop no"], renter: ["renter", "tenant", "renter tin or name", "tin or name", "name", "tin"],
  start: ["start date", "start", "starts", "from", "lease start"], end: ["end date", "end", "ends", "to", "lease end", "expiry"],
  basis: ["rent basis", "basis", "rent type", "type"], amount: ["rent", "rent (etb)", "rent etb", "amount", "rate", "rate or amount", "monthly rent"],
  dueDay: ["due day", "due day of month", "payment day"], deposit: ["deposit", "deposit (etb)", "deposit etb", "deposit required"], depositPaid: ["deposit paid", "deposit paid (etb)", "deposit held", "deposit received"],
  escPercent: ["yearly increase", "yearly increase %", "increase %", "escalation %", "annual increase"], escMonths: ["increase every", "increase every (months)", "escalation months", "increase months"],
};
export const AGREEMENT_OPTIONAL = ["building", "dueDay", "deposit", "depositPaid", "escPercent", "escMonths"] as const;

export const AGREEMENT_TEMPLATE = [
  { building: "Dire Mall Main Building", unit: "G-01", renter: "0012345678", "start date": "2025-09-01", "end date": "2027-08-31", "rent basis": "per m2", "rent (ETB)": 2300, "due day": 5, "deposit (ETB)": 690000, "deposit paid (ETB)": 690000, "yearly increase %": 10, "increase every (months)": 12 },
  { building: "Dire Mall Main Building", unit: "A-101", renter: "Mulu Law Office", "start date": "01/03/2024", "end date": "28/02/2026", "rent basis": "fixed", "rent (ETB)": 120000, "due day": 1, "deposit (ETB)": 240000, "deposit paid (ETB)": "", "yearly increase %": "", "increase every (months)": "" },
];

export const OPENING_COLUMNS: ColumnSpec<"building" | "unit" | "renter" | "amount" | "due" | "note"> = {
  building: ["building", "building name"], unit: ["unit", "unit number", "unit no", "shop"], renter: ["renter", "tenant", "renter tin or name", "tin or name", "name", "tin"],
  amount: ["amount owed", "amount owed (etb)", "amount", "balance", "balance (etb)", "arrears", "outstanding"], due: ["due date", "due", "original due date", "invoice date", "date"], note: ["note", "notes", "description", "remarks", "period"],
};
export const OPENING_OPTIONAL = ["building", "unit", "due", "note"] as const;

export const OPENING_TEMPLATE = [
  { building: "Dire Mall Main Building", unit: "G-01", renter: "0012345678", "amount owed (ETB)": 345000, "due date": "2026-09-05", note: "Rent September 2026" },
  { building: "", unit: "", renter: "Mulu Law Office", "amount owed (ETB)": 120000, "due date": "2026-08-01", note: "Rent August 2026" },
  { building: "", unit: "", renter: "Selam Pharmacy", "amount owed (ETB)": -50000, "due date": "", note: "Paid ahead (negative = credit)" },
];

const num = (s: string) => { const t = s.replace(/[,\s%]/g, ""); return t !== "" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };

export type AgreementServerRow = { row: number; building: string; unit: string; renter: string; startsAt: number; endsAt: number; basis: "perM2" | "fixed"; amount: number; dueDay: number; deposit: number; depositPaid?: number; escPercent?: number; escMonths?: number };

export function readAgreementRows(rows: ({ row: number } & Record<keyof typeof AGREEMENT_COLUMNS, string>)[]): { server: AgreementServerRow[]; problems: ClientProblem[] } {
  const server: AgreementServerRow[] = []; const problems: ClientProblem[] = [];
  for (const r of rows) {
    const bad = (field: string, code: string) => problems.push({ row: r.row, field, code });
    const startsAt = parseStatementDate(r.start), endsAt = parseStatementDate(r.end);
    if (startsAt === null) bad("start", "date"); if (endsAt === null) bad("end", "date");
    const b = r.basis.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const basis = ["perm2", "m2", "sqm", "persqm", "persquaremeter", "rate", "area"].includes(b) ? "perM2" : ["fixed", "monthly", "flat", "lumpsum", "amount"].includes(b) ? "fixed" : null;
    if (!basis) bad("basis", "basis");
    const amount = parseStatementAmount(r.amount);
    if (amount === null) bad("amount", "invalid_amount");
    const deposit = r.deposit.trim() === "" ? 0 : parseStatementAmount(r.deposit);
    if (deposit === null) bad("deposit", "invalid_amount");
    const paid = r.depositPaid.trim() === "" ? undefined : parseStatementAmount(r.depositPaid);
    if (paid === null) bad("depositPaid", "invalid_amount");
    const dueDay = r.dueDay.trim() === "" ? 5 : num(r.dueDay);
    if (dueDay === null) bad("dueDay", "due_day");
    const esc = r.escPercent.trim() === "" ? undefined : num(r.escPercent);
    if (esc === null) bad("escPercent", "invalid_escalation");
    const escM = r.escMonths.trim() === "" ? undefined : num(r.escMonths);
    if (escM === null) bad("escMonths", "invalid_escalation");
    if (problems.some((p) => p.row === r.row)) continue;
    server.push({ row: r.row, building: r.building, unit: r.unit, renter: r.renter, startsAt: startsAt!, endsAt: endsAt! + 86_400_000, basis: basis!, amount: amount!, dueDay: dueDay!, deposit: deposit!, ...(paid != null ? { depositPaid: paid } : {}), ...(esc ? { escPercent: esc } : {}), ...(escM ? { escMonths: escM } : {}) });
  }
  return { server, problems };
}

export type OpeningServerRow = { row: number; building: string; unit: string; renter: string; amount: number; dueAt: number; note: string };

/** `asOf` is the go-live date, used when a row has no due date of its own. */
export function readOpeningRows(rows: ({ row: number } & Record<keyof typeof OPENING_COLUMNS, string>)[], asOf: number): { server: OpeningServerRow[]; problems: ClientProblem[] } {
  const server: OpeningServerRow[] = []; const problems: ClientProblem[] = [];
  for (const r of rows) {
    const amount = parseStatementAmount(r.amount);
    const dueAt = r.due.trim() === "" ? asOf : parseStatementDate(r.due);
    if (amount === null) problems.push({ row: r.row, field: "amount", code: "invalid_amount" });
    if (dueAt === null) problems.push({ row: r.row, field: "due", code: "date" });
    if (amount === null || dueAt === null) continue;
    server.push({ row: r.row, building: r.building, unit: r.unit, renter: r.renter, amount, dueAt, note: r.note });
  }
  return { server, problems };
}
