"use client";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Card, Field, Message, MoneyInput } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

/** Utility tariffs used when meter readings become bills, and the lease-expiry warning. */
export function Billing() {
  const { t } = useI18n(); const { can } = useMe(); const s = useQuery(api.settings.get); const set = useMutation(api.settings.set); const { run, error, busy } = useRun();
  const [el, setEl] = useState<number | null>(null); const [wa, setWa] = useState<number | null>(null); const [exp, setExp] = useState("");
  const edit = can("approver"); const now = (k: string, d: number) => ((s?.[k] ?? d) / 100).toFixed(2);
  const expNow = s?.expiryWarnDays ?? 60;
  const bad = exp !== "" && (!Number.isInteger(Number(exp)) || Number(exp) < 0 || Number(exp) > 365);
  return (
    <div className="stack">
      <Message error={error} />
      <Card title={t("tariffs")}>
        <div className="form">
          <p className="muted wide">{t("set.tariffHint")}</p>
          <Field label={`${t("electricity")} / kWh (ETB)`} hint={`${t("set.current")}: ${now("tariff.electricity", 600)}`}><MoneyInput value={el} onChange={setEl} /></Field>
          <Field label={`${t("water")} / m³ (ETB)`} hint={`${t("set.current")}: ${now("tariff.water", 0)}`}><MoneyInput value={wa} onChange={setWa} /></Field>
          {edit && <div className="wide"><button className="btn primary" disabled={busy || (el == null && wa == null)} onClick={() => void run(async () => { if (el != null) await set({ key: "tariff.electricity", value: el }); if (wa != null) await set({ key: "tariff.water", value: wa }); setEl(null); setWa(null); }, t("saved"))}>{t("save")}</button></div>}
        </div>
      </Card>
      <Card title={t("set.leaseTitle")}>
        <div className="form">
          <p className="muted wide">{t("set.leaseHint")}</p>
          <Field label={t("set.expiryWarn")} hint={`${t("set.current")}: ${expNow}`} error={bad ? t("sms.rulesWholeNumbers") : undefined}><input inputMode="numeric" value={exp} placeholder={String(expNow)} disabled={!edit} onChange={(e) => setExp(e.target.value)} /></Field>
          {edit && <div className="wide"><button className="btn primary" disabled={busy || exp === "" || bad} onClick={() => void run(async () => { await set({ key: "expiryWarnDays", value: Number(exp) }); setExp(""); }, t("saved"))}>{t("save")}</button></div>}
        </div>
      </Card>
      <Card title={t("set.remindersTitle")}><p className="muted">{t("set.remindersHint")}</p><Link className="btn" href="/messages">{t("set.openSms")}</Link></Card>
      {!edit && <p className="muted">{t("set.approverOnly")}</p>}
    </div>
  );
}
