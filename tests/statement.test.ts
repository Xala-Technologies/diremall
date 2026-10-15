import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/lib/importFile";
import { parseStatement, parseStatementAmount, parseStatementDate } from "../src/lib/statement";

describe("statement dates", () => {
  it("reads the formats Ethiopian banks print, day first when ambiguous", () => {
    const d = Date.UTC(2026, 9, 15);
    for (const s of ["2026-10-15", "15/10/2026", "15-10-2026", "15.10.2026", "15 Oct 2026", "15-Oct-26", "15/10/26", "10/15/2026", "2026-10-15 14:32:10"]) expect(parseStatementDate(s), s).toBe(d);
    expect(parseStatementDate("04/05/2026")).toBe(Date.UTC(2026, 4, 4)); // 4 May, not 5 April
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("soon")).toBeNull();
  });
});

describe("statement amounts", () => {
  it("reads amounts with commas, currency, brackets and CR/DR", () => {
    expect(parseStatementAmount("1,200.50")).toBe(120050);
    expect(parseStatementAmount("ETB 345,000")).toBe(34500000);
    expect(parseStatementAmount("(500.00)")).toBe(-50000);
    expect(parseStatementAmount("250000 CR")).toBe(25000000);
    expect(parseStatementAmount("250000 DR")).toBe(-25000000);
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("n/a")).toBeNull();
  });
});

describe("statement files", () => {
  it("reads a real-looking statement: preamble, quoted narration with commas, credit and debit columns", () => {
    const csv = [
      "Commercial Bank of Ethiopia", "Account: 1000123456789,Abebe Trading", "Statement period: 01/10/2026 - 31/10/2026", "",
      "Date,Narration,Ref No,Debit,Credit,Balance",
      '05/10/2026,"Rent, October - G-01",FT26278XYZ1,,"345,000.00","1,345,000.00"',
      "06/10/2026,Bank charge,CHG001,25.00,,\"1,344,975.00\"",
      '07/10/2026,Transfer from Selam Pharmacy,FT26280ABC2,,230000.00,"1,574,975.00"',
      ",Closing balance,,,,\"1,574,975.00\"",
      "31/02/2026,Broken date,X,,100.00,",
    ].join("\n");
    const r = parseStatement(parseCsv(csv));
    expect(r.headerFound).toBe(true);
    expect(r.lines.map((l) => [l.reference, l.amount, l.description])).toEqual([
      ["FT26278XYZ1", 34500000, "Rent, October - G-01"], ["FT26280ABC2", 23000000, "Transfer from Selam Pharmacy"],
    ]);
    expect(r.debits).toBe(1);
    expect(r.totalCredits).toBe(57500000);
    expect(r.problems).toEqual([{ row: 10, code: "date" }]);
  });

  it("reads one signed Amount column, and the plain date, amount, reference file", () => {
    const signed = parseStatement(parseCsv("Transaction Date,Details,Amount\n2026-10-05,Deposit,250000\n2026-10-06,Fee,-25"));
    expect(signed.lines).toHaveLength(1); expect(signed.debits).toBe(1);
    const plain = parseStatement(parseCsv("2026-10-04,250000,CBE-778 ABEBE\n2026-10-05,1200.50,TELEBIRR 9"));
    expect(plain.headerFound).toBe(false);
    expect(plain.lines.map((l) => [l.amount, l.reference])).toEqual([[25000000, "CBE-778 ABEBE"], [120050, "TELEBIRR 9"]]);
  });
});
