// Writes docs/amharic-review.xlsx: every on-screen term with its English text and the current Amharic draft,
// plus empty columns for the reviewer. Run: node scripts/export-translations.mjs
import writeXlsxFile from "write-excel-file/node";
import { EN, AM } from "../src/lib/dictionary.ts";

const area = (k) => {
  const p = k.split(".")[0];
  const map = { nav: "Menu", dash: "Overview", att: "Overview", prop: "Buildings & units", renter: "Renters", ag: "Agreements", bill: "Bills", pay: "Payments", util: "Utilities", rep: "Reports", bank: "Bank", sms: "SMS", users: "Staff access", err: "Error messages", v: "Form checks", imp: "Import", confirm: "Confirmations", empty: "Empty screens", receipt: "Receipt", contract: "Lease contract", me: "Month-end pack", dep: "Deposit", first: "Setup guide", theme: "Theme", pw: "Sign in", nf: "Page not found" };
  return map[p] ?? "General";
};
const head = (v) => ({ value: v, fontWeight: "bold" });
const rows = Object.keys(EN).sort((a, b) => area(a).localeCompare(area(b)) || a.localeCompare(b)).map((k) => [
  { value: area(k), type: String }, { value: k, type: String }, { value: EN[k], type: String },
  { value: AM[k] ?? "", type: String }, { value: AM[k] ? "" : "MISSING: shows English", type: String }, { value: "", type: String }, { value: "", type: String },
]);
const data = [["Screen", "Key", "English", "Amharic (draft)", "Status", "Reviewer's Amharic", "Notes"].map(head), ...rows];
await writeXlsxFile([{ data, sheet: "Amharic review", columns: [{ width: 20 }, { width: 24 }, { width: 55 }, { width: 55 }, { width: 22 }, { width: 55 }, { width: 30 }], stickyRowsCount: 1 }]).toFile("docs/amharic-review.xlsx");
console.log(`${rows.length} terms, ${rows.filter((r) => r[4].value).length} without Amharic`);
