"use client";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Card, ConfirmDialog, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, StatusBadge, Table } from "@/components/ui";
import { Icon } from "@/components/icons";
import { OrgHeader } from "@/components/OrgHeader";
import { etbInWords } from "@/lib/words";
import { formatEtb, periodText } from "@/lib/format";
import { useToast } from "@/components/toast";
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
  const useCredit = useMutation(api.payments.useCredit); const remind = useMutation(api.billing.sendReminders);
  const org = useQuery(api.settings.org) as { tin?: string; address?: string; bankAccounts?: string; invoiceNote?: string } | undefined; const buildings = useQuery(api.properties.listBuildings, {});
  const { run, error, notice } = useRun(); const toast = useToast(); const [dlg, setDlg] = useState(false); const [confirmDiscard, setConfirmDiscard] = useState(false); const [confirmIssue, setConfirmIssue] = useState(false); const router = useRouter();
  if (!d) return <p className="muted">{t("loading")}</p>;
  const inv = d.invoice; const b = d.balance;
  const building = buildings?.find((x) => x._id === d.unit.buildingId)?.name;
  const open = inv.status === "issued" && b.due > 0; const late = open && inv.dueAt < Date.now();
  const lineSum = d.lines.reduce((s, l) => s + l.amount, 0);
  return (
    <div className="stack">
      <div className="stack screen-only">
      <Link href="/billing" className="crumb"><Icon name="back" size={16} />{t("nav.billing")}</Link>
      <PageHeader title={`${t("bill.number")} ${inv.number || t("draft")}`}>
        <StatusBadge status={inv.status === "draft" ? "draft" : b.due <= 0 ? "paid" : b.paid + b.creditUsed > 0 ? "partial" : "outstanding"} />
        <button className="btn no-print" onClick={() => window.print()}><Icon name="print" size={16} />{t("print")}</button>
        {open && can("financeOfficer") && <button className="btn" onClick={() => router.push(`/payments?new=1&renter=${inv.renterId}&amount=${b.due}&narr=${encodeURIComponent(inv.number)}`)}>{t("bill.recordPayment")}</button>}
        {open && can("financeOfficer") && <button className="btn" onClick={async () => { const r = await run(() => remind({ invoiceIds: [invoiceId] })); if (r) { if (r.sent) toast(t("bill.reminderQueued")); else toast(t(`bill.skip.${r.skipped[0]?.reason}`)); } }}><Icon name="bell" size={16} />{t("bill.remind")}</button>}
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
              <div><dt>{t("period")}</dt><dd>{periodText(inv.period, t)}</dd></div>
              <div><dt>{t("bill.dueDate")}</dt><dd><DateText ms={inv.dueAt} /></dd></div>
              {inv.issuedAt && <div><dt>{t("bill.issuedOn")}</dt><dd><DateText ms={inv.issuedAt} /></dd></div>}
            </dl>
          </Card>
        </div>
      </div>
      {d.adjustments.length > 0 && <Card title={t("bill.adjustments")}><Table rows={d.adjustments} cols={[
        { head: t("amount"), cell: (a) => <Money v={a.delta} /> }, { head: t("reason"), cell: (a) => a.reason, text: true },
        { head: t("status"), cell: (a) => (a.approvedBy ? t("approved") : can("approver") && a.requestedBy !== me?._id ? <button className="btn sm" onClick={() => void run(() => appAdj({ adjustmentId: a._id }), t("saved"))}>{t("bill.approve")}</button> : t("inReview")) }]} /></Card>}
      </div>
      <section className="invoice-wrap">
        {org && (!org.tin || !org.address || !org.bankAccounts) && <p className="msg info screen-only"><Icon name="alert" size={16} />{t("bill.orgMissing")} <Link href="/settings">{t("nav.settings")}</Link></p>}
        <div className="screen-only invoice-wrap-h"><h2>{t("bill.printable")}</h2><button className="btn sm no-print" onClick={() => window.print()}><Icon name="print" size={15} />{t("print")}</button></div>
        <article className="paper invoice" aria-label={t("bill.invoice")}>
          <header className="paper-h">
            <OrgHeader />
            <div style={{ textAlign: "right" }}>
              <div className="paper-title">{inv.status === "draft" ? t("bill.draftTitle") : t("bill.invoice")}</div>
              <div className="num strong">{inv.number || "—"}</div>
              {inv.status === "issued" && <div className={`stamp ${b.due <= 0 ? "paid" : late ? "late" : ""}`}>{b.due <= 0 ? t("paidFull") : late ? t("overdue") : t("bill.due")}</div>}
            </div>
          </header>
          <div className="invoice-meta">
            <div><span className="muted">{t("bill.billTo")}</span><b>{d.renter?.name}</b>{d.renter?.tin && <span>TIN {d.renter.tin}</span>}{d.renter?.address && <span>{d.renter.address}</span>}<span>{d.renter?.phone}</span></div>
            <div><span className="muted">{t("ag.unit")}</span><b>{d.unit.number}</b>{building && <span>{building}</span>}<span>{t("period")} {periodText(inv.period, t)}</span></div>
            <div><span className="muted">{t("bill.issuedOn")}</span><b>{inv.issuedAt ? <DateText ms={inv.issuedAt} /> : "—"}</b><span className="muted">{t("bill.dueDate")}</span><b><DateText ms={inv.dueAt} /></b></div>
          </div>
          <table className="paper-table">
            <thead><tr><th>{t("bill.item")}</th><th>{t("bill.calc")}</th><th className="r">{t("amount")} (ETB)</th></tr></thead>
            <tbody>{d.lines.map((l) => <tr key={l._id}><td>{l.description}</td><td>{l.calcNote}</td><td className="r num">{(l.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td></tr>)}</tbody>
          </table>
          <dl className="invoice-totals">
            <div><dt>{t("bill.subtotal")}</dt><dd className="num">{(lineSum / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd></div>
            {b.adjustments !== 0 && <div><dt>{t("bill.adjustments")}</dt><dd className="num">{(b.adjustments / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd></div>}
            <div><dt>{t("total")}</dt><dd className="num">{(b.total + b.adjustments) / 100 === 0 ? "0.00" : ((b.total + b.adjustments) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd></div>
            {inv.status === "issued" && <div><dt>{t("bill.paid")}</dt><dd className="num">{((b.paid + b.creditUsed) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd></div>}
            {inv.status === "issued" && <div className="grand"><dt>{t("bill.due")}</dt><dd className="num">ETB {(b.due / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</dd></div>}
          </dl>
          {inv.status === "issued" && <p className="paper-note"><span className="muted">{t("bill.inWords")}:</span> <b>{etbInWords(Math.max(b.due, 0))}</b></p>}
          {org?.bankAccounts && <div className="paper-pay"><b>{t("bill.howToPay")}</b>{org.bankAccounts.split("\n").filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}<span className="muted">{t("bill.quoteNumber")} {inv.number}</span></div>}
          {org?.invoiceNote && <p className="paper-note">{org.invoiceNote}</p>}
          <footer className="paper-f"><div><span className="muted">{t("bill.issuedBy")}</span><div className="sign" /></div><div><span className="muted">{t("bill.receivedBy")}</span><div className="sign" /></div></footer>
        </article>
      </section>
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
