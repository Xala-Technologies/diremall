import { describe, expect, it } from "vitest";
import { base32Encode, hotp, verifyTotp } from "../convex/lib/totp";
import { world } from "./helpers";

const code = async (secret: string, offset = 0) => hotp(secret, Math.floor(Date.now() / 1000 / 30) + offset);

describe("totp", () => {
  it("matches the RFC 6238 test vector", async () => {
    const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
    expect(await hotp(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(await verifyTotp(secret, "287082", 59_000)).toBe(1);
    expect(await verifyTotp(secret, "000000", 59_000)).toBeNull();
    expect(await verifyTotp(secret, "abc", 59_000)).toBeNull();
  });
});

describe("two-step sign-in", () => {
  it("is off until enrolled, then every new sign-in must verify", async () => {
    const { t, api, finId } = await world();
    const sign = (id: typeof finId, session: string) => t.withIdentity({ subject: `${id}|${session}` });
    const a = sign(finId, "s1");
    expect((await a.query(api.users.me, {}))?.mfa).toBe("ok");

    const { secret } = await a.mutation(api.mfa.begin, {});
    expect((await a.mutation(api.mfa.enable, { code: "000000" })).ok).toBe(false);
    const done = await a.mutation(api.mfa.enable, { code: await code(secret) });
    expect(done.ok).toBe(true);
    expect(done.ok && done.recoveryCodes.length).toBe(8);
    expect((await a.query(api.users.me, {}))?.mfa).toBe("ok"); // the session that enrolled is verified

    const b = sign(finId, "s2"); // a later sign-in
    expect((await b.query(api.users.me, {}))?.mfa).toBe("verify");
    await expect(b.query(api.payments.list, {})).rejects.toThrow(/mfa_required/);
    expect((await b.mutation(api.mfa.verify, { code: "123456" })).ok).toBe(false);
    expect((await b.mutation(api.mfa.verify, { code: await code(secret, 1) })).ok).toBe(true); // a newer step than the one used to enrol
    expect((await b.query(api.users.me, {}))?.mfa).toBe("ok");
    await expect(b.query(api.payments.list, {})).resolves.toBeDefined();
  });

  it("accepts a code once, a recovery code once, and locks after five misses", async () => {
    const { t, api, finId } = await world();
    const sign = (session: string) => t.withIdentity({ subject: `${finId}|${session}` });
    const a = sign("s1");
    const { secret } = await a.mutation(api.mfa.begin, {});
    const done = await a.mutation(api.mfa.enable, { code: await code(secret) });
    const recovery = done.ok ? done.recoveryCodes[0]! : "";

    // the code that enrolled cannot be replayed on another sign-in
    expect((await sign("s2").mutation(api.mfa.verify, { code: await code(secret) })).ok).toBe(false);
    // a recovery code works once
    expect((await sign("s3").mutation(api.mfa.verify, { code: recovery })).ok).toBe(true);
    expect((await sign("s4").mutation(api.mfa.verify, { code: recovery })).ok).toBe(false);
    // five misses lock the account for a while, even for a right code
    const s5 = sign("s5");
    for (let i = 0; i < 5; i++) await s5.mutation(api.mfa.verify, { code: "111111" });
    const locked = await s5.mutation(api.mfa.verify, { code: await code(secret, 1) });
    expect(locked).toMatchObject({ ok: false, locked: true });
  });

  it("can be required for privileged roles, and an access admin can reset someone", async () => {
    const { t, api, mk, as, finId, pmId } = await world();
    const adminId = await mk("admin", ["superAdmin"]);
    const admin = as(adminId);
    await expect(admin.mutation(api.settings.set, { key: "mfa.required", value: 1 })).rejects.toThrow(/mfa_enroll_first/);
    const { secret } = await admin.mutation(api.mfa.begin, {});
    await admin.mutation(api.mfa.enable, { code: await code(secret) });
    await admin.mutation(api.settings.set, { key: "mfa.required", value: 1 });

    expect((await as(finId).query(api.users.me, {}))?.mfa).toBe("setup"); // finance must enrol
    await expect(as(finId).query(api.payments.list, {})).rejects.toThrow(/mfa_setup_required/);
    expect((await as(pmId).query(api.users.me, {}))?.mfa).toBe("ok"); // property staff are not in the privileged set

    // finance enrols, then loses the phone
    const f = t.withIdentity({ subject: `${finId}|f1` });
    const s = await f.mutation(api.mfa.begin, {});
    await f.mutation(api.mfa.enable, { code: await code(s.secret) });
    await expect(f.mutation(api.mfa.disable, { code: await code(s.secret) })).rejects.toThrow(/mfa_required_for_role/);
    await expect(f.mutation(api.mfa.reset, { userId: finId })).rejects.toThrow(/forbidden/);
    await admin.mutation(api.mfa.reset, { userId: finId });
    expect((await t.withIdentity({ subject: `${finId}|f2` }).query(api.users.me, {}))?.mfa).toBe("setup");
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["mfa.enable", "mfa.reset"]));
  });
});
