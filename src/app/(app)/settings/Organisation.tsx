"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Card, Field, Message, Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { email as emailCheck, failures, phone as phoneCheck, req, tin as tinCheck } from "@/lib/validate";

type F = { name: string; tin: string; vatNumber: string; address: string; city: string; phone: string; email: string; bankAccounts: string; invoiceNote: string };
const EMPTY: F = { name: "", tin: "", vatNumber: "", address: "", city: "", phone: "", email: "", bankAccounts: "", invoiceNote: "" };

/** The seller's legal details, printed on every bill, receipt and contract, with a preview of how they print. */
export function Organisation() {
  const { t } = useI18n(); const { can } = useMe(); const org = useQuery(api.settings.org); const save = useMutation(api.settings.setOrg); const { run, error, busy } = useRun();
  const [f, setF] = useState<F>(EMPTY); const [loaded, setLoaded] = useState(false); const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!org || loaded) return;
    const o = org as unknown as Partial<F>;
    setF({ name: o.name ?? "", tin: o.tin ?? "", vatNumber: o.vatNumber ?? "", address: o.address ?? "", city: o.city ?? "", phone: o.phone ?? "", email: o.email ?? "", bankAccounts: o.bankAccounts ?? "", invoiceNote: o.invoiceNote ?? "" });
    setLoaded(true);
  }, [org, loaded]);
  if (!org) return <Card><Skeleton lines={6} /></Card>;
  const edit = can("approver");
  const set = (k: keyof F) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: "" }); };
  const banks = f.bankAccounts.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <form noValidate className="stack" onSubmit={async (e) => {
      e.preventDefault();
      const found = failures({ name: req(f.name, t), tin: f.tin.trim() ? tinCheck(f.tin, t) : null, phone: f.phone.trim() ? phoneCheck(f.phone, t) : null, email: emailCheck(f.email, t), vatNumber: f.vatNumber.trim() && !/^\d{6,15}$/.test(f.vatNumber.replace(/\s/g, "")) ? t("v.vat") : null });
      setErrs(found); if (Object.keys(found).length) return;
      await run(() => save(f), t("saved"));
    }}>
      <p className="muted">{t("org.hint")}{!edit && ` ${t("set.approverOnly")}`}</p>
      <div className="sms-split">
        <div className="stack">
          <Card title={t("set.company")}>
            <div className="form">
              <div className="wide"><Field label={t("org.name")} error={errs.name}><input value={f.name} disabled={!edit} onChange={set("name")} /></Field></div>
              <Field label={t("renter.tin")} error={errs.tin} hint={t("set.tinHint")}><input inputMode="numeric" value={f.tin} disabled={!edit} onChange={set("tin")} placeholder="0012345678" /></Field>
              <Field label={t("renter.vat")} error={errs.vatNumber} hint={t("optional")}><input inputMode="numeric" value={f.vatNumber} disabled={!edit} onChange={set("vatNumber")} /></Field>
            </div>
          </Card>
          <Card title={t("set.contact")}>
            <div className="form">
              <Field label={t("renter.phone")} error={errs.phone}><input type="tel" value={f.phone} disabled={!edit} onChange={set("phone")} placeholder="0911 20 01 01" /></Field>
              <Field label={t("email")} error={errs.email}><input type="email" value={f.email} disabled={!edit} onChange={set("email")} /></Field>
              <Field label={t("prop.city")}><input value={f.city} disabled={!edit} onChange={set("city")} /></Field>
              <Field label={t("renter.address")}><input value={f.address} disabled={!edit} onChange={set("address")} /></Field>
            </div>
          </Card>
          <Card title={t("set.printed")}>
            <div className="form">
              <div className="wide"><Field label={t("org.bank")} hint={t("org.bankHint")}><textarea rows={3} value={f.bankAccounts} disabled={!edit} onChange={set("bankAccounts")} placeholder="Commercial Bank of Ethiopia 1000123456789 Your Company PLC" /></Field></div>
              <div className="wide"><Field label={t("org.note")} hint={t("org.noteHint")}><textarea rows={2} value={f.invoiceNote} disabled={!edit} onChange={set("invoiceNote")} /></Field></div>
            </div>
          </Card>
          {edit && <div className="row"><button className="btn primary" disabled={busy}>{t("save")}</button><Message error={error} /></div>}
        </div>
        <aside className="sms-side" aria-label={t("set.preview")}>
          <span className="caption">{t("set.preview")}</span>
          <div className="paper">
            <div className="paper-head"><b>{f.name || "—"}</b>{f.address || f.city ? <span>{[f.address, f.city].filter(Boolean).join(", ")}</span> : null}{f.phone || f.email ? <span>{[f.phone, f.email].filter(Boolean).join(" · ")}</span> : null}{f.tin || f.vatNumber ? <span>{[f.tin && `TIN ${f.tin}`, f.vatNumber && `VAT ${f.vatNumber}`].filter(Boolean).join(" · ")}</span> : null}</div>
            <div className="paper-body"><i /><i /><i className="short" /></div>
            {banks.length > 0 && <div className="paper-foot"><small>{t("set.payTo")}</small>{banks.map((b) => <span key={b}>{b}</span>)}</div>}
            {f.invoiceNote.trim() && <div className="paper-note">{f.invoiceNote}</div>}
          </div>
        </aside>
      </div>
    </form>
  );
}
