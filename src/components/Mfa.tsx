"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Mark } from "./icons";
import { Field, Message } from "./ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

/** Second step after the password: an authenticator code or a recovery code. Shown instead of the app until it passes. */
export function MfaVerify() {
  const { t } = useI18n(); const { signOut } = useAuthActions(); const verify = useMutation(api.mfa.verify); const { run, busy } = useRun();
  const [code, setCode] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="center"><form className="card auth" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      const r = await run(() => verify({ code }));
      if (r && !r.ok) setMsg(t("locked" in r && r.locked ? "mfa.locked" : "mfa.wrong"));
    }}>
      <Mark /><h1>{t("mfa.verify.title")}</h1><p className="muted">{t("mfa.verify.hint")}</p>
      <Field label={t("mfa.code")}><input autoFocus autoComplete="one-time-code" inputMode="text" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Message error={msg} />
      <button className="btn primary" disabled={busy || !code.trim()}>{t("mfa.verify")}</button>
      <button type="button" className="btn ghost" onClick={() => void signOut()}>{t("signOut")}</button>
    </form></div>
  );
}

/** Enrolment: QR code and key, first code to prove it works, then the one-time recovery codes. */
export function MfaEnroll({ onDone, onStart }: { onDone: () => void; onStart?: () => void }) {
  const { t } = useI18n(); const begin = useMutation(api.mfa.begin); const enable = useMutation(api.mfa.enable); const { run, busy, error } = useRun();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null); const [qr, setQr] = useState(""); const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (setup) void QRCode.toDataURL(setup.uri, { margin: 1, width: 176 }).then(setQr); }, [setup]);
  if (codes) return (
    <div className="stack">
      <h2>{t("mfa.recovery.title")}</h2><p className="muted">{t("mfa.recovery.hint")}</p>
      <ul className="recovery">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      <div className="row"><button className="btn" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>{t("mfa.copy")}</button><button className="btn primary" onClick={onDone}>{t("mfa.done")}</button></div>
    </div>
  );
  if (!setup) return <div><button className="btn primary" disabled={busy} onClick={async () => { const r = await run(() => begin({})); if (r) { setSetup(r); onStart?.(); } }}>{t("mfa.start")}</button></div>;
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      const r = await run(() => enable({ code }));
      if (r?.ok) setCodes(r.recoveryCodes); else if (r) setMsg(t("mfa.wrong"));
    }}>
      <p className="muted">{t("mfa.setup.hint")}</p>
      <div className="row" style={{ alignItems: "center", gap: 16 }}>
        {qr && <img className="qr" src={qr} width={176} height={176} alt={t("mfa.qrAlt")} />}
        <div><span className="caption">{t("mfa.secret")}</span><br /><code className="secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code></div>
      </div>
      <Field label={t("mfa.code")}><input autoComplete="one-time-code" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Message error={msg ?? error} />
      <div><button className="btn primary" disabled={busy || code.replace(/\s/g, "").length < 6}>{t("mfa.enable")}</button></div>
    </form>
  );
}

/** Shown in place of the app when the organisation requires 2FA for the role and it is not set up yet. */
export function MfaRequired() {
  const { t } = useI18n(); const { signOut } = useAuthActions(); const [done, setDone] = useState(false);
  return (
    <div className="center"><div className="card auth wide-auth">
      <Mark /><h1>{t("mfa.setup.title")}</h1>
      {done ? <p className="muted">{t("saved")}</p> : <><p className="muted">{t("mfa.setupRequired")}</p><MfaEnroll onDone={() => setDone(true)} /></>}
      <button type="button" className="btn ghost" onClick={() => void signOut()}>{t("signOut")}</button>
    </div></div>
  );
}
