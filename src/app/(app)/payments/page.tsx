"use client";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, ConfirmDialog, DateField, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, ReasonDialog, StatusBadge, Table, Tabs } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { useUpload } from "@/lib/useUpload";
import { failures, positive, req } from "@/lib/validate";

type Status = "" | "recorded" | "confirmed" | "applied" | "voided";
export default function Payments() {
  const { t } = useI18n(); const { can, me } = useMe(); const router = useRouter();
  const [tab, setTab] = useState<Status>(""); const [adding, setAdding] = useState(false); const [voiding, setVoiding] = useState<Id<"payments"> | null>(null); const [applying, setApplying] = useState<Id<"payments"> | null>(null);
  const rows = useQuery(api.payments.list, { status: tab || undefined });
  const confirm = useMutation(api.payments.confirm); const apply = useMutation(api.payments.apply); const voidP = useMutation(api.payments.voidPayment);
  const { run, error, notice } = useRun();
  return (
    <div className="stack">
      <PageHeader title={t("nav.payments")}>{can("financeOfficer") && <button className="btn primary" onClick={() => setAdding(true)}>{t("pay.record")}</button>}</PageHeader>
      <Message error={error} notice={notice} />
      <Tabs value={tab} onChange={(v) => setTab(v as Status)} tabs={[["", t("total")], ["recorded", t("recorded")], ["confirmed", t("confirmed")], ["applied", t("applied")], ["voided", t("voided")]]} />
      <Card flush><Table rows={rows} empty={t("empty.payments")} cols={[
        { head: t("pay.received"), cell: (p) => <DateText ms={p.receivedAt} /> }, { head: t("ag.renter"), cell: (p) => p.renterName }, { head: t("pay.method"), cell: (p) => t(p.method) },
        { head: t("pay.reference"), cell: (p) => p.reference }, { head: t("amount"), cell: (p) => <Money v={p.amount} strong />, right: true, money: true },
        { head: t("pay.evidence"), cell: (p) => (p.evidenceUrl ? <a href={p.evidenceUrl} target="_blank" rel="noreferrer">✓</a> : "—") }, { head: t("status"), cell: (p) => <StatusBadge status={p.status} /> },
        { head: "", cell: (p) => <div className="row">
          <button className="btn sm" onClick={() => router.push(`/payments/${p._id}`)}>{t("pay.receipt")}</button>
          {p.status === "recorded" && can("approver") && <button className="btn sm primary" disabled={p.recordedBy === me?._id} title={p.recordedBy === me?._id ? t("err.same_person_cannot_approve") : ""} onClick={() => void run(() => confirm({ paymentId: p._id }), t("saved"))}>{t("pay.confirm")}</button>}
          {p.status === "confirmed" && can("financeOfficer") && <button className="btn sm primary" onClick={() => setApplying(p._id)}>{t("pay.apply")}</button>}
          {(p.status === "recorded" || p.status === "confirmed") && can("approver") && <button className="btn sm danger" onClick={() => setVoiding(p._id)}>{t("pay.void")}</button>}</div> },
      ]} /></Card>
      {adding && <RecordForm onClose={() => setAdding(false)} />}
      {applying && <ConfirmDialog title={t("confirm.applyTitle")} message={t("confirm.applyBody")} confirmLabel={t("pay.apply")} onClose={() => setApplying(null)} onConfirm={async () => { await run(async () => apply({ paymentId: applying }), t("saved")); }} />}
      {voiding && <ReasonDialog title={t("pay.void")} onClose={() => setVoiding(null)} onSave={(reason) => run(() => voidP({ paymentId: voiding, reason }), t("saved"))} />}
    </div>
  );
}

function RecordForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const record = useMutation(api.payments.record); const upload = useUpload(); const { run, error, busy } = useRun();
  const renters = useQuery(api.renters.list, {});
  const [renterId, setRenterId] = useState(""); const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<"bankDeposit" | "transfer" | "telebirr" | "cbeBirr" | "cash">("transfer"); const [reference, setReference] = useState("");
  const [at, setAt] = useState<number | null>(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())); const [file, setFile] = useState<File | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clear = (k: string) => errs[k] && setErrs({ ...errs, [k]: "" });
  return (
    <Modal title={t("pay.record")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ renter: renterId ? null : t("v.pick"), amount: positive(amount, t), reference: req(reference, t), at: at == null ? t("v.date") : null });
        setErrs(found); if (Object.keys(found).length) return;
        if (await run(async () => record({ renterId: renterId as Id<"renters">, amount: amount!, method, reference: reference.trim(), receivedAt: at!, evidenceFileId: file ? await upload(file) : undefined }), t("saved"))) onClose();
      }}>
        <Field label={t("ag.renter")} error={errs.renter}><select value={renterId} onChange={(e) => { setRenterId(e.target.value); clear("renter"); }}><option value="" />{renters?.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</select></Field>
        <Field label={`${t("amount")} (ETB)`} error={errs.amount}><MoneyInput value={amount} onChange={(v) => { setAmount(v); clear("amount"); }} /></Field>
        <Field label={t("pay.method")}><select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{(["bankDeposit", "transfer", "telebirr", "cbeBirr", "cash"] as const).map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></Field>
        <Field label={t("pay.reference")} error={errs.reference}><input value={reference} onChange={(e) => { setReference(e.target.value); clear("reference"); }} /></Field>
        <Field label={t("pay.received")} error={errs.at}><DateField value={at} onChange={setAt} /></Field>
        <Field label={t("pay.evidence")} hint="Screenshot or slip. Evidence alone does not confirm receipt."><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("save")}</button></div>
      </form>
    </Modal>
  );
}
