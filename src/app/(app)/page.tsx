"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { BuildingSelect, Card, Money, PageHeader, PeriodPicker, Stat } from "@/components/ui";
import { currentPeriod, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function Dashboard() {
  const { t } = useI18n();
  const [period, setPeriod] = useState(currentPeriod());
  const [building, setBuilding] = useState("");
  const buildings = useQuery(api.properties.listBuildings);
  const d = useQuery(api.reports.dashboard, { period, buildingId: (building || undefined) as any });
  const att = d?.attention;
  const items: [string, number, string][] = att ? [
    ["att.draftInvoices", att.draftInvoices, "/billing"], ["att.paymentsToConfirm", att.paymentsToConfirm, "/payments"], ["att.paymentsToApply", att.paymentsToApply, "/payments"],
    ["att.agreementsInReview", att.agreementsInReview, "/agreements"], ["att.expiringAgreements", att.expiringAgreements, "/agreements"],
  ] : [];
  return (
    <div className="stack">
      <PageHeader title={t("nav.dashboard")}>
        <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHeader>
      {!d ? <p className="muted">{t("loading")}</p> : (
        <>
          <div className="grid">
            <Stat label={t("dash.occupancy")} value={pct(d.occupancyRate)} sub={`${d.occupied} / ${d.units} ${t("dash.units")}`} />
            <Stat label={t("dash.billed")} value={<Money v={d.billed} />} />
            <Stat label={t("dash.confirmed")} value={<Money v={d.confirmedPayments} />} />
            <Stat label={t("dash.applied")} value={<Money v={d.appliedToBills} />} sub={`${t("dash.waiting")}: ${(d.waitingToApply / 100).toLocaleString()}`} />
            <Stat label={t("dash.outstanding")} value={<Money v={d.outstanding} />} tone={d.outstanding > 0 ? "bad" : "good"} />
            <Stat label={t("dash.overdue")} value={<Money v={d.overdue} />} tone={d.overdue > 0 ? "bad" : undefined} />
            <Stat label={t("dash.deposits")} value={<Money v={d.depositsHeld} />} />
          </div>
          <Card title={t("dash.collection")}>
            <div className="bar" role="img" aria-label={pct(d.collectionRate)}><i style={{ width: pct(d.collectionRate) }} /></div>
            <p className="muted">{pct(d.collectionRate)} — {t("rep.collectedNote")}</p>
          </Card>
          <Card title={t("dash.attention")}>
            {items.every(([, n]) => n === 0) ? <p className="muted">—</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {items.filter(([, n]) => n > 0).map(([k, n, href]) => <li key={k}><Link href={href}>{t(k)}</Link>: <strong>{n}</strong></li>)}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
