import writeXlsxFile from "write-excel-file/browser";

export type SheetRows = { name: string; rows: Record<string, string | number | null | undefined>[] };

/** Download one or more sheets as a real .xlsx file. Numbers stay numbers so Excel can sum them. */
export async function downloadXlsx(filename: string, sheets: SheetRows[]) {
  const usable = sheets.filter((s) => s.rows.length > 0);
  if (usable.length === 0) return;
  const book = usable.map((s) => {
    const cols = Object.keys(s.rows[0]!);
    const data = [
      cols.map((c) => ({ value: c, fontWeight: "bold" as const })),
      ...s.rows.map((r) => cols.map((c) => {
        const v = r[c];
        if (typeof v === "number") return { value: v, type: Number, format: Number.isInteger(v) ? "#,##0" : "#,##0.00" };
        return { value: v == null ? "" : String(v), type: String };
      })),
    ];
    return { data: data as any, sheet: s.name.slice(0, 31), columns: cols.map((c) => ({ width: Math.max(12, Math.min(40, c.length + 4)) })), stickyRowsCount: 1 };
  });
  await writeXlsxFile(book as any).toFile(filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
