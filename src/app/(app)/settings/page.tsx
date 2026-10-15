"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { MfaEnroll } from "@/components/Mfa";
import { Card, Field, Message, MoneyInput, PageHeader } from "@/components/ui";
import { useMe } from "@/lib/useMe";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";
import { email as emailCheck, failures, phone as phoneCheck, req, tin as tinCheck } from "@/lib/validate";

export default function Settings() {
  const { t } = useI18n(); const s = useQuery(api.settings.get); const set = useMutation(api.settings.set); const { run, error, notice } = useRun();
  const { can } = useMe(); const mfa = useQuery(api.mfa.status); const disable = useMutation(api.mfa.disable);
  const [enrolling, setEnrolling] = useState(false); const [offCode, setOffCode] = useState(""); const [offMsg, setOffMsg] = useState<string | null>(null);
  const [el, setEl] = useState<number | null>(null); const [wa, setWa] = useState<number | null>(null); const [due, setDue] = useState(""); const [exp, setExp] = useState("");
  return (
    <div className="stack"><PageHeader title={t("nav.settings")} /><Message error={error} notice={notice} />
      <OrgCard />
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

/** The seller's details, printed on every bill, receipt and contract. Approvers edit them; everyone else reads. */
function OrgCard() {
  const { t } = useI18n(); const { can } = useMe(); const org = useQuery(api.settings.org); const save = useMutation(api.settings.setOrg); const { run, error, busy } = useRun();
  const [f, setF] = useState({ name: "", tin: "", vatNumber: "", address: "", city: "", phone: "", email: "", bankAccounts: "", invoiceNote: "" });
  const [loaded, setLoaded] = useState(false); const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!org || loaded) return;
    const o = org as unknown as Record<string, string | undefined>;
    setF({ name: o.name ?? "", tin: o.tin ?? "", vatNumber: o.vatNumber ?? "", address: o.address ?? "", city: o.city ?? "", phone: o.phone ?? "", email: o.email ?? "", bankAccounts: o.bankAccounts ?? "", invoiceNote: o.invoiceNote ?? "" });
    setLoaded(true);
  }, [org, loaded]);
  const edit = can("approver");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: "" }); };
  return (
    <Card title={t("org.title")}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ name: req(f.name, t), tin: f.tin.trim() ? tinCheck(f.tin, t) : null, phone: f.phone.trim() ? phoneCheck(f.phone, t) : null, email: emailCheck(f.email, t), vatNumber: f.vatNumber.trim() && !/^\d{6,15}$/.test(f.vatNumber.replace(/\s/g, "")) ? t("v.vat") : null });
        setErrs(found); if (Object.keys(found).length) return;
        await run(() => save(f), t("saved"));
      }}>
        <p className="muted wide">{t("org.hint")}</p>
        <Field label={t("org.name")} error={errs.name}><input value={f.name} disabled={!edit} onChange={set("name")} /></Field>
        <Field label={t("renter.tin")} error={errs.tin} hint={t("optional")}><input inputMode="numeric" value={f.tin} disabled={!edit} onChange={set("tin")} /></Field>
        <Field label={t("renter.vat")} error={errs.vatNumber} hint={t("optional")}><input inputMode="numeric" value={f.vatNumber} disabled={!edit} onChange={set("vatNumber")} /></Field>
        <Field label={t("renter.phone")} error={errs.phone} hint={t("optional")}><input type="tel" value={f.phone} disabled={!edit} onChange={set("phone")} /></Field>
        <Field label={t("email")} error={errs.email} hint={t("optional")}><input type="email" value={f.email} disabled={!edit} onChange={set("email")} /></Field>
        <Field label={t("prop.city")} hint={t("optional")}><input value={f.city} disabled={!edit} onChange={set("city")} /></Field>
        <div className="wide"><Field label={t("renter.address")} hint={t("optional")}><input value={f.address} disabled={!edit} onChange={set("address")} /></Field></div>
        <div className="wide"><Field label={t("org.bank")} hint={t("org.bankHint")}><textarea rows={3} value={f.bankAccounts} disabled={!edit} onChange={set("bankAccounts")} placeholder={"Commercial Bank of Ethiopia 1000123456789 Dire Mall PLC"} /></Field></div>
        <div className="wide"><Field label={t("org.note")} hint={t("org.noteHint")}><textarea rows={2} value={f.invoiceNote} disabled={!edit} onChange={set("invoiceNote")} /></Field></div>
        {edit && <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("save")}</button></div>}
      </form>
    </Card>
  );
}
