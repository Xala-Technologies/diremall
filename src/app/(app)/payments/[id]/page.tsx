"use client";
import { useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Icon } from "@/components/icons";
import { OrgHeader } from "@/components/OrgHeader";
import { etbInWords } from "@/lib/words";
import { Card, DateText, Money, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { periodText, currencyCode } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function Receipt() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n(); const router = useRouter();
  const d = useQuery(api.payments.get, { paymentId: id as Id<"payments"> });
  if (!d) return <Card><Skeleton lines={6} /></Card>;
  const p = d.payment;
  const issued = p.status === "applied" && p.receiptNumber;
  return (
    <div className="stack">
      <PageHeader title={t("receipt.title")}>
        <button className="btn ghost" onClick={() => router.back()}>{t("back")}</button>
        {issued && <button className="btn primary no-print" onClick={() => window.print()}><Icon name="print" />{t("print")}</button>}
      </PageHeader>
      {!issued && <div className="msg bad no-print">{t("receipt.notYet")} <StatusBadge status={p.status} /></div>}
      <article className="paper" aria-label={t("receipt.title")}>
        <header className="paper-h">
          <OrgHeader />
          <div style={{ textAlign: "right" }}><div className="paper-title">{t("receipt.title")}</div><div className="num strong">{p.receiptNumber ?? "—"}</div></div>
        </header>
        <dl className="dl paper-dl">
          <div><dt>{t("receipt.receivedFrom")}</dt><dd>{d.renter?.name}{d.renter?.tin ? ` · TIN ${d.renter.tin}` : ""}{p.payerName ? <><br /><small className="muted">{t("pay.paidBy")} {p.payerName}</small></> : null}</dd></div>
          <div><dt>{t("pay.received")}</dt><dd><DateText ms={p.receivedAt} /></dd></div>
          <div><dt>{t("pay.method")}</dt><dd>{t(p.method)}</dd></div>
          <div><dt>{t("pay.reference")}</dt><dd>{p.reference}</dd></div>
          <div><dt>{t("amount")}</dt><dd style={{ fontSize: 20 }}><Money v={p.amount} strong /></dd></div>
          <div><dt>{t("bill.inWords")}</dt><dd>{etbInWords(p.amount)}</dd></div>
        </dl>
        {d.lines.length > 0 && (
          <table className="paper-table">
            <thead><tr><th>{t("bill.number")}</th><th>{t("ag.unit")}</th><th>{t("period")}</th><th className="r">{t("amount")} ({currencyCode()})</th></tr></thead>
            <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.invoiceNumber}</td><td>{l.unitNumber}</td><td>{periodText(l.period, t)}</td><td className="r num">{(l.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>)}</tbody>
          </table>
        )}
        {d.credit > 0 && <p className="paper-note">{t("receipt.credit")}: <b className="num">{(d.credit / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} {currencyCode()}</b></p>}
        <footer className="paper-f"><div><span className="muted">{t("receipt.receivedBy")}</span><div className="sign" /><b>{d.confirmedByName}</b></div><div><span className="muted">{t("receipt.payerSign")}</span><div className="sign" /></div></footer>
      </article>
    </div>
  );
}
