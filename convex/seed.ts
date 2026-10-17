import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const etb = (n: number) => Math.round(n * 100);
const utc = (y: number, m: number, d = 1) => Date.UTC(y, m - 1, d);

/**
 * Demo data for trying the app: one building, units, renters and active agreements.
 * Staff actions are attributed to a placeholder row that cannot sign in. Remove with seed:clear.
 * Run: npx convex run seed:load
 */
export const load = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    if (await ctx.db.query("buildings").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()) return "skipped: this company already has data (run seed:clear first)";
    const adminMembership = (await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()).find((m) => m.roles.includes("superAdmin"));
    const approver = adminMembership ? await ctx.db.get(adminMembership.userId) : null;
    if (!approver) return "skipped: this company has no administrator yet";

    const staff = await ctx.db.insert("users", { name: "Demo property staff (placeholder)", email: "demo.staff@example.invalid", active: false, lang: "en" });

    const buildingId = await ctx.db.insert("buildings", { orgId, name: "Dire Mall Main Building", address: "Dire Dawa" });
    const floors: Record<string, Id<"floors">> = {};
    for (const label of ["Ground", "1st floor", "2nd floor"]) floors[label] = await ctx.db.insert("floors", { orgId, buildingId, label });

    const spec: [string, string, number, "retail" | "office" | "storage", number][] = [
      ["Ground", "G-01", 150, "retail", 2300], ["Ground", "G-02", 100, "retail", 2300], ["Ground", "G-03", 64.5, "retail", 2500], ["Ground", "G-04", 48, "retail", 2500],
      ["1st floor", "A-101", 150, "office", 1800], ["1st floor", "A-102", 120, "office", 1800], ["1st floor", "A-103", 90, "office", 1900],
      ["2nd floor", "B-201", 200, "office", 1500], ["2nd floor", "B-202", 35, "storage", 900], ["2nd floor", "B-203", 35, "storage", 900],
    ];
    const units: Record<string, Id<"units">> = {};
    for (const [fl, number, areaM2, category, rate] of spec)
      units[number] = await ctx.db.insert("units", { orgId, buildingId, floorId: floors[fl]!, number, areaM2, category, ratePerM2: etb(rate), status: "vacant" });

    const renterRows: [string, "company" | "individual", string, string][] = [
      ["Abebe Trading PLC", "company", "0012345678", "+251911200101"], ["Selam Pharmacy", "company", "0023456789", "+251911200102"],
      ["Hiwot Tailoring", "individual", "", "+251911200103"], ["Dire Coffee House", "company", "0034567890", "+251911200104"],
      ["Mulu Law Office", "company", "0045678901", "+251911200105"], ["Tigist Beauty Salon", "individual", "", "+251911200106"],
    ];
    const renters: Id<"renters">[] = [];
    for (const [name, kind, tin, phone] of renterRows) renters.push(await ctx.db.insert("renters", { orgId, name, kind, ...(tin ? { tin } : {}), phone }));

    const leases: [string, number, number | null][] = [["G-01", 0, null], ["G-02", 1, null], ["G-03", 2, 30000], ["A-101", 4, null], ["A-102", 3, null]];
    const agreementIds: Id<"agreements">[] = [];
    for (const [unit, r, fixed] of leases) {
      const agreementId = await ctx.db.insert("agreements", { orgId, unitId: units[unit]!, renterId: renters[r]!, status: "active", startsAt: utc(2026, 9), endsAt: utc(2027, 9), createdBy: staff, approvedBy: approver._id });
      const u = spec.find((s) => s[1] === unit)!;
      await ctx.db.insert("agreementTerms", { orgId, agreementId, effectiveFrom: utc(2026, 9), rent: fixed ? { kind: "fixed", amount: etb(fixed) } : { kind: "perM2", ratePerM2: etb(u[4]) }, dueDay: 5, depositAmount: etb(50000), createdBy: staff });
      await ctx.db.insert("deposits", { orgId, agreementId, required: etb(50000), held: etb(50000), deductions: [], refunded: 0 });
      await ctx.db.patch(units[unit]!, { status: "occupied" });
      agreementIds.push(agreementId);
    }
    await ctx.db.patch(units["B-202"]!, { status: "maintenance" });

    // electricity meters with two approved readings for the first unit
    const meter = await ctx.db.insert("meters", { orgId, unitId: units["G-01"]!, kind: "electricity", serial: "EL-0001" });
    for (const [value, at] of [[4120, utc(2026, 8, 31)], [4388, utc(2026, 9, 30)]] as const)
      await ctx.db.insert("meterReadings", { orgId, meterId: meter, value, readAt: at, status: "approved", enteredBy: staff, approvedBy: approver._id, isReset: false });

    // A payment recorded by the placeholder staff member: the signed-in approver can confirm it.
    await ctx.db.insert("payments", { orgId, renterId: renters[0]!, amount: etb(200000), method: "transfer", reference: "CBE-FT26257-001", receivedAt: utc(2026, 9, 4), status: "recorded", recordedBy: staff });
    return `loaded: 10 units, 6 renters, 5 active agreements. Next: Bills → choose 2026-09 → Prepare bills.`;
  },
});

/** Remove all demo data (everything except sign-in accounts and settings). */
export const clear = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const tables = ["sharedCostAllocations", "sharedCosts", "meterReadings", "meters", "smsMessages", "bankStatementEntries", "handovers", "renterCredits", "paymentAllocations", "payments", "invoiceAdjustments", "invoiceLines", "invoices", "deposits", "agreementTerms", "agreements", "renterDocuments", "renters", "units", "floors", "buildings", "auditLog"] as const;
    let n = 0;
    for (const t of tables) for (const row of await (ctx.db.query(t as never) as any).withIndex("by_org", (q: any) => q.eq("orgId", orgId)).collect()) { await ctx.db.delete(row._id); n++; }
    for (const u of await ctx.db.query("users").collect()) if (u.email === "demo.staff@example.invalid") await ctx.db.delete(u._id);
    return `removed ${n} rows`;
  },
});
