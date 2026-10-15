import { describe, expect, it } from "vitest";
import { RENTER_COLUMNS, UNIT_COLUMNS, mapRows, parseCsv, RENTER_OPTIONAL } from "../src/lib/importFile";

describe("spreadsheet reading", () => {
  it("reads quoted cells, commas inside quotes, doubled quotes and Windows line endings", () => {
    expect(parseCsv('a,b,c\r\n"x, y","say ""hi""",3\r\n')).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "3"]]);
  });
  it("detects semicolons and tabs as separators (Excel in Ethiopia/Europe exports semicolons)", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("matches headers in any order and with friendly names, numbers rows from the sheet, and skips blank lines", () => {
    const table = parseCsv("Rate per m² (ETB),Unit number,Building,Floor,Area (m²),Category\n2300,G-01,Main,Ground,150,Retail\n,,,,,\n1800,A-101,Main,1st,120,Office");
    const { rows, missing } = mapRows(table, UNIT_COLUMNS);
    expect(missing).toEqual([]);
    expect(rows.map((r) => [r.row, r.unit, r.area, r.rate])).toEqual([[2, "G-01", "150", "2300"], [4, "A-101", "120", "1800"]]);
  });
  it("names the columns that are missing", () => {
    expect(mapRows(parseCsv("name,phone\nA,1"), RENTER_COLUMNS, RENTER_OPTIONAL).missing).toEqual(["kind", "tin", "license", "email", "rep"]);
  });
  it("accepts the downloaded templates as written", () => {
    const t = parseCsv("type,name,tin,business licence no.,phone,email,legal representative\ncompany,Abebe,0012345678,DD/1,0911 20 01 01,a@b.co,Abebe K");
    expect(mapRows(t, RENTER_COLUMNS, RENTER_OPTIONAL).missing).toEqual([]);
  });
});
