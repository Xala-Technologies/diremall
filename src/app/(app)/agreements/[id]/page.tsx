"use client";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, DateField, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, StatusBadge, Table } from "@/components/ui";
import { monthlyRent } from "../../../../../convex/lib/billing";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { useUpload } from "@/lib/useUpload";

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
  const upload = useUpload(); const { run, error, notice } = useRun();
  const [dlg, setDlg] = useState<null | "terms" | "handover" | "deduct" | "refund" | "receive" | "terminate">(null);
  if (!d) return <p className="muted">{t("loading")}</p>;
  const a = d.agreement; const mine = me?._id === a.createdBy;
  const rentOf = (term: (typeof d.terms)[number]) => monthlyRent(term.rent.kind === "fixed" ? { kind: "fixed", amount: term.rent.amount } : { kind: "perM2", areaM2: d.unit.areaM2, ratePerM2: term.rent.ratePerM2 });
  return (
    <div className="stack">
      <PageHeader title={`${d.unit.number} — ${d.renter?.name ?? ""}`}><StatusBadge status={a.status} /></PageHeader>
      <Message error={error} notice={notice} />
      <Card title={t("nav.agreements")} actions={<>
        {can("propertyManager") && (a.status === "draft" || a.status === "inReview") && (
          <label className="btn sm">{t("ag.attach")}<input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(async () => attach({ agreementId, fileId: await upload(f) }), t("saved")); e.target.value = ""; }} /></label>)}
        {can("propertyManager") && a.status === "draft" && <button className="btn sm primary" onClick={() => void run(() => submit({ agreementId }), t("saved"))}>{t("ag.submit")}</button>}
        {can("approver") && a.status === "inReview" && <>
          <button className="btn sm primary" disabled={mine} title={mine ? t("err.same_person_cannot_approve") : ""} onClick={() => void run(() => approve({ agreementId }), t("saved"))}>{t("ag.approve")}</button>
          <button className="btn sm" onClick={() => { const reason = prompt(t("reason")); if (reason) void run(() => back({ agreementId, reason })); }}>{t("ag.return")}</button></>}
        {can("approver") && a.status === "active" && <><button className="btn sm" onClick={() => setDlg("terms")}>{t("ag.renew")}</button><button className="btn sm danger" onClick={() => setDlg("terminate")}>{t("ag.terminate")}</button></>}
      </>}>
        <div className="row"><span>{t("ag.start")}: <DateText ms={a.startsAt} /></span><span>{t("ag.end")}: <DateText ms={a.endsAt} /></span>
          <span>{t("ag.signed")}: {d.signedUrl ? <a href={d.signedUrl} target="_blank" rel="noreferrer">✓</a> : "—"}</span></div>
      </Card>
      <Card title={t("ag.terms")}><Table rows={d.terms.slice().sort((x, y) => x.effectiveFrom - y.effectiveFrom)} cols={[
        { head: t("date"), cell: (x) => <DateText ms={x.effectiveFrom} /> },
        { head: t("ag.rentBasis"), cell: (x) => (x.rent.kind === "fixed" ? t("ag.fixed") : `${t("ag.perM2")} @ ${(x.rent.ratePerM2 / 100).toLocaleString()}`) },
        { head: t("bill.calc"), cell: (x) => <Money v={rentOf(x)} />, right: true }, { head: t("ag.dueDay"), cell: (x) => x.dueDay, right: true },
      ]} /></Card>
      {a.status === "active" && dep && <Card title={t("ag.deposit")} actions={<>
        {can("financeOfficer") && <button className="btn sm" onClick={() => setDlg("receive")}>{t("dep.receive")}</button>}
        {can("financeOfficer", "propertyManager") && <button className="btn sm" onClick={() => setDlg("deduct")}>{t("dep.deduct")}</button>}
        {can("approver") && <button className="btn sm" onClick={() => setDlg("refund")}>{t("dep.refund")}</button>}</>}>
        <div className="row"><span>Required <Money v={dep.required} /></span><span>Held <Money v={dep.held} /></span><span>Available <Money v={dep.available} strong /></span><span>Refunded <Money v={dep.refunded} /></span></div>
        <Table rows={dep.deductions.map((x, i) => ({ ...x, _id: String(i), i }))} empty="—" cols={[
          { head: t("amount"), cell: (x) => <Money v={x.amount} /> }, { head: t("reason"), cell: (x) => x.reason },
          { head: t("status"), cell: (x) => (x.approvedBy ? t("approved") : can("approver") && x.requestedBy !== me?._id ? <button className="btn sm" onClick={() => void run(() => appDed({ agreementId, index: x.i }))}>{t("bill.approve")}</button> : t("inReview")) },
        ]} />
      </Card>}
      <Card title={t("ag.handover")} actions={can("propertyManager") && <button className="btn sm" onClick={() => setDlg("handover")}>{t("add")}</button>}>
        <Table rows={d.handovers} empty="—" cols={[{ head: t("date"), cell: (h) => <DateText ms={h.at} /> }, { head: t("status"), cell: (h) => t(h.kind === "moveIn" ? "ag.moveIn" : "ag.moveOut") }, { head: t("ag.keys"), cell: (h) => h.keys }, { head: t("ag.condition"), cell: (h) => h.condition }]} />
      </Card>
      {dlg === "terms" && <TermsDialog onClose={() => setDlg(null)} agreementId={agreementId} endsAt={a.endsAt} />}
      {dlg === "handover" && <HandoverDialog onClose={() => setDlg(null)} onSave={(v) => run(() => handover({ agreementId, ...v }))} />}
      {dlg === "terminate" && <ReasonDialog title={t("ag.terminate")} onClose={() => setDlg(null)} onSave={(reason) => run(() => terminate({ agreementId, reason }))} />}
      {dlg === "deduct" && <AmountDialog title={t("dep.deduct")} reason onClose={() => setDlg(null)} onSave={(amount, reason) => run(() => reqDed({ agreementId, amount, reason: reason! }))} />}
      {dlg === "receive" && <AmountDialog title={t("dep.receive")} onClose={() => setDlg(null)} onSave={(amount) => run(() => receive({ agreementId, amount }))} />}
      {dlg === "refund" && <AmountDialog title={t("dep.refund")} onClose={() => setDlg(null)} onSave={(amount) => run(() => refund({ agreementId, amount }))} />}
    </div>
  );
}

function ReasonDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (r: string) => Promise<unknown> }) {
  const { t } = useI18n(); const [r, setR] = useState("");
  return <Modal title={title} onClose={onClose}><form className="form" onSubmit={async (e) => { e.preventDefault(); if (await onSave(r) !== undefined) onClose(); }}>
    <Field label={t("reason")}><input required value={r} onChange={(e) => setR(e.target.value)} /></Field><div className="wide"><button className="btn primary">{t("save")}</button></div></form></Modal>;
}

function AmountDialog({ title, reason, onClose, onSave }: { title: string; reason?: boolean; onClose: () => void; onSave: (amount: number, reason?: string) => Promise<unknown> }) {
  const { t } = useI18n(); const [amount, setAmount] = useState<number | null>(null); const [r, setR] = useState("");
  return <Modal title={title} onClose={onClose}><form className="form" onSubmit={async (e) => { e.preventDefault(); if (amount && (await onSave(amount, r)) !== undefined) onClose(); }}>
    <Field label={`${t("amount")} (ETB)`}><MoneyInput value={amount} onChange={setAmount} /></Field>
    {reason && <Field label={t("reason")}><input required value={r} onChange={(e) => setR(e.target.value)} /></Field>}
    <div className="wide"><button className="btn primary" disabled={!amount}>{t("save")}</button></div></form></Modal>;
}

function HandoverDialog({ onClose, onSave }: { onClose: () => void; onSave: (v: { kind: "moveIn" | "moveOut"; keys: number; condition: string; readings?: string }) => Promise<unknown> }) {
  const { t } = useI18n(); const [kind, setKind] = useState<"moveIn" | "moveOut">("moveIn"); const [keys, setKeys] = useState(1); const [condition, setCondition] = useState(""); const [readings, setReadings] = useState("");
  return <Modal title={t("ag.handover")} onClose={onClose}><form className="form" onSubmit={async (e) => { e.preventDefault(); if (await onSave({ kind, keys, condition, readings: readings || undefined }) !== undefined) onClose(); }}>
    <Field label={t("status")}><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="moveIn">{t("ag.moveIn")}</option><option value="moveOut">{t("ag.moveOut")}</option></select></Field>
    <Field label={t("ag.keys")}><input type="number" min={0} value={keys} onChange={(e) => setKeys(Number(e.target.value))} /></Field>
    <Field label={t("ag.condition")}><input required value={condition} onChange={(e) => setCondition(e.target.value)} /></Field>
    <Field label={t("util.reading")}><input value={readings} onChange={(e) => setReadings(e.target.value)} /></Field>
    <div className="wide"><button className="btn primary">{t("save")}</button></div></form></Modal>;
}

function TermsDialog({ onClose, agreementId, endsAt }: { onClose: () => void; agreementId: Id<"agreements">; endsAt: number }) {
  const { t } = useI18n(); const add = useMutation(api.agreements.addTerm); const { run, error } = useRun();
  const [from, setFrom] = useState<number | null>(null); const [basis, setBasis] = useState<"perM2" | "fixed">("perM2"); const [amount, setAmount] = useState<number | null>(null);
  const [dueDay, setDueDay] = useState(5); const [deposit, setDeposit] = useState<number | null>(0); const [newEnd, setNewEnd] = useState<number | null>(null);
  return <Modal title={t("ag.renew")} onClose={onClose}><form className="form" onSubmit={async (e) => {
    e.preventDefault(); if (from == null || amount == null || deposit == null) return;
    if (await run(() => add({ agreementId, effectiveFrom: from, rent: basis === "fixed" ? { kind: "fixed", amount } : { kind: "perM2", ratePerM2: amount }, dueDay, depositAmount: deposit, newEndsAt: newEnd && newEnd > endsAt ? newEnd : undefined }))) onClose();
  }}>
    <Field label={t("date")}><DateField value={from} onChange={setFrom} /></Field>
    <Field label={t("ag.rentBasis")}><select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}><option value="perM2">{t("ag.perM2")}</option><option value="fixed">{t("ag.fixed")}</option></select></Field>
    <Field label={basis === "perM2" ? t("prop.rate") : t("amount")}><MoneyInput value={amount} onChange={setAmount} /></Field>
    <Field label={t("ag.dueDay")}><input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))} /></Field>
    <Field label={t("ag.deposit")}><MoneyInput value={deposit} onChange={setDeposit} /></Field>
    <Field label={`${t("ag.end")} (${t("ag.renew")})`}><DateField value={newEnd} onChange={setNewEnd} /></Field>
    <div className="wide"><Message error={error} /><button className="btn primary" disabled={from == null || amount == null}>{t("save")}</button></div></form></Modal>;
}
