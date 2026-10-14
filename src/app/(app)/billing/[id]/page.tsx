"use client";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, StatusBadge, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>(); const invoiceId = id as Id<"invoices">;
  const { t } = useI18n(); const { can, me } = useMe();
  const d = useQuery(api.billing.get, { invoiceId });
  const credit = useQuery(api.payments.credit, d ? { renterId: d.invoice.renterId } : "skip");
  const issue = useMutation(api.billing.issue); const discard = useMutation(api.billing.discardDraft);
  const reqAdj = useMutation(api.billing.requestAdjustment); const appAdj = useMutation(api.billing.approveAdjustment);
  const useCredit = useMutation(api.payments.useCredit);
  const { run, error, notice } = useRun(); const [dlg, setDlg] = useState(false);
  if (!d) return <p className="muted">{t("loading")}</p>;
  const inv = d.invoice; const b = d.balance;
  return (
    <div className="stack">
      <PageHeader title={`${t("bill.number")} ${inv.number || t("draft")}`}>
        <StatusBadge status={inv.status === "draft" ? "draft" : b.due <= 0 ? "paid" : b.paid + b.creditUsed > 0 ? "partial" : "outstanding"} />
        <button className="btn no-print" onClick={() => window.print()}>{t("print")}</button>
        {inv.status === "draft" && can("financeOfficer") && <>
          <button className="btn primary" onClick={() => void run(() => issue({ invoiceIds: [invoiceId] }), t("saved"))}>{t("bill.issue")}</button>
          <button className="btn danger" onClick={() => void run(() => discard({ invoiceId }))}>{t("cancel")}</button></>}
        {inv.status === "issued" && can("financeOfficer") && <button className="btn" onClick={() => setDlg(true)}>{t("bill.adjust")}</button>}
        {inv.status === "issued" && can("financeOfficer") && (credit ?? 0) > 0 && b.due > 0 && <button className="btn" onClick={() => void run(() => useCredit({ invoiceId }), t("saved"))}>{t("pay.useCredit")} (<Money v={credit ?? 0} />)</button>}
      </PageHeader>
      <Message error={error} notice={notice} />
      <Card>
        <div className="row"><span><strong>{d.unit.number}</strong> — {d.renter?.name}</span><span>{inv.period}</span><span>{t("date")}: <DateText ms={inv.dueAt} /></span></div>
      </Card>
      <Card title={t("bill.calc")}>
        <Table rows={d.lines} cols={[
          { head: "", cell: (l) => l.description }, { head: t("bill.calc"), cell: (l) => <span className="muted">{l.calcNote}</span>, text: true }, { head: t("amount"), cell: (l) => <Money v={l.amount} />, right: true, money: true }]} />
        <div className="stack" style={{ marginTop: 12, justifyItems: "end" }}>
          <div>{t("total")}: <Money v={b.total} strong /></div>
          {b.adjustments !== 0 && <div>{t("bill.adjustments")}: <Money v={b.adjustments} /></div>}
          {inv.status === "issued" && <><div>{t("bill.paid")}: <Money v={b.paid + b.creditUsed} /></div><div style={{ fontSize: 18 }}>{t("bill.due")}: <Money v={b.due} strong /></div></>}
        </div>
      </Card>
      {d.adjustments.length > 0 && <Card title={t("bill.adjustments")}><Table rows={d.adjustments} cols={[
        { head: t("amount"), cell: (a) => <Money v={a.delta} /> }, { head: t("reason"), cell: (a) => a.reason, text: true },
        { head: t("status"), cell: (a) => (a.approvedBy ? t("approved") : can("approver") && a.requestedBy !== me?._id ? <button className="btn sm" onClick={() => void run(() => appAdj({ adjustmentId: a._id }), t("saved"))}>{t("bill.approve")}</button> : t("inReview")) }]} /></Card>}
      {dlg && <AdjustDialog onClose={() => setDlg(false)} onSave={(delta, reason) => run(() => reqAdj({ invoiceId, delta, reason }))} />}
    </div>
  );
}

function AdjustDialog({ onClose, onSave }: { onClose: () => void; onSave: (delta: number, reason: string) => Promise<unknown> }) {
  const { t } = useI18n(); const [amount, setAmount] = useState<number | null>(null); const [sign, setSign] = useState<1 | -1>(-1); const [reason, setReason] = useState("");
  return <Modal title={t("bill.adjust")} onClose={onClose}><form className="form" onSubmit={async (e) => { e.preventDefault(); if (amount && (await onSave(sign * amount, reason)) !== undefined) onClose(); }}>
    <Field label={t("status")}><select value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)}><option value={-1}>− Reduce</option><option value={1}>+ Increase</option></select></Field>
    <Field label={`${t("amount")} (ETB)`}><MoneyInput value={amount} onChange={setAmount} /></Field>
    <Field label={t("reason")}><input required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    <div className="wide"><button className="btn primary" disabled={!amount}>{t("save")}</button></div></form></Modal>;
}
