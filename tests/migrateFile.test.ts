import { describe, expect, it } from "vitest";
import { AGREEMENT_COLUMNS, AGREEMENT_OPTIONAL, AGREEMENT_TEMPLATE, OPENING_COLUMNS, OPENING_OPTIONAL, OPENING_TEMPLATE, readAgreementRows, readOpeningRows } from "../src/lib/migrate";
import { mapRows, parseCsv } from "../src/lib/importFile";
import { etb, utc } from "./helpers";

const asTable = (rows: Record<string, unknown>[]) => [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r).map((v) => String(v)))];

describe("agreement spreadsheet", () => {
  it("accepts the downloadable template as written", () => {
    const { rows, missing } = mapRows(asTable(AGREEMENT_TEMPLATE), AGREEMENT_COLUMNS, AGREEMENT_OPTIONAL);
    expect(missing).toEqual([]);
    const { server, problems } = readAgreementRows(rows);
    expect(problems).toEqual([]);
    expect(server[0]).toMatchObject({ unit: "G-01", startsAt: utc(2025, 9, 1), endsAt: utc(2027, 8, 31), basis: "perM2", amount: etb(2300), deposit: etb(690000), depositPaid: etb(690000), escPercent: 10, escMonths: 12 });
    expect(server[1]).toMatchObject({ basis: "fixed", startsAt: utc(2024, 3, 1), endsAt: utc(2026, 2, 28), dueDay: 1 }); // 01/03/2024 is read day first
    expect(server[1]!.depositPaid).toBeUndefined(); // blank: the server assumes it was paid in full
  });

  it("names the bad cells by row and keeps those rows away from the server", () => {
    const csv = ["unit,renter,start date,end date,rent basis,rent", "A-1,Abebe,2025-09-01,2026-08-31,per m2,2300", "A-2,Abebe,soon,2026-08-31,monthly,1,000", "A-3,Abebe,2025-09-01,2026-08-31,weekly,100", "A-4,Abebe,2025-09-01,2026-08-31,fixed,lots"].join("\n");
    const { rows, missing } = mapRows(parseCsv(csv), AGREEMENT_COLUMNS, AGREEMENT_OPTIONAL);
    expect(missing).toEqual([]);
    const { server, problems } = readAgreementRows(rows);
    expect(server.map((r) => r.unit)).toEqual(["A-1"]);
    expect(problems.map((p) => `${p.row}:${p.field}`).sort()).toEqual(["3:start", "4:basis", "5:amount"]);
  });

  it("reports missing required columns", () => {
    const { missing } = mapRows(parseCsv("unit,renter\nA-1,Abebe"), AGREEMENT_COLUMNS, AGREEMENT_OPTIONAL);
    expect(missing).toEqual(["start", "end", "basis", "amount"]);
  });
});

describe("opening balance spreadsheet", () => {
  it("reads the template, with negative amounts as prepayments and a blank due date taking the go-live date", () => {
    const { rows, missing } = mapRows(asTable(OPENING_TEMPLATE), OPENING_COLUMNS, OPENING_OPTIONAL);
    expect(missing).toEqual([]);
    const { server, problems } = readOpeningRows(rows, utc(2026, 10, 15));
    expect(problems).toEqual([]);
    expect(server.map((r) => [r.amount, r.dueAt])).toEqual([[etb(345000), utc(2026, 9, 5)], [etb(120000), utc(2026, 8, 1)], [-etb(50000), utc(2026, 10, 15)]]);
  });

  it("flags unreadable amounts and dates", () => {
    const { rows } = mapRows(parseCsv("renter,amount owed,due date\nAbebe,lots,2026-09-05\nSelam,1000,never"), OPENING_COLUMNS, OPENING_OPTIONAL);
    expect(readOpeningRows(rows, 0).problems.map((p) => `${p.row}:${p.field}`)).toEqual(["2:amount", "3:due"]);
  });
});
