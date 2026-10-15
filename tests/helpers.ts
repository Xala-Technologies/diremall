import { convexTest } from "convex-test";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

export const modules = import.meta.glob("../convex/**/*.ts");
/** Stores a small PDF. convex-test does not record the content type the way Convex does, so it is set here. */
export async function storePdf(ctx: { storage: { store: (b: Blob) => Promise<never> }; db: unknown }, type = "application/pdf") {
  const id = await ctx.storage.store(new Blob(["s"], { type }));
  await (ctx.db as { patch: (id: unknown, v: object) => Promise<void> }).patch(id, { contentType: type });
  return id as never;
}
export const etb = (n: number) => Math.round(n * 100);
export const utc = (y: number, m: number, d = 1) => Date.UTC(y, m - 1, d);

type Role = "superAdmin" | "propertyManager" | "financeOfficer" | "approver" | "auditor" | "accessAdmin";

export async function world() {
  const t = convexTest(schema, modules);
  const mk = (name: string, roles: Role[], scope: "all" | Id<"buildings">[] = "all") =>
    t.run((ctx) => ctx.db.insert("users", { name, email: `${name}@x.et`, roles, buildingScope: scope, active: true, lang: "en" }));
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|session` });

  const pmId = await mk("pm", ["propertyManager"]);
  const finId = await mk("fin", ["financeOfficer"]);
  const apId = await mk("ap", ["approver"]);
  const pm = as(pmId), fin = as(finId), ap = as(apId);

  const api = (await import("../convex/_generated/api")).api;
  const buildingId = await pm.mutation(api.properties.createBuilding, { name: "Dire Mall" });
  const floorId = await pm.mutation(api.properties.addFloor, { buildingId, label: "Ground" });
  const unit = (number: string, areaM2: number) => pm.mutation(api.properties.createUnit, { buildingId, floorId, number, areaM2, category: "retail", ratePerM2: etb(2300) });
  const renter = (name: string) => pm.mutation(api.renters.create, { kind: "company", name, tin: "0012345", phone: "+251911000000" });

  /** Draft → signed → review → approved agreement running Sep 2026 – Aug 2027. */
  async function activeAgreement(unitId: Id<"units">, renterId: Id<"renters">, rent: { kind: "perM2"; ratePerM2: number } | { kind: "fixed"; amount: number } = { kind: "perM2", ratePerM2: etb(2300) }) {
    const agreementId = await pm.mutation(api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 9), endsAt: utc(2027, 9), rent, dueDay: 5, depositAmount: etb(50000) });
    const fileId = await t.run((ctx) => storePdf(ctx as never));
    await pm.mutation(api.agreements.attachSignedCopy, { agreementId, fileId });
    await pm.mutation(api.agreements.submitForReview, { agreementId });
    await ap.mutation(api.agreements.approve, { agreementId });
    return agreementId;
  }
  return { t, api, mk, as, pm, fin, ap, pmId, finId, apId, buildingId, floorId, unit, renter, activeAgreement };
}
