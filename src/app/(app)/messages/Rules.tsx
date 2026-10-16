"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Card, Field, Message, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { isPhone } from "../../../../convex/lib/validate";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** When messages go out, how the overdue chasing escalates, and a button to prove the gateway works. */
export function RulesTab() {
  const { t } = useI18n(); const { can } = useMe(); const toast = useToast();
  const rules = useQuery(api.smsQueue.rules); const gw = useQuery(api.smsQueue.gateway);
  const save = useMutation(api.smsQueue.saveRules); const test = useMutation(api.smsQueue.sendTest); const { run, error, busy } = useRun(); const testRun = useRun();
  const [f, setF] = useState<{ before: string; o1: string; o2: string; o3: string; qs: number; qe: number; cap: string; receipts: boolean; issued: boolean } | null>(null);
  const [phone, setPhone] = useState(""); const [lang, setLang] = useState<"en" | "am">("en"); const [phoneErr, setPhoneErr] = useState<string | null>(null);
  useEffect(() => { if (rules && !f) setF({ before: String(rules.before), o1: String(rules.overdue1), o2: String(rules.overdue2), o3: String(rules.overdue3), qs: rules.quietStart, qe: rules.quietEnd, cap: String(rules.dailyCap), receipts: rules.receipts, issued: rules.issued }); }, [rules, f]);
  if (!rules || !f) return <Card><Skeleton lines={5} /></Card>;
  const edit = can("approver");
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const steps = [f.o1, f.o2, f.o3].map(num).filter((n) => n > 0);
  const problem = [num(f.before), num(f.o1), num(f.o2), num(f.o3), num(f.cap)].some((n) => !Number.isInteger(n) || n < 0) ? t("sms.rulesWholeNumbers") : new Set(steps).size !== steps.length ? t("err.overdue_days_must_differ") : null;
  const quiet = f.qs === f.qe ? t("sms.quietNone") : t("sms.quietSummary").replace("{a}", hourLabel(f.qs)).replace("{b}", hourLabel(f.qe));
  return (
    <div className="stack">
      <Card title={t("sms.gateway")}>
        <div className="stack">
          <p className={`msg ${gw?.configured ? "good" : "info"}`} role="status"><Icon name={gw?.configured ? "check" : "alert"} size={16} />{gw?.configured ? t("sms.gatewayOn").replace("{s}", gw.sender) : t("sms.noGateway")}</p>
          <form className="row test-send" onSubmit={async (e) => {
            e.preventDefault(); setPhoneErr(null);
            if (!isPhone(phone)) { setPhoneErr(t("v.phone")); return; }
            const r = await testRun.run(() => test({ phone, lang }), t("sms.testQueued"));
            if (r) toast(t("sms.testHint"));
          }}>
            <input aria-label={t("sms.testPhone")} placeholder={t("sms.testPhone")} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <select aria-label={t("language")} value={lang} onChange={(e) => setLang(e.target.value as "en" | "am")}><option value="en">English</option><option value="am">አማርኛ</option></select>
            <button className="btn" disabled={!can("financeOfficer", "approver") || testRun.busy}>{t("sms.sendTest")}</button>
          </form>
          <Message error={phoneErr ?? testRun.error} />
        </div>
      </Card>
      <Card title={t("sms.schedule")}>
        <form className="form rules-form" noValidate onSubmit={async (e) => {
          e.preventDefault(); if (problem) return;
          await run(() => save({ before: num(f.before), overdue1: num(f.o1), overdue2: num(f.o2), overdue3: num(f.o3), quietStart: f.qs, quietEnd: f.qe, dailyCap: num(f.cap), receipts: f.receipts, issued: f.issued }), t("saved"));
        }}>
          <p className="muted wide">{t("sms.scheduleHint")}</p>
          <Field label={t("sms.before")} hint={t("sms.beforeHint")}><input inputMode="numeric" value={f.before} disabled={!edit} onChange={(e) => set({ before: e.target.value })} /></Field>
          <div className="wide"><span className="caption">{t("sms.overdueSteps")}</span><div className="row steps">
            {([["o1", f.o1], ["o2", f.o2], ["o3", f.o3]] as const).map(([k, v], i) => <label key={k} className="field step"><span>{t("sms.step").replace("{n}", String(i + 1))}</span><input inputMode="numeric" value={v} disabled={!edit} onChange={(e) => set({ [k]: e.target.value } as Partial<typeof f>)} /><small>{t("sms.daysLate")}</small></label>)}
          </div><small className="muted">{t("sms.stepsHint")}</small></div>
          <Field label={t("sms.quietFrom")} hint={quiet}><select value={f.qs} disabled={!edit} onChange={(e) => set({ qs: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></Field>
          <Field label={t("sms.quietTo")}><select value={f.qe} disabled={!edit} onChange={(e) => set({ qe: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></Field>
          <Field label={t("sms.dailyCap")} hint={t("sms.dailyCapHint")}><input inputMode="numeric" value={f.cap} disabled={!edit} onChange={(e) => set({ cap: e.target.value })} /></Field>
          <div className="wide stack">
            <label className="row"><input type="checkbox" checked={f.receipts} disabled={!edit} onChange={(e) => set({ receipts: e.target.checked })} />{t("sms.optReceipts")}</label>
            <label className="row"><input type="checkbox" checked={f.issued} disabled={!edit} onChange={(e) => set({ issued: e.target.checked })} />{t("sms.optIssued")}</label>
          </div>
          <div className="wide"><Message error={problem ?? error} />{edit ? <button className="btn primary" disabled={busy || !!problem}>{t("save")}</button> : <p className="muted">{t("sms.rulesApprover")}</p>}</div>
        </form>
      </Card>
    </div>
  );
}
