import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { sha256Hex } from "./lib/totp";

/**
 * A fingerprint of the business data: row counts per table and the money totals that matter.
 * Take one before a backup and one after a restore; if they match, nothing was lost or changed.
 *   npx convex run backup:fingerprint
 * Sessions and sign-in tokens are left out on purpose: they are expected to differ after a restore.
 */
const TABLES = [
  "users", "buildings", "floors", "units", "renters", "renterDocuments", "agreements", "agreementTerms",
  "invoices", "invoiceLines", "invoiceAdjustments", "payments", "paymentAllocations", "renterCredits", "deposits",
  "meters", "meterReadings", "sharedCosts", "sharedCostAllocations", "handovers", "settings", "bankStatementEntries",
  "smsMessages", "auditLog", "mfaSecrets",
] as const;

// money columns to add up, as "table.field" (payments are also split by status)
const SUMS: Record<string, string[]> = {
  invoices: ["total", "adjustments", "paid", "creditUsed", "due"],
  payments: ["amount"],
  paymentAllocations: ["amount"],
  renterCredits: ["amount"],
  deposits: ["required", "held", "refunded"],
  bankStatementEntries: ["amount"],
};

export const page = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const r = await ctx.db.query(table as "invoices").paginate({ numItems: 1500, cursor });
    const sums: Record<string, number> = {};
    for (const row of r.page as unknown as Record<string, unknown>[]) {
      for (const f of SUMS[table] ?? []) {
        const n = typeof row[f] === "number" ? (row[f] as number) : 0;
        sums[f] = (sums[f] ?? 0) + n;
        if (table === "payments") { const k = `amount.${String(row.status)}`; sums[k] = (sums[k] ?? 0) + n; }
      }
    }
    return { count: r.page.length, sums, next: r.isDone ? null : r.continueCursor };
  },
});

export const fingerprint = internalAction({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    const totals: Record<string, number> = {};
    for (const table of TABLES) {
      let cursor: string | null = null;
      counts[table] = 0;
      do {
        const r: { count: number; sums: Record<string, number>; next: string | null } = await ctx.runQuery(internal.backup.page, { table, cursor });
        counts[table]! += r.count;
        for (const [k, n] of Object.entries(r.sums)) totals[`${table}.${k}`] = (totals[`${table}.${k}`] ?? 0) + n;
        cursor = r.next;
      } while (cursor);
    }
    const body = JSON.stringify({ counts, totals });
    return { counts, totals, hash: await sha256Hex(body) };
  },
});
