import { describe, expect, it } from "vitest";
import { etb, storePdf, utc, world } from "./helpers";

async function withSignedAgreement() {
  const w = await world();
  const unitId = await w.unit("S-1", 50), renterId = await w.renter("R");
  const agreementId = await w.pm.mutation(w.api.agreements.createDraft, { unitId, renterId, startsAt: utc(2026, 9), endsAt: utc(2027, 9), rent: { kind: "fixed", amount: etb(1000) }, dueDay: 5, depositAmount: 0 });
  const fileId = await w.t.run((c) => storePdf(c as never));
  await w.pm.mutation(w.api.agreements.attachSignedCopy, { agreementId, fileId });
  return { ...w, agreementId };
}

describe("document downloads", () => {
  it("a permitted user gets a link that serves the file, and nothing else does", async () => {
    const w = await withSignedAgreement();
    const { token } = await w.fin.mutation(w.api.files.ticket, { kind: "signed", id: w.agreementId });
    const ok = await w.t.fetch(`/files/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toContain("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await w.t.fetch(`/files/${"a".repeat(64)}`)).status).toBe(410); // well-formed but unknown
    expect((await w.t.fetch(`/files/not-a-token`)).status).toBe(404);
  });

  it("links expire, and die with a deactivated account", async () => {
    const w = await withSignedAgreement();
    const { token } = await w.fin.mutation(w.api.files.ticket, { kind: "signed", id: w.agreementId });
    await w.t.run(async (c) => { const t = (await c.db.query("fileTickets").collect())[0]!; await c.db.patch(t._id, { expiresAt: Date.now() - 1 }); });
    expect((await w.t.fetch(`/files/${token}`)).status).toBe(410);
    const again = await w.fin.mutation(w.api.files.ticket, { kind: "signed", id: w.agreementId });
    await w.t.run((c) => c.db.patch(w.finId, { active: false }));
    expect((await w.t.fetch(`/files/${again.token}`)).status).toBe(410);
  });

  it("is refused outside the user's buildings, for records without a file, and for signed-out callers", async () => {
    const w = await withSignedAgreement();
    const other = await w.t.run((c) => c.db.insert("buildings", { orgId: w.orgId, name: "Other" }));
    const limitedId = await w.mk("limited", ["propertyManager"], [other]);
    await expect(w.as(limitedId).mutation(w.api.files.ticket, { kind: "signed", id: w.agreementId })).rejects.toThrow(/forbidden/);
    const noFile = await w.t.run(async (c) => { const a = await c.db.get(w.agreementId); const { _id, _creationTime, signedFileId, ...rest } = a!; void signedFileId; return c.db.insert("agreements", rest as never); });
    await expect(w.pm.mutation(w.api.files.ticket, { kind: "signed", id: noFile })).rejects.toThrow(/not_found/);
    await expect(w.t.mutation(w.api.files.ticket, { kind: "signed", id: w.agreementId })).rejects.toThrow(/unauthenticated/);
  });
});
