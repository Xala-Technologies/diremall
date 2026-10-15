"use client";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, ConfirmDialog, DateField, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, ReasonDialog, StatusBadge, Table } from "@/components/ui";
import { monthlyRent } from "../../../../../convex/lib/billing";
import { Icon } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useOpenFile } from "@/lib/useOpenFile";
import { useRun } from "@/lib/useRun";
import { useUpload } from "@/lib/useUpload";
import { failures, inRange, positive, req } from "@/lib/validate";

export default function AgreementPage() {
  const { id } = useParams<{ id: string }>(); const agreementId = id as Id<"agreements">;
  const { t } = useI18n(); const { can, me } = useMe();
  const d = useQuery(api.agreements.get, { agreementId });
  const dep = useQuery(api.deposits.get, d?.agreement.status === "active" ? { agreementId } : "skip");
  const attach = useMutation(api.agreements.attachSignedCopy); const submit = useMutation(api.agreements.submitForReview);
  const approve = useMutation(api.agreements.approve); const back = useMutation(api.agreements.returnForCorrection);
  const terminate = useMutation(api.agreements.terminate); const handover = useMutation(api.agreements.recordHandover);
  const receive = useMutation(api.deposits.receive); const refund = useMutation(api.deposits.refund);
  const reqDed = useMutation(api.deposits.requestDeduction); const appDed = useMutation(api.deposits.approveDeduction);
  const upload = useUpload(); const openFile = useOpenFile(); const { run, error, notice } = useRun();
  const [dlg, setDlg] = useState<null | "terms" | "handover" | "deduct" | "refund" | "receive" | "terminate" | "return" | "approve">(null);
  if (!d) return <p className="muted">{t("loading")}</p>;
  const a = d.agreement; const mine = me?._id === a.createdBy;
  const rentOf = (term: (typeof d.terms)[number]) => monthlyRent(term.rent.kind === "fixed" ? { kind: "fixed", amount: term.rent.amount } : { kind: "perM2", areaM2: d.unit.areaM2, ratePerM2: term.rent.ratePerM2 });
  return (
    <div className="stack">
      <Link href="/agreements" className="crumb"><Icon name="back" size={16} />{t("nav.agreements")}</Link>
      <PageHeader title={`${d.unit.number} — ${d.renter?.name ?? ""}`}>
        <StatusBadge status={a.status} />
        <Link className="btn" href={`/agreements/${agreementId}/contract`}>{t("contract.title")}</Link>

        {can("propertyManager") && (a.status === "draft" || a.status === "inReview") && (
          <label className="btn">{t("ag.attach")}<input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(async () => attach({ agreementId, fileId: await upload(f) }), t("saved")); e.target.value = ""; }} /></label>)}
        {can("propertyManager") && a.status === "draft" && <button className="btn primary" onClick={() => void run(() => submit({ agreementId }), t("saved"))}>{t("ag.submit")}</button>}
        {can("approver") && a.status === "inReview" && <>
          <button className="btn primary" disabled={mine} title={mine ? t("err.same_person_cannot_approve") : ""} onClick={() => setDlg("approve")}>{t("ag.approve")}</button>
          <button className="btn" onClick={() => setDlg("return")}>{t("ag.return")}</button></>}
        {can("approver") && a.status === "active" && <><button className="btn" onClick={() => setDlg("terms")}>{t("ag.renew")}</button><button className="btn danger" onClick={() => setDlg("terminate")}>{t("ag.terminate")}</button></>}
      
      </PageHeader>
      <Message error={error} notice={notice} />
      <div className="split">
        <div className="stack">
      <Card flush title={t("ag.terms")}><Table rows={d.terms.slice().sort((x, y) => x.effectiveFrom - y.effectiveFrom)} cols={[
        { head: t("date"), cell: (x) => <DateText ms={x.effectiveFrom} /> },
        { head: t("ag.rentBasis"), cell: (x) => (x.rent.kind === "fixed" ? t("ag.fixed") : `${t("ag.perM2")} @ ${(x.rent.ratePerM2 / 100).toLocaleString()}`) },
        { head: t("ag.escalation"), cell: (x) => (x.escalation ? `+${x.escalation.percent}% / ${x.escalation.everyMonths} mo` : "—") },
        { head: t("bill.calc"), cell: (x) => <Money v={rentOf(x)} />, right: true, money: true }, { head: t("ag.dueDay"), cell: (x) => x.dueDay, right: true },
      ]} /></Card>
      <Card flush title={t("ag.handover")} actions={can("propertyManager") && <button className="btn sm" onClick={() => setDlg("handover")}>{t("add")}</button>}>
        <Table rows={d.handovers} empty={t("ag.noHandover")} cols={[{ head: t("date"), cell: (h) => <DateText ms={h.at} /> }, { head: t("status"), cell: (h) => t(h.kind === "moveIn" ? "ag.moveIn" : "ag.moveOut") }, { head: t("ag.keys"), cell: (h) => h.keys }, { head: t("ag.condition"), cell: (h) => h.condition, text: true }]} />
      </Card>
        </div>
        <div className="stack">
          <Card title={t("bill.details")}>
            <dl className="dl">
              <div><dt>{t("ag.unit")}</dt><dd>{d.unit.number} · {d.unit.areaM2} m²</dd></div>
              <div><dt>{t("ag.renter")}</dt><dd>{d.renter?.name}</dd></div>
              <div><dt>{t("ag.start")}</dt><dd><DateText ms={a.startsAt} /></dd></div>
              <div><dt>{t("ag.end")}</dt><dd><DateText ms={a.endsAt} /></dd></div>
              <div><dt>{t("ag.signed")}</dt><dd>{d.hasSigned ? <button type="button" className="linklike" onClick={() => void openFile("signed", d.agreement._id)}>{t("ag.view")}</button> : <span className="muted">—</span>}</dd></div>
              {d.terms.length > 0 && <div><dt>{t("rent")}</dt><dd><Money v={rentOf(d.terms.slice().sort((x, y) => y.effectiveFrom - x.effectiveFrom)[0]!)} strong /></dd></div>}
            </dl>
          </Card>
      {a.status === "active" && dep && <Card title={t("ag.deposit")} actions={<>
        {can("financeOfficer") && <button className="btn sm" onClick={() => setDlg("receive")}>{t("dep.receive")}</button>}
        {can("financeOfficer", "propertyManager") && <button className="btn sm" onClick={() => setDlg("deduct")}>{t("dep.deduct")}</button>}
        {can("approver") && <button className="btn sm" onClick={() => setDlg("refund")}>{t("dep.refund")}</button>}</>}>
        <dl className="dl"><div><dt>{t("dep.required")}</dt><dd><Money v={dep.required} /></dd></div><div><dt>{t("dep.held")}</dt><dd><Money v={dep.held} /></dd></div><div><dt>{t("dep.available")}</dt><dd><Money v={dep.available} strong /></dd></div><div><dt>{t("dep.refunded")}</dt><dd><Money v={dep.refunded} /></dd></div></dl>
        <Table rows={dep.deductions.map((x, i) => ({ ...x, _id: String(i), i }))} empty={t("dep.noDeductions")} cols={[
          { head: t("amount"), cell: (x) => <Money v={x.amount} /> }, { head: t("reason"), cell: (x) => x.reason, text: true },
          { head: t("status"), cell: (x) => (x.approvedBy ? t("approved") : can("approver") && x.requestedBy !== me?._id ? <button className="btn sm" onClick={() => void run(() => appDed({ agreementId, index: x.i }))}>{t("bill.approve")}</button> : t("inReview")) },
        ]} />
      </Card>}
        </div>
      </div>
      {dlg === "terms" && <TermsDialog onClose={() => setDlg(null)} agreementId={agreementId} endsAt={a.endsAt} />}
      {dlg === "handover" && <HandoverDialog error={error} onClose={() => setDlg(null)} onSave={(v) => run(() => handover({ agreementId, ...v }))} />}
      {dlg === "terminate" && <ReasonDialog title={t("ag.terminate")} error={error} onClose={() => setDlg(null)} onSave={(reason) => run(() => terminate({ agreementId, reason }), t("saved"))} />}
      {dlg === "approve" && <ConfirmDialog title={t("confirm.approveTitle")} message={t("confirm.approveBody")} confirmLabel={t("ag.approve")} onClose={() => setDlg(null)} onConfirm={async () => { await run(() => approve({ agreementId }), t("saved")); }} />}
      {dlg === "return" && <ReasonDialog title={t("ag.return")} error={error} onClose={() => setDlg(null)} onSave={(reason) => run(() => back({ agreementId, reason }), t("saved"))} />}
      {dlg === "deduct" && <AmountDialog title={t("dep.deduct")} reason error={error} onClose={() => setDlg(null)} onSave={(amount, reason) => run(() => reqDed({ agreementId, amount, reason: reason! }))} />}
      {dlg === "receive" && <AmountDialog title={t("dep.receive")} error={error} onClose={() => setDlg(null)} onSave={(amount) => run(() => receive({ agreementId, amount }))} />}
      {dlg === "refund" && <AmountDialog title={t("dep.refund")} error={error} onClose={() => setDlg(null)} onSave={(amount) => run(() => refund({ agreementId, amount }))} />}
    </div>
  );
}

function AmountDialog({ title, reason, error, onClose, onSave }: { title: string; reason?: boolean; error?: string | null; onClose: () => void; onSave: (amount: number, reason?: string) => Promise<unknown> }) {
  const { t } = useI18n(); const [amount, setAmount] = useState<number | null>(null); const [r, setR] = useState(""); const [errs, setErrs] = useState<Record<string, string>>({});
  return <Modal title={title} onClose={onClose}><form className="form" noValidate onSubmit={async (e) => {
    e.preventDefault();
    const found = failures({ amount: positive(amount, t), reason: reason ? req(r, t) : null }); setErrs(found); if (Object.keys(found).length) return;
    if ((await onSave(amount!, r.trim())) !== undefined) onClose();
  }}>
    <Field label={`${t("amount")} (ETB)`} error={errs.amount}><MoneyInput value={amount} onChange={(v) => { setAmount(v); setErrs({ ...errs, amount: "" }); }} /></Field>
    {reason && <Field label={t("reason")} error={errs.reason}><input value={r} onChange={(e) => { setR(e.target.value); setErrs({ ...errs, reason: "" }); }} /></Field>}
    <div className="wide"><Message error={error} /><button className="btn primary">{t("save")}</button></div></form></Modal>;
}

function HandoverDialog({ error, onClose, onSave }: { error?: string | null; onClose: () => void; onSave: (v: { kind: "moveIn" | "moveOut"; keys: number; condition: string; readings?: string }) => Promise<unknown> }) {
  const { t } = useI18n(); const [kind, setKind] = useState<"moveIn" | "moveOut">("moveIn"); const [keys, setKeys] = useState(1); const [condition, setCondition] = useState(""); const [readings, setReadings] = useState(""); const [errs, setErrs] = useState<Record<string, string>>({});
  return <Modal title={t("ag.handover")} onClose={onClose}><form className="form" noValidate onSubmit={async (e) => {
    e.preventDefault();
    const found = failures({ condition: req(condition, t), keys: inRange(keys, 0, 99, t("v.nonneg")) }); setErrs(found); if (Object.keys(found).length) return;
    if (await onSave({ kind, keys, condition: condition.trim(), readings: readings.trim() || undefined }) !== undefined) onClose();
  }}>
    <Field label={t("status")}><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="moveIn">{t("ag.moveIn")}</option><option value="moveOut">{t("ag.moveOut")}</option></select></Field>
    <Field label={t("ag.keys")} error={errs.keys}><input type="number" min={0} value={keys} onChange={(e) => setKeys(Number(e.target.value))} /></Field>
    <Field label={t("ag.condition")} error={errs.condition}><input value={condition} onChange={(e) => { setCondition(e.target.value); setErrs({ ...errs, condition: "" }); }} /></Field>
    <Field label={t("util.reading")} hint={t("optional")}><input value={readings} onChange={(e) => setReadings(e.target.value)} /></Field>
    <div className="wide"><Message error={error} /><button className="btn primary">{t("save")}</button></div></form></Modal>;
}

function TermsDialog({ onClose, agreementId, endsAt }: { onClose: () => void; agreementId: Id<"agreements">; endsAt: number }) {
  const { t } = useI18n(); const add = useMutation(api.agreements.addTerm); const { run, error } = useRun();
  const [from, setFrom] = useState<number | null>(null); const [basis, setBasis] = useState<"perM2" | "fixed">("perM2"); const [amount, setAmount] = useState<number | null>(null);
  const [dueDay, setDueDay] = useState(5); const [deposit, setDeposit] = useState<number | null>(0); const [newEnd, setNewEnd] = useState<number | null>(null);
  const [escPct, setEscPct] = useState(""); const [escEvery, setEscEvery] = useState("12");
  return <Modal title={t("ag.renew")} onClose={onClose}><form className="form" onSubmit={async (e) => {
    e.preventDefault(); if (from == null || amount == null || deposit == null) return;
    if (await run(() => add({ agreementId, effectiveFrom: from, rent: basis === "fixed" ? { kind: "fixed", amount } : { kind: "perM2", ratePerM2: amount }, dueDay, depositAmount: deposit, newEndsAt: newEnd && newEnd > endsAt ? newEnd : undefined, escalation: Number(escPct) > 0 ? { percent: Number(escPct), everyMonths: Number(escEvery) } : undefined }))) onClose();
  }}>
    <Field label={t("date")}><DateField value={from} onChange={setFrom} /></Field>
    <Field label={t("ag.rentBasis")}><select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}><option value="perM2">{t("ag.perM2")}</option><option value="fixed">{t("ag.fixed")}</option></select></Field>
    <Field label={basis === "perM2" ? t("prop.rate") : t("amount")}><MoneyInput value={amount} onChange={setAmount} /></Field>
    <Field label={t("ag.dueDay")}><input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))} /></Field>
    <Field label={t("ag.deposit")}><MoneyInput value={deposit} onChange={setDeposit} /></Field>
    <Field label={`${t("ag.end")} (${t("ag.renew")})`}><DateField value={newEnd} onChange={setNewEnd} /></Field>
    <Field label={t("ag.escPct")}><input inputMode="decimal" value={escPct} onChange={(e) => setEscPct(e.target.value)} placeholder="10" /></Field>
    <Field label={t("ag.escEvery")}><input type="number" min={1} max={60} value={escEvery} onChange={(e) => setEscEvery(e.target.value)} /></Field>
    <div className="wide"><Message error={error} /><button className="btn primary" disabled={from == null || amount == null}>{t("save")}</button></div></form></Modal>;
}
