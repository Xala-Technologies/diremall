"use client";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, ConfirmDialog, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, StatusBadge, Table } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatEtb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { failures, positive, req } from "@/lib/validate";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>(); const invoiceId = id as Id<"invoices">;
  const { t } = useI18n(); const { can, me } = useMe();
  const d = useQuery(api.billing.get, { invoiceId });
  const credit = useQuery(api.payments.credit, d ? { renterId: d.invoice.renterId } : "skip");
  const issue = useMutation(api.billing.issue); const discard = useMutation(api.billing.discardDraft);
  const reqAdj = useMutation(api.billing.requestAdjustment); const appAdj = useMutation(api.billing.approveAdjustment);
  const useCredit = useMutation(api.payments.useCredit);
  const { run, error, notice } = useRun(); const [dlg, setDlg] = useState(false); const [confirmDiscard, setConfirmDiscard] = useState(false); const [confirmIssue, setConfirmIssue] = useState(false); const router = useRouter();
  if (!d) return <p className="muted">{t("loading")}</p>;
  const inv = d.invoice; const b = d.balance;
  return (
    <div className="stack">
      <Link href="/billing" className="crumb"><Icon name="back" size={16} />{t("nav.billing")}</Link>
      <PageHeader title={`${t("bill.number")} ${inv.number || t("draft")}`}>
        <StatusBadge status={inv.status === "draft" ? "draft" : b.due <= 0 ? "paid" : b.paid + b.creditUsed > 0 ? "partial" : "outstanding"} />
        <button className="btn no-print" onClick={() => window.print()}>{t("print")}</button>
        {inv.status === "draft" && can("financeOfficer") && <>
          <button className="btn primary" onClick={() => setConfirmIssue(true)}>{t("bill.issue")}</button>
          <button className="btn danger" onClick={() => setConfirmDiscard(true)}>{t("discard")}</button></>}
        {inv.status === "issued" && can("financeOfficer") && <button className="btn" onClick={() => setDlg(true)}>{t("bill.adjust")}</button>}
        {inv.status === "issued" && can("financeOfficer") && (credit ?? 0) > 0 && b.due > 0 && <button className="btn" onClick={() => void run(() => useCredit({ invoiceId }), t("saved"))}>{t("pay.useCredit")} (<Money v={credit ?? 0} />)</button>}
      </PageHeader>
      <Message error={error} notice={notice} />
      <div className="split">
        <div className="stack">
          <Card flush title={t("bill.calc")}>
            <Table rows={d.lines} cols={[
              { head: t("bill.item"), cell: (l) => <strong>{l.description}</strong> }, { head: t("bill.calc"), cell: (l) => <span className="muted">{l.calcNote}</span>, text: true },
              { head: t("amount"), cell: (l) => <Money v={l.amount} />, right: true, money: true }]} />
          </Card>
          {d.payments.length > 0 && (
            <Card flush title={t("nav.payments")}>
              <Table rows={d.payments.map((p, i) => ({ ...p, _id: String(i) }))} cols={[
                { head: t("pay.received"), cell: (p) => <DateText ms={p.receivedAt} /> }, { head: t("pay.method"), cell: (p) => t(p.method) }, { head: t("pay.reference"), cell: (p) => p.reference },
                { head: t("amount"), cell: (p) => <Money v={p.amount} />, right: true, money: true },
                { head: "", cell: (p) => <button className="btn sm" onClick={() => router.push(`/payments/${p.paymentId}`)}>{t("pay.receipt")} {p.receiptNumber}</button> }]} />
            </Card>)}
        </div>
        <div className="stack">
          <Card title={t("bill.summary")}>
            <dl className="dl">
              <div><dt>{t("total")}</dt><dd><Money v={b.total} /></dd></div>
              {b.adjustments !== 0 && <div><dt>{t("bill.adjustments")}</dt><dd><Money v={b.adjustments} /></dd></div>}
              {inv.status === "issued" && <div><dt>{t("bill.paid")}</dt><dd><Money v={b.paid + b.creditUsed} /></dd></div>}
            </dl>
            {inv.status === "issued" && <div className="due-box"><span>{t("bill.due")}</span><strong className="num">{formatEtb(b.due)}</strong></div>}
          </Card>
          <Card title={t("bill.details")}>
            <dl className="dl">
              <div><dt>{t("ag.renter")}</dt><dd>{d.renter?.name}</dd></div>
              <div><dt>{t("ag.unit")}</dt><dd>{d.unit.number}</dd></div>
              <div><dt>{t("period")}</dt><dd>{inv.period}</dd></div>
              <div><dt>{t("bill.dueDate")}</dt><dd><DateText ms={inv.dueAt} /></dd></div>
              {inv.issuedAt && <div><dt>{t("bill.issuedOn")}</dt><dd><DateText ms={inv.issuedAt} /></dd></div>}
            </dl>
          </Card>
        </div>
      </div>
      {d.adjustments.length > 0 && <Card title={t("bill.adjustments")}><Table rows={d.adjustments} cols={[
        { head: t("amount"), cell: (a) => <Money v={a.delta} /> }, { head: t("reason"), cell: (a) => a.reason, text: true },
        { head: t("status"), cell: (a) => (a.approvedBy ? t("approved") : can("approver") && a.requestedBy !== me?._id ? <button className="btn sm" onClick={() => void run(() => appAdj({ adjustmentId: a._id }), t("saved"))}>{t("bill.approve")}</button> : t("inReview")) }]} /></Card>}
      {confirmIssue && <ConfirmDialog title={t("confirm.issueTitle")} message={t("confirm.issueBody").replace("{n}", "1")} confirmLabel={t("bill.issueN")} onClose={() => setConfirmIssue(false)} onConfirm={async () => { await run(() => issue({ invoiceIds: [invoiceId] }), t("saved")); }} />}
      {confirmDiscard && <ConfirmDialog title={t("discard")} message={t("confirm.discardBody")} confirmLabel={t("discard")} danger onClose={() => setConfirmDiscard(false)} onConfirm={async () => { const ok = await run(() => discard({ invoiceId })); if (ok !== undefined) router.push("/billing"); }} />}
      {dlg && <AdjustDialog error={error} onClose={() => setDlg(false)} onSave={(delta, reason) => run(() => reqAdj({ invoiceId, delta, reason }))} />}
    </div>
  );
}

function AdjustDialog({ error, onClose, onSave }: { error?: string | null; onClose: () => void; onSave: (delta: number, reason: string) => Promise<unknown> }) {
  const { t } = useI18n(); const [amount, setAmount] = useState<number | null>(null); const [sign, setSign] = useState<1 | -1>(-1); const [reason, setReason] = useState(""); const [errs, setErrs] = useState<Record<string, string>>({});
  return <Modal title={t("bill.adjust")} onClose={onClose}><form className="form" noValidate onSubmit={async (e) => {
    e.preventDefault();
    const found = failures({ amount: positive(amount, t), reason: req(reason, t) }); setErrs(found); if (Object.keys(found).length) return;
    if ((await onSave(sign * amount!, reason.trim())) !== undefined) onClose();
  }}>
    <Field label={t("bill.adjustKind")}><select value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)}><option value={-1}>{t("bill.reduce")}</option><option value={1}>{t("bill.increase")}</option></select></Field>
    <Field label={`${t("amount")} (ETB)`} error={errs.amount}><MoneyInput value={amount} onChange={(v) => { setAmount(v); setErrs({ ...errs, amount: "" }); }} /></Field>
    <Field label={t("reason")} error={errs.reason}><input value={reason} onChange={(e) => { setReason(e.target.value); setErrs({ ...errs, reason: "" }); }} /></Field>
    <div className="wide"><Message error={error} /><button className="btn primary">{t("save")}</button></div></form></Modal>;
}
