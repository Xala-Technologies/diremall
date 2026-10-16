"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { BarChart, BuildingSelect, Card, DateText, Donut, Kpi, Money, PageHeader, PeriodPicker, Skeleton } from "@/components/ui";
import { formatPeriod, pct, shiftPeriod } from "@/lib/format";
import { usePeriod } from "@/lib/usePeriod";
import { useI18n } from "@/lib/i18n";

export default function Dashboard() {
  const { t, calendar, lang } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = usePeriod();
  const [building, setBuilding] = useState("");
  const b = (building || undefined) as any;
  const buildings = useQuery(api.properties.listBuildings, {});
  const d = useQuery(api.reports.dashboard, { period, buildingId: b });
  const trend = useQuery(api.reports.revenue, { fromPeriod: shiftPeriod(period, -5), toPeriod: period, buildingId: b });
  const aging = useQuery(api.reports.aging, { buildingId: b });
  const ending = useQuery(api.agreements.expiring, { withinDays: 60 });
  const att = d?.attention;
  const tasks: [string, number, string][] = att ? [
    ["att.draftInvoices", att.draftInvoices, "/billing"], ["att.paymentsToConfirm", att.paymentsToConfirm, "/payments"], ["att.paymentsToApply", att.paymentsToApply, "/payments"],
    ["att.agreementsInReview", att.agreementsInReview, "/agreements"], ["att.expiringAgreements", att.expiringAgreements, "/agreements"],
  ].filter(([, n]) => (n as number) > 0) as [string, number, string][] : [];

  const months = Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5));
  const chart = months.map((m) => { const r = trend?.rows.find((x) => x.period === m); return { label: formatPeriod(m, calendar, lang).replace(/ \d{4}$/, ""), a: r?.billed ?? 0, b: r?.collected ?? 0 }; });
  const owing = (aging?.rows ?? []).map((r) => ({ ...r, total: r.current + r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus })).sort((x, y) => y.total - x.total).slice(0, 5);
  const vacant = d ? d.units - d.occupied : 0;

  return (
    <div className="stack">
      <PageHeader title={t("dash.title")} filters={<>
        <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
        <PeriodPicker value={period} onChange={setPeriod} />
      </>} />

      {!d ? <div className="kpis kpis-4">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton lines={3} /></div>)}</div> : (
        <>
          {d.units === 0 && (
            <Card title={t("first.title")}>
              <ol className="steps"><li><Link href="/properties">{t("first.1")}</Link></li><li><Link href="/renters">{t("first.2")}</Link></li><li><Link href="/agreements">{t("first.3")}</Link></li></ol>
            </Card>
          )}

          <div className="kpis kpis-4">
            <Kpi tone="bad" icon="bills" label={t("dash.outstanding")} unit="ETB" value={<Money bare v={d.outstanding} />} sub={<>{t("dash.of")} {Math.round(d.billed / 100).toLocaleString()} {t("dash.billedShort")}</>} />
            <Kpi tone="good" icon="payments" label={t("dash.collectedTitle")} unit="ETB" value={<Money bare v={d.appliedToBills} />} sub={<>{pct(d.collectionRate)} · {t("dash.collectedKpi")}</>} />
            <Kpi tone="info" icon="reports" label={t("dash.billed")} unit="ETB" value={<Money bare v={d.billed} />} sub={<>{t("dash.confirmed")}: {Math.round(d.confirmedPayments / 100).toLocaleString()}</>} />
            <Kpi icon="buildings" label={t("dash.occupancy")} value={pct(d.occupancyRate)} sub={<>{d.occupied} / {d.units} {t("dash.occupancyNote")} · {d.buildings} {d.buildings === 1 ? "building" : "buildings"}</>} />
          </div>

          <div className="cols-2">
            <Card title={t("dash.trend")}>{trend ? <BarChart data={chart} labelA={t("dash.billed")} labelB={t("dash.collectedTitle")} /> : <Skeleton lines={5} />}</Card>
            <Card title={t("dash.occupancy")}>
              <div className="donut-wrap">
                <div style={{ position: "relative" }}>
                  <Donut size={150} parts={[{ value: d.occupied, color: "var(--viz)", label: t("occupied") }, { value: Math.max(0, vacant), color: "var(--line-2)", label: t("vacant") }]} />
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><span className="donut-n num">{pct(d.occupancyRate)}</span></div>
                </div>
                <div className="legend" style={{ flexDirection: "column", gap: 10 }}>
                  <span><i className="dot" style={{ background: "var(--viz)" }} />{t("occupied")}: <b className="num">{d.occupied}</b></span>
                  <span><i className="dot" style={{ background: "var(--line-2)" }} />{t("dash.vacant")}: <b className="num">{vacant}</b></span>
                </div>
              </div>
              <dl className="dl" style={{ marginTop: 14 }}>
                <div><dt>{t("dash.waiting")}</dt><dd><Money v={d.waitingToApply} /></dd></div>
                <div><dt>{t("dash.overdue")}</dt><dd style={{ color: d.overdue > 0 ? "var(--bad)" : undefined }}><Money v={d.overdue} /></dd></div>
                <div><dt>{t("dash.deposits")}</dt><dd><Money v={d.depositsHeld} /></dd></div>
              </dl>
            </Card>
          </div>

          <div className="cols-2">
            <Card title={t("dash.attention")}>
              {tasks.length === 0 ? <div className="allclear"><Icon name="check" />{t("dash.allClear")}</div> : (
                <div className="tasks">{tasks.map(([k, n, href]) => <Link key={k} href={href} className="task"><span className="count">{n}</span><span>{t(k)}</span><span className="chev"><Icon name="chevron" size={16} /></span></Link>)}</div>
              )}
            </Card>
            <Card title={t("dash.topOwing")}>
              {!aging ? <Skeleton lines={3} /> : owing.length === 0 ? <div className="allclear"><Icon name="check" />{t("dash.nobody")}</div> : (
                <div className="mini-list">{owing.map((r) => <a key={r.renterId} href="/reports" onClick={(e) => { e.preventDefault(); router.push("/reports"); }}><span><b>{r.renterName}</b><small>{r.units}</small></span><Money v={r.total} strong /></a>)}</div>
              )}
            </Card>
          </div>

          <Card title={t("dash.renewals")}>
            {!ending ? <Skeleton lines={2} /> : ending.length === 0 ? <p className="muted">{t("dash.noEnding")}</p> : (
              <div className="mini-list">{ending.slice(0, 6).map((e) => <Link key={e.agreementId} href={`/agreements/${e.agreementId}`}><span><b>{e.unitNumber}</b></span><span className="muted"><DateText ms={e.endsAt} /></span></Link>)}</div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
