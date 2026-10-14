"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BuildingSelect, Card, DateText, Money, PageHeader, StatusBadge, Table, Tabs } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { currentPeriod } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function Reports() {
  const { t } = useI18n(); const [tab, setTab] = useState<"rentRoll" | "vacancy" | "aging" | "revenue">("rentRoll"); const [building, setBuilding] = useState("");
  const buildings = useQuery(api.properties.listBuildings); const b = (building || undefined) as Id<"buildings"> | undefined;
  return (
    <div className="stack">
      <PageHeader title={t("nav.reports")}>
        <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
        <button className="btn no-print" onClick={() => window.print()}>{t("print")}</button>
      </PageHeader>
      <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["rentRoll", t("rep.rentRoll")], ["vacancy", t("rep.vacancy")], ["aging", t("rep.aging")], ["revenue", t("rep.revenue")]]} />
      {tab === "rentRoll" && <RentRoll b={b} />}{tab === "vacancy" && <Vacancy b={b} />}{tab === "aging" && <Aging b={b} />}{tab === "revenue" && <Revenue b={b} />}
    </div>
  );
}

const Export = ({ onClick }: { onClick: () => void }) => { const { t } = useI18n(); return <button className="btn sm no-print" onClick={onClick}>{t("export")} CSV</button>; };

function RentRoll({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.rentRoll, { buildingId: b });
  return <Card title={t("rep.rentRoll")} actions={<Export onClick={() => d && downloadCsv("rent-roll.csv", d.rows.map((r) => ({ unit: r.unitNumber, category: r.category, area_m2: r.areaM2, status: r.status, renter: r.renterName, start: r.startsAt ? new Date(r.startsAt).toISOString().slice(0, 10) : "", end: r.endsAt ? new Date(r.endsAt).toISOString().slice(0, 10) : "", monthly_rent: r.monthlyRent / 100 })))} />}>
    <Table rows={d?.rows.map((r, i) => ({ ...r, _id: String(i) }))} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong> }, { head: t("prop.category"), cell: (r) => t(r.category) }, { head: t("prop.area"), cell: (r) => r.areaM2, right: true },
      { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> }, { head: t("ag.renter"), cell: (r) => r.renterName }, { head: t("ag.end"), cell: (r) => <DateText ms={r.endsAt} /> },
      { head: t("rent"), cell: (r) => <Money v={r.monthlyRent} />, right: true, money: true }]} />
    {d && <p style={{ textAlign: "right" }}>{t("total")}: <Money v={d.totalMonthlyRent} strong /></p>}
  </Card>;
}

function Vacancy({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.vacancy, { buildingId: b });
  return <Card title={t("rep.vacancy")} actions={<Export onClick={() => d && downloadCsv("vacancy.csv", d.rows.map((r) => ({ unit: r.unitNumber, category: r.category, area_m2: r.areaM2, status: r.status, potential_rent: r.potentialRent / 100 })))} />}>
    <Table rows={d?.rows.map((r, i) => ({ ...r, _id: String(i) }))} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong> }, { head: t("prop.category"), cell: (r) => t(r.category) }, { head: t("prop.area"), cell: (r) => r.areaM2, right: true },
      { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> }, { head: t("rent"), cell: (r) => <Money v={r.potentialRent} />, right: true, money: true }]} />
    {d && <p style={{ textAlign: "right" }}>{t("total")}: <Money v={d.totalPotentialRent} strong /></p>}
  </Card>;
}

function Aging({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.aging, { buildingId: b });
  const cols = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
  return <Card title={t("rep.aging")} actions={<Export onClick={() => d && downloadCsv("aging.csv", d.rows.map((r) => ({ renter: r.renterName, units: r.units, ...Object.fromEntries(cols.map((c) => [c, r[c] / 100])) })))} />}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.renterId }))} cols={[
      { head: t("ag.renter"), cell: (r) => <strong>{r.renterName}</strong> }, { head: t("ag.unit"), cell: (r) => r.units },
      ...cols.map((c) => ({ head: t(c), cell: (r: NonNullable<typeof d>["rows"][number]) => (r[c] ? <Money v={r[c]} /> : "—"), right: true, money: true }))]} />
    {d && <p className="row" style={{ justifyContent: "flex-end" }}>{cols.map((c) => <span key={c}>{t(c)} <Money v={d.totals[c]} strong /></span>)}</p>}
  </Card>;
}

function Revenue({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const [from, setFrom] = useState(`${new Date().getUTCFullYear()}-01`); const [to, setTo] = useState(currentPeriod());
  const d = useQuery(api.reports.revenue, { fromPeriod: from, toPeriod: to, buildingId: b });
  return <Card title={t("rep.revenue")} actions={<><input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /><input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
    <Export onClick={() => d && downloadCsv("revenue.csv", d.rows.map((r) => ({ period: r.period, billed: r.billed / 100, collected: r.collected / 100, outstanding: r.outstanding / 100 })))} /></>}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.period }))} cols={[
      { head: t("period"), cell: (r) => r.period }, { head: t("dash.billed"), cell: (r) => <Money v={r.billed} />, right: true, money: true }, { head: "Collected", cell: (r) => <Money v={r.collected} />, right: true, money: true }, { head: t("outstanding"), cell: (r) => <Money v={r.outstanding} />, right: true, money: true }]} />
    {d && <p className="row" style={{ justifyContent: "flex-end" }}><span>{t("dash.billed")} <Money v={d.totals.billed} strong /></span><span>Collected <Money v={d.totals.collected} strong /></span><span>{t("outstanding")} <Money v={d.totals.outstanding} strong /></span></p>}
    <p className="muted">{t("rep.collectedNote")}</p>
  </Card>;
}
