"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { MfaEnroll } from "@/components/Mfa";
import { Card, Field, Message, MoneyInput, PageHeader } from "@/components/ui";
import { useMe } from "@/lib/useMe";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

export default function Settings() {
  const { t } = useI18n(); const s = useQuery(api.settings.get); const set = useMutation(api.settings.set); const { run, error, notice } = useRun();
  const { can } = useMe(); const mfa = useQuery(api.mfa.status); const disable = useMutation(api.mfa.disable);
  const [enrolling, setEnrolling] = useState(false); const [offCode, setOffCode] = useState(""); const [offMsg, setOffMsg] = useState<string | null>(null);
  const [el, setEl] = useState<number | null>(null); const [wa, setWa] = useState<number | null>(null); const [due, setDue] = useState(""); const [exp, setExp] = useState("");
  return (
    <div className="stack"><PageHeader title={t("nav.settings")} /><Message error={error} notice={notice} />
      <Card title={t("mfa.title")}><div className="stack">
        {mfa && <div className="row"><strong>{mfa.enabled ? t("mfa.on") : t("mfa.off")}</strong>{mfa.enabled && <span className="muted">{t("mfa.recoveryLeft")}: {mfa.recoveryLeft}</span>}</div>}
        {mfa && (!mfa.enabled || enrolling) && <MfaEnroll onStart={() => setEnrolling(true)} onDone={() => setEnrolling(false)} />}
        {mfa?.enabled && !mfa.required && <form className="row" onSubmit={async (e) => { e.preventDefault(); setOffMsg(null); const r = await run(() => disable({ code: offCode }), t("saved")); if (r && !r.ok) setOffMsg(t("mfa.wrong")); else setOffCode(""); }}>
          <input aria-label={t("mfa.code")} placeholder={t("mfa.code")} autoComplete="one-time-code" inputMode="numeric" value={offCode} onChange={(e) => setOffCode(e.target.value)} />
          <button className="btn" disabled={offCode.replace(/\s/g, "").length < 6}>{t("mfa.disable")}</button></form>}
        {offMsg && <Message error={offMsg} />}
        {can("accessAdmin") && s && <label className="row"><input type="checkbox" checked={s["mfa.required"] === 1} disabled={!mfa?.enabled && s["mfa.required"] !== 1} onChange={(e) => void run(() => set({ key: "mfa.required", value: e.target.checked ? 1 : 0 }), t("saved"))} />
          <span>{t("mfa.requiredLabel")}<br /><small className="muted">{t("mfa.requiredHint")}</small></span></label>}
      </div></Card>
      <Card title={t("tariffs")}><div className="form">
        <Field label={`${t("electricity")} / kWh (ETB)`} hint={s ? `Now: ${((s["tariff.electricity"] ?? 600) / 100).toFixed(2)}` : ""}><MoneyInput value={el} onChange={setEl} /></Field>
        <Field label={`${t("water")} / m³ (ETB)`} hint={s ? `Now: ${((s["tariff.water"] ?? 0) / 100).toFixed(2)}` : ""}><MoneyInput value={wa} onChange={setWa} /></Field>
        <div className="wide"><button className="btn primary" onClick={() => void run(async () => { if (el != null) await set({ key: "tariff.electricity", value: el }); if (wa != null) await set({ key: "tariff.water", value: wa }); }, t("saved"))}>{t("save")}</button></div></div></Card>
      <Card title="SMS"><div className="form">
        <Field label="Days before due date to remind" hint={`Now: ${s?.dueReminderDays ?? 3}`}><input type="number" min={0} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Days before agreement end to warn" hint={`Now: ${s?.expiryWarnDays ?? 60}`}><input type="number" min={0} value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
        <div className="wide"><button className="btn primary" onClick={() => void run(async () => { if (due !== "") await set({ key: "dueReminderDays", value: Number(due) }); if (exp !== "") await set({ key: "expiryWarnDays", value: Number(exp) }); }, t("saved"))}>{t("save")}</button></div></div></Card>
    </div>
  );
}
