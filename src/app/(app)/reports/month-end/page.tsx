"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Card, DateText, Kpi, Money, PageHeader, PeriodPicker, Skeleton, StatusBadge, Table } from "@/components/ui";
import { pct } from "@/lib/format";
import { usePeriod } from "@/lib/usePeriod";
import { useI18n } from "@/lib/i18n";
import { downloadXlsx } from "@/lib/xlsx";
import { periodRange } from "../../../../../convex/lib/period";

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function MonthEnd() {
  const { t } = useI18n();
  const [period, setPeriod] = usePeriod();
  const dash = useQuery(api.reports.dashboard, { period });
  const bills = useQuery(api.billing.list, { period });
  const received = useQuery(api.payments.inPeriod, { period });
  const aging = useQuery(api.reports.aging, {});
  const roll = useQuery(api.reports.rentRoll, {});
  const { start, end } = periodRange(period);
  const shownPayments = received?.filter((p) => p.status !== "voided");
  const ready = dash && bills && shownPayments && aging && roll;

  const exportAll = () => {
    if (!ready) return;
    void downloadXlsx(`month-end-${period}`, [
      { name: "Summary", rows: [
        { item: "Billed", etb: dash.billed / 100 }, { item: "Applied to bills", etb: dash.appliedToBills / 100 }, { item: "Outstanding", etb: dash.outstanding / 100 },
        { item: "Confirmed payments", etb: dash.confirmedPayments / 100 }, { item: "Waiting to apply", etb: dash.waitingToApply / 100 }, { item: "Overdue (all months)", etb: dash.overdue / 100 },
        { item: "Deposits held", etb: dash.depositsHeld / 100 }, { item: "Occupancy", etb: Math.round(dash.occupancyRate * 1000) / 10 },
      ] },
      { name: "Bills", rows: bills.map((b) => ({ number: b.number, unit: b.unitNumber, renter: b.renterName, due: iso(b.dueAt), total: (b.total + b.adjustments) / 100, paid: (b.paid + b.creditUsed) / 100, still_due: b.due / 100, status: b.payStatus })) },
      { name: "Payments", rows: shownPayments.map((p) => ({ received: iso(p.receivedAt), renter: p.renterName, method: p.method, reference: p.reference, amount: p.amount / 100, receipt: p.receiptNumber ?? "", status: p.status })) },
      { name: "Aging", rows: aging.rows.map((r) => ({ renter: r.renterName, units: r.units, current: r.current / 100, d1_30: r.d1_30 / 100, d31_60: r.d31_60 / 100, d61_90: r.d61_90 / 100, d90plus: r.d90plus / 100 })) },
      { name: "Rent roll", rows: roll.rows.map((r) => ({ unit: r.unitNumber, status: r.status, renter: r.renterName, area_m2: r.areaM2, monthly_rent: r.monthlyRent / 100 })) },
    ]);
  };

  return (
    <div className="stack">
      <Link href="/reports" className="crumb no-print"><Icon name="back" size={16} />{t("nav.reports")}</Link>
      <PageHeader title={t("me.title")} sub={t("me.note")} filters={<PeriodPicker value={period} onChange={setPeriod} />}
        actions={<>
          <button className="btn primary no-print" disabled={!ready} onClick={exportAll}><Icon name="download" size={16} />{t("me.exportAll")}</button>
          <button className="btn no-print" onClick={() => window.print()}><Icon name="print" size={16} />PDF</button>
        </>} />
      {!ready ? <Card><Skeleton lines={8} /></Card> : (
        <>
          <div className="kpis kpis-4">
            <Kpi tone="info" icon="reports" label={t("dash.billed")} unit="ETB" value={<Money bare v={dash.billed} />} />
            <Kpi tone="good" icon="payments" label={t("dash.applied")} unit="ETB" value={<Money bare v={dash.appliedToBills} />} sub={`${pct(dash.collectionRate)} ${t("dash.collected")}`} />
            <Kpi tone="bad" icon="bills" label={t("dash.outstanding")} unit="ETB" value={<Money bare v={dash.outstanding} />} />
            <Kpi icon="buildings" label={t("dash.occupancy")} value={pct(dash.occupancyRate)} sub={`${dash.occupied} / ${dash.units}`} />
          </div>
          <Card flush title={t("me.bills")}>
            <Table rows={bills} cols={[
              { head: t("bill.number"), cell: (b) => b.number || t("draft") }, { head: t("ag.unit"), cell: (b) => <strong>{b.unitNumber}</strong> }, { head: t("ag.renter"), cell: (b) => b.renterName },
              { head: t("total"), cell: (b) => <Money v={b.total + b.adjustments} />, right: true, money: true }, { head: t("bill.paid"), cell: (b) => <Money v={b.paid + b.creditUsed} />, right: true, money: true },
              { head: t("bill.due"), cell: (b) => (b.status === "issued" ? <Money v={b.due} strong /> : "—"), right: true, money: true }, { head: t("status"), cell: (b) => <StatusBadge status={b.payStatus} /> }]} />
          </Card>
          <Card flush title={t("me.payments")}>
            <Table rows={shownPayments} cols={[
              { head: t("pay.received"), cell: (p) => <DateText ms={p.receivedAt} /> }, { head: t("ag.renter"), cell: (p) => p.renterName }, { head: t("pay.method"), cell: (p) => t(p.method) },
              { head: t("pay.reference"), cell: (p) => p.reference }, { head: t("pay.receipt"), cell: (p) => p.receiptNumber ?? "—" },
              { head: t("amount"), cell: (p) => <Money v={p.amount} strong />, right: true, money: true }, { head: t("status"), cell: (p) => <StatusBadge status={p.status} /> }]} />
          </Card>
          <Card flush title={t("rep.aging")}>
            <Table rows={aging.rows.map((r) => ({ ...r, _id: r.renterId }))} cols={[
              { head: t("ag.renter"), cell: (r) => <strong>{r.renterName}</strong> }, { head: t("current"), cell: (r) => <Money v={r.current} />, right: true, money: true }, { head: t("d1_30"), cell: (r) => <Money v={r.d1_30} />, right: true, money: true },
              { head: t("d31_60"), cell: (r) => <Money v={r.d31_60} />, right: true, money: true }, { head: t("d61_90"), cell: (r) => <Money v={r.d61_90} />, right: true, money: true }, { head: t("d90plus"), cell: (r) => <Money v={r.d90plus} />, right: true, money: true }]} />
          </Card>
        </>
      )}
    </div>
  );
}
