"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, BuildingSelect, Card, DateText, ExportMenu, Field, Kpi, Money, PageHeader, Skeleton, StatusBadge, Table, Tabs } from "@/components/ui";
import { BarChart } from "@/components/ui";
import { Columns, HBars, Ring, SERIES, StackBar, Trend, compact } from "@/components/charts";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { currentPeriod } from "@/lib/format";
import { pct, periodText } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const etb = (v: number) => <Money bare v={v} />;
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);
/** Group rows by a key and add up a value, for the "by category / by building" charts. */
const group = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => { const m = new Map<string, number>(); for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r)); return [...m].map(([label, value]) => ({ label, value })); };
const Charts = ({ children }: { children: React.ReactNode }) => <div className="cols-2">{children}</div>;
const Strip = ({ children }: { children: React.ReactNode }) => <div className="kpis kpis-4">{children}</div>;
const Loading = () => <Strip>{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton lines={3} /></div>)}</Strip>;

export default function Reports() {
  const { t } = useI18n(); const [tab, setTab] = useState<"rentRoll" | "vacancy" | "aging" | "revenue" | "ledger" | "expiry" | "deposits">("rentRoll"); const [building, setBuilding] = useState("");
  const buildings = useQuery(api.properties.listBuildings); const b = (building || undefined) as Id<"buildings"> | undefined;
  return (
    <div className="stack">
      <PageHeader title={t("nav.reports")} filters={<><BuildingSelect buildings={buildings} value={building} onChange={setBuilding} /><Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["rentRoll", t("rep.rentRoll")], ["vacancy", t("rep.vacancy")], ["aging", t("rep.aging")], ["revenue", t("rep.revenue")], ["ledger", t("rep.ledger")], ["expiry", t("rep.expiry")], ["deposits", t("rep.deposits")]]} /></>}
        actions={<Link className="btn primary no-print" href="/reports/month-end">{t("rep.monthEnd")}</Link>} />
      {tab === "rentRoll" && <RentRoll b={b} buildings={buildings} />}{tab === "vacancy" && <Vacancy b={b} />}{tab === "aging" && <Aging b={b} />}{tab === "revenue" && <Revenue b={b} />}{tab === "ledger" && <Ledger />}{tab === "expiry" && <Expiry b={b} />}{tab === "deposits" && <Deposits b={b} />}
    </div>
  );
}


function RentRoll({ b, buildings }: { b?: Id<"buildings">; buildings?: { _id: string; name: string }[] }) {
  const { t } = useI18n(); const d = useQuery(api.reports.rentRoll, { buildingId: b });
  const rows = d?.rows ?? []; const occ = rows.filter((r) => r.status === "occupied"), vac = rows.filter((r) => r.status === "vacant"), other = rows.length - occ.length - vac.length;
  const one = !!b || (buildings?.length ?? 0) <= 1;
  const areaLet = sum(occ, (r) => r.areaM2), areaAll = sum(rows, (r) => r.areaM2);
  return <>
    {!d ? <Loading /> : <Strip>
      <Kpi tone="info" icon="payments" label={t("rep.k.monthlyRent")} unit="ETB" value={etb(d.totalMonthlyRent)} sub={`${t("rep.k.yearly")}: ${compact(d.totalMonthlyRent * 12)}`} />
      <Kpi tone="good" icon="buildings" label={t("dash.occupancy")} value={pct(rows.length ? occ.length / rows.length : 0)} sub={`${occ.length} / ${rows.length} ${t("rep.k.units")}`} />
      <Kpi icon="reports" label={t("rep.k.rentPerM2")} unit="ETB" value={areaLet ? Math.round(d.totalMonthlyRent / 100 / areaLet).toLocaleString() : "0"} sub={`${areaLet.toLocaleString()} m² ${t("rep.k.let")}`} />
      <Kpi tone={vac.length ? "warn" : "good"} icon="buildings" label={t("rep.k.vacantUnits")} value={vac.length} sub={`${(areaAll - areaLet).toLocaleString()} m² ${t("rep.k.notLet")}`} />
    </Strip>}
    {d && <Charts>
      <Card title={t("rep.c.occupancy")}><Ring caption={t("dash.occupancy")} center={pct(rows.length ? occ.length / rows.length : 0)} parts={[{ label: t("occupied"), value: occ.length, color: SERIES[0] }, { label: t("vacant"), value: vac.length, color: SERIES[4] }, ...(other > 0 ? [{ label: t("maintenance"), value: other, color: SERIES[2] }] : [])]} /></Card>
      <Card title={one ? t("rep.c.rentByCategory") : t("rep.c.rentByBuilding")}>
        <HBars items={(one ? group(rows, (r) => t(r.category), (r) => r.monthlyRent) : group(rows, (r) => buildings?.find((x) => x._id === r.buildingId)?.name ?? "", (r) => r.monthlyRent)).filter((x) => x.label)} />
        {!one && <><h3 className="mini-h">{t("rep.c.rentByCategory")}</h3><HBars items={group(rows, (r) => t(r.category), (r) => r.monthlyRent)} /></>}
      </Card>
    </Charts>}
    <Card title={t("rep.rentRoll")} actions={<ExportMenu name="rent-roll" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, category: r.category, area_m2: r.areaM2, status: r.status, renter: r.renterName, start: r.startsAt ? new Date(r.startsAt).toISOString().slice(0, 10) : "", end: r.endsAt ? new Date(r.endsAt).toISOString().slice(0, 10) : "", monthly_rent: r.monthlyRent / 100 })) : []} />}>
    <Table rows={d?.rows.map((r, i) => ({ ...r, _id: String(i) }))} empty={t("empty.rep.rentRoll")} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("prop.category"), cell: (r) => t(r.category), sort: (r) => r.category }, { head: t("prop.area"), cell: (r) => r.areaM2, right: true, sort: (r) => r.areaM2 },
      { head: t("status"), cell: (r) => <StatusBadge status={r.status} />, sort: (r) => r.status }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName }, { head: t("ag.end"), cell: (r) => <DateText ms={r.endsAt} />, sort: (r) => r.endsAt },
      { head: t("rent"), cell: (r) => <Money v={r.monthlyRent} />, right: true, money: true, sort: (r) => r.monthlyRent }]} />
    {d && <p style={{ textAlign: "right" }}>{t("total")}: <Money v={d.totalMonthlyRent} strong /></p>}
  </Card></>;
}

function Vacancy({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.vacancy, { buildingId: b }); const all = useQuery(api.reports.rentRoll, { buildingId: b });
  const rows = d?.rows ?? []; const vac = rows.filter((r) => r.status === "vacant");
  return <>
    {!d ? <Loading /> : <Strip>
      <Kpi tone={vac.length ? "warn" : "good"} icon="buildings" label={t("rep.k.vacantUnits")} value={vac.length} sub={all ? `${pct(all.rows.length ? vac.length / all.rows.length : 0)} ${t("rep.k.ofUnits")}` : undefined} />
      <Kpi tone="warn" icon="payments" label={t("rep.k.potential")} unit="ETB" value={etb(d.totalPotentialRent)} sub={`${t("rep.k.yearly")}: ${compact(d.totalPotentialRent * 12)}`} />
      <Kpi icon="reports" label={t("rep.k.vacantArea")} value={sum(vac, (r) => r.areaM2).toLocaleString()} sub="m²" />
      <Kpi icon="buildings" label={t("rep.k.other")} value={rows.length - vac.length} sub={t("rep.k.otherNote")} />
    </Strip>}
    {d && vac.length > 0 && <Charts>
      <Card title={t("rep.c.vacantByCategory")}><HBars items={group(vac, (r) => t(r.category), (r) => r.potentialRent)} /></Card>
      <Card title={t("rep.c.vacantArea")}><HBars format={(n) => `${n.toLocaleString()} m²`} items={group(vac, (r) => t(r.category), (r) => r.areaM2)} /></Card>
    </Charts>}
    <Card title={t("rep.vacancy")} actions={<ExportMenu name="vacancy" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, category: r.category, area_m2: r.areaM2, status: r.status, potential_rent: r.potentialRent / 100 })) : []} />}>
    <Table rows={d?.rows.map((r, i) => ({ ...r, _id: String(i) }))} empty={t("empty.rep.vacancy")} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong> }, { head: t("prop.category"), cell: (r) => t(r.category) }, { head: t("prop.area"), cell: (r) => r.areaM2, right: true },
      { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> }, { head: t("rent"), cell: (r) => <Money v={r.potentialRent} />, right: true, money: true }]} />
    {d && <p style={{ textAlign: "right" }}>{t("total")}: <Money v={d.totalPotentialRent} strong /></p>}
  </Card></>;
}

function Aging({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.aging, { buildingId: b });
  const cols = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
  const total = d ? sum([...cols], (c) => d.totals[c]) : 0; const overdue = d ? total - d.totals.current : 0;
  const colors = [SERIES[1], SERIES[0], SERIES[2], "var(--ds-color-warning-text-default)", SERIES[3]];
  return <>
    {!d ? <Loading /> : <Strip>
      <Kpi tone="bad" icon="bills" label={t("outstanding")} unit="ETB" value={etb(total)} sub={`${d.rows.length} ${t("rep.k.renters")}`} />
      <Kpi tone={overdue ? "warn" : "good"} icon="alert" label={t("rep.k.overdue")} unit="ETB" value={etb(overdue)} sub={`${pct(total ? overdue / total : 0)} ${t("rep.k.ofOutstanding")}`} />
      <Kpi tone={d.totals.d90plus ? "bad" : "good"} icon="alert" label={t("rep.k.over90")} unit="ETB" value={etb(d.totals.d90plus)} sub={`${pct(total ? d.totals.d90plus / total : 0)} ${t("rep.k.ofOutstanding")}`} />
      <Kpi icon="renters" label={t("rep.k.largest")} unit="ETB" value={etb(Math.max(0, ...d.rows.map((r) => cols.reduce((a, c) => a + r[c], 0))))} sub={[...d.rows].sort((x, y) => cols.reduce((a, c) => a + y[c], 0) - cols.reduce((a, c) => a + x[c], 0))[0]?.renterName} />
    </Strip>}
    {d && total > 0 && <Charts>
      <Card title={t("rep.c.ageing")}><StackBar parts={cols.map((c, i) => ({ label: t(c), value: d.totals[c], color: colors[i] }))} /></Card>
      <Card title={t("rep.c.topDebtors")}><HBars items={d.rows.map((r) => ({ label: r.renterName, sub: r.units, value: cols.reduce((a, c) => a + r[c], 0), color: r.d90plus ? SERIES[3] : r.d61_90 || r.d31_60 ? SERIES[2] : SERIES[0] }))} /></Card>
    </Charts>}
    <Card title={t("rep.aging")} actions={<ExportMenu name="aging" rows={d ? d.rows.map((r) => ({ renter: r.renterName, units: r.units, ...Object.fromEntries(cols.map((c) => [c, r[c] / 100])) })) : []} />}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.renterId }))} empty={t("empty.rep.aging")} cols={[
      { head: t("ag.renter"), cell: (r) => <strong>{r.renterName}</strong> }, { head: t("ag.unit"), cell: (r) => r.units },
      ...cols.map((c) => ({ head: t(c), cell: (r: NonNullable<typeof d>["rows"][number]) => (r[c] ? <Money v={r[c]} /> : "—"), right: true, money: true }))]} />
    {d && <p className="row" style={{ justifyContent: "flex-end" }}>{cols.map((c) => <span key={c}>{t(c)} <Money v={d.totals[c]} strong /></span>)}</p>}
  </Card></>;
}

function Revenue({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const [from, setFrom] = useState(`${new Date().getUTCFullYear()}-01`); const [to, setTo] = useState(currentPeriod());
  const d = useQuery(api.reports.revenue, { fromPeriod: from, toPeriod: to, buildingId: b });
  const rows = d?.rows ?? [];
  return <>
    {!d ? <Loading /> : <Strip>
      <Kpi tone="info" icon="reports" label={t("rep.k.billed")} unit="ETB" value={etb(d.totals.billed)} sub={`${rows.length} ${t("rep.k.months")}`} />
      <Kpi tone="good" icon="payments" label={t("rep.collected")} unit="ETB" value={etb(d.totals.collected)} sub={`${pct(d.totals.billed ? d.totals.collected / d.totals.billed : 0)} ${t("rep.k.ofBilled")}`} />
      <Kpi tone={d.totals.outstanding ? "bad" : "good"} icon="bills" label={t("outstanding")} unit="ETB" value={etb(d.totals.outstanding)} sub={`${pct(d.totals.billed ? d.totals.outstanding / d.totals.billed : 0)} ${t("rep.k.ofBilled")}`} />
      <Kpi icon="reports" label={t("rep.k.bestMonth")} unit="ETB" value={etb(Math.max(0, ...rows.map((x) => x.collected)))} sub={rows.length ? periodText([...rows].sort((x, y) => y.collected - x.collected)[0]!.period, t) : undefined} />
    </Strip>}
    {d && rows.length > 0 && <Charts>
      <Card title={t("rep.c.trend")}><BarChart data={rows.map((x) => ({ label: x.period.slice(2), a: x.billed, b: x.collected }))} labelA={t("rep.k.billed")} labelB={t("rep.collected")} /></Card>
      <Card title={t("rep.c.rate")}><Trend format={pct} points={rows.map((x) => ({ label: x.period.slice(2), value: x.billed ? Math.min(1, x.collected / x.billed) : 0 }))} /></Card>
    </Charts>}
    <Card title={t("rep.revenue")} actions={<><input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /><input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
    <ExportMenu name="revenue" rows={d ? d.rows.map((r) => ({ period: r.period, billed: r.billed / 100, collected: r.collected / 100, outstanding: r.outstanding / 100 })) : []} /></>}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.period }))} empty={t("empty.rep.revenue")} cols={[
      { head: t("period"), cell: (r) => periodText(r.period, t) }, { head: t("rep.k.billed"), cell: (r) => <Money v={r.billed} />, right: true, money: true }, { head: t("rep.collected"), cell: (r) => <Money v={r.collected} />, right: true, money: true }, { head: t("outstanding"), cell: (r) => <Money v={r.outstanding} />, right: true, money: true }]} />
    {d && <p className="row" style={{ justifyContent: "flex-end" }}><span>{t("rep.k.billed")} <Money v={d.totals.billed} strong /></span><span>{t("rep.collected")} <Money v={d.totals.collected} strong /></span><span>{t("outstanding")} <Money v={d.totals.outstanding} strong /></span></p>}
    <p className="muted">{t("rep.collectedNote")}</p>
  </Card></>;
}

function Ledger() {
  const { t } = useI18n();
  const renters = useQuery(api.renters.list, {});
  const [renterId, setRenterId] = useState("");
  const d = useQuery(api.reports.tenantLedger, renterId ? { renterId: renterId as Id<"renters"> } : "skip");
  const name = renters?.find((r) => r._id === renterId)?.name ?? "";
  const last = d?.[d.length - 1];
  return (<>
    {renterId && d && d.length > 0 && <>
      <Strip>
        <Kpi tone={last && last.balance > 0 ? "bad" : "good"} icon="bills" label={t("bill.due")} unit="ETB" value={etb(last?.balance ?? 0)} sub={name} />
        <Kpi tone="info" icon="reports" label={t("rep.k.charged")} unit="ETB" value={etb(sum(d, (x) => x.debit))} sub={`${d.filter((x) => x.debit).length} ${t("rep.k.entries")}`} />
        <Kpi tone="good" icon="payments" label={t("rep.k.paid")} unit="ETB" value={etb(sum(d, (x) => x.credit))} sub={`${d.filter((x) => x.credit).length} ${t("rep.k.entries")}`} />
        <Kpi icon="reports" label={t("rep.k.settled")} value={pct(sum(d, (x) => x.debit) ? Math.min(1, sum(d, (x) => x.credit) / sum(d, (x) => x.debit)) : 0)} sub={t("rep.k.ofCharged")} />
      </Strip>
      <Card title={t("rep.c.balanceOverTime")}><Trend points={d.map((x) => ({ label: new Date(x.at).toISOString().slice(0, 10), value: x.balance }))} /></Card>
    </>}
    <Card title={t("rep.ledger")} actions={<ExportMenu name={`statement-${name || "renter"}`} rows={d ? d.map((l) => ({ date: new Date(l.at).toISOString().slice(0, 10), type: l.kind, reference: l.ref, debit: l.debit / 100, credit: l.credit / 100, balance: l.balance / 100 })) : []} />}>
      <div className="row" style={{ marginBottom: 12 }}>
        <FilterSelect label={t("ag.renter")} value={renterId} onChange={setRenterId} options={[{ value: "", label: `${t("ag.renter")}…`, icon: <Users size={16} /> }, ...(renters ?? []).map((r) => ({ value: r._id, label: r.name, icon: <Users size={16} /> }))]} />
      </div>
      {renterId && <Table rows={d?.map((l, i) => ({ ...l, _id: String(i) }))} empty={t("empty.rep.ledger")} cols={[
        { head: t("date"), cell: (l) => <DateText ms={l.at} /> }, { head: t("status"), cell: (l) => l.kind }, { head: t("pay.reference"), cell: (l) => l.ref },
        { head: "Debit", cell: (l) => (l.debit ? <Money v={l.debit} /> : ""), right: true, money: true }, { head: "Credit", cell: (l) => (l.credit ? <Money v={l.credit} /> : ""), right: true, money: true },
        { head: t("bill.due"), cell: (l) => <Money v={l.balance} strong />, right: true, money: true }]} />}
    </Card></>
  );
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The renewal pipeline: leases ending soon, with the rent that would be lost and the deposit held. */
function Expiry({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const router = useRouter(); const [days, setDays] = useState("90");
  const d = useQuery(api.reports.leaseExpiry, { withinDays: Number(days), buildingId: b });
  const rows = d?.rows ?? [];
  const months = group(rows, (r) => (r.daysLeft < 0 ? "0" : iso(r.endsAt).slice(0, 7)), (r) => r.rent).sort((x, y) => x.label.localeCompare(y.label));
  return <>
    {!d ? <Loading /> : <Strip>
      <Kpi tone="info" icon="agreements" label={t("rep.k.leasesEnding")} value={d.totals.leases} sub={t("rep.withinDays").replace("{n}", days)} />
      <Kpi tone="warn" icon="payments" label={t("rep.rentAtStake")} unit="ETB" value={etb(d.totals.rent)} sub={`${t("rep.k.yearly")}: ${compact(d.totals.rent * 12)}`} />
      <Kpi icon="bills" label={t("rep.depositHeld")} unit="ETB" value={etb(sum(rows, (r) => r.deposit))} />
      <Kpi tone={d.totals.overdue ? "bad" : "good"} icon="alert" label={t("rep.pastEndTitle")} value={d.totals.overdue} sub={d.totals.overdue ? t("rep.k.needsAction") : t("rep.k.none")} />
    </Strip>}
    {d && rows.length > 0 && <Charts>
      <Card title={t("rep.c.endingByMonth")}><Columns items={months.map((m) => ({ label: m.label === "0" ? t("rep.k.pastEnd") : m.label.slice(2), value: m.value, color: m.label === "0" ? SERIES[3] : undefined }))} /></Card>
      <Card title={t("rep.c.biggestRent")}><HBars items={rows.map((r) => ({ label: r.renterName, sub: r.unitNumber, value: r.rent, color: r.daysLeft < 0 ? SERIES[3] : r.daysLeft <= 60 ? SERIES[2] : SERIES[0] }))} /></Card>
    </Charts>}
    <Card title={t("rep.expiry")} actions={<><FilterSelect label={t("rep.within")} value={days} onChange={setDays} options={["30", "60", "90", "180", "365"].map((n) => ({ value: n, label: t("rep.withinDays").replace("{n}", n), icon: <Users size={16} /> }))} />
    <ExportMenu name="lease-expiry" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, renter: r.renterName, ends: iso(r.endsAt), days_left: r.daysLeft, monthly_rent: r.rent / 100, deposit_held: r.deposit / 100 })) : []} /></>}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.agreementId }))} empty={t("empty.rep.expiry")} onRow={(r) => router.push(`/agreements/${r.agreementId}`)} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName },
      { head: t("ag.end"), cell: (r) => <DateText ms={r.endsAt} />, sort: (r) => r.endsAt },
      { head: t("rep.timeLeft"), cell: (r) => <Badge tone={r.daysLeft < 0 ? "bad" : r.daysLeft <= 60 ? "warn" : "muted"}>{r.daysLeft < 0 ? t("rep.pastEnd").replace("{n}", String(-r.daysLeft)) : t("ag.daysLeft").replace("{n}", String(r.daysLeft))}</Badge>, sort: (r) => r.daysLeft },
      { head: t("ag.rentMonth"), cell: (r) => <Money v={r.rent} />, right: true, money: true, sort: (r) => r.rent }, { head: t("rep.depositHeld"), cell: (r) => <Money v={r.deposit} />, right: true, money: true },
    ]} />
    {d && d.rows.length > 0 && <p style={{ textAlign: "right" }}>{d.totals.leases} {t("rep.leases")} · {t("rep.rentAtStake")}: <Money v={d.totals.rent} strong />{d.totals.overdue > 0 ? ` · ${d.totals.overdue} ${t("rep.pastEndN")}` : ""}</p>}
  </Card></>;
}

/** Deposits by lease, with refunds due for ended leases shown first. */
function Deposits({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const router = useRouter(); const d = useQuery(api.reports.deposits, { buildingId: b });
  const rows = d?.rows ?? [];
  return <>
    {!d ? <Loading /> : <Strip>
      <Kpi tone="info" icon="bills" label={t("rep.stillHeld")} unit="ETB" value={etb(d.totals.held)} sub={`${rows.length} ${t("rep.leases")}`} />
      <Kpi tone={d.totals.toReturn ? "warn" : "good"} icon="payments" label={t("rep.toReturn")} unit="ETB" value={etb(d.totals.toReturn)} sub={`${rows.filter((r) => r.refundDue).length} ${t("rep.k.refundsDue")}`} />
      <Kpi tone={d.totals.shortfall ? "bad" : "good"} icon="alert" label={t("rep.shortfall")} unit="ETB" value={etb(d.totals.shortfall)} sub={t("rep.k.shortfallNote")} />
      <Kpi icon="reports" label={t("rep.k.required")} unit="ETB" value={etb(sum(rows, (r) => r.required))} sub={`${pct(sum(rows, (r) => r.required) ? Math.min(1, sum(rows, (r) => r.available) / sum(rows, (r) => r.required)) : 0)} ${t("rep.k.covered")}`} />
    </Strip>}
    {d && rows.length > 0 && <Charts>
      <Card title={t("rep.c.depositMix")}><Ring caption={t("rep.k.received")} center={compact(sum(rows, (r) => r.held))} format={compact} parts={[{ label: t("dep.available"), value: sum(rows, (r) => r.available), color: SERIES[0] }, { label: t("rep.deducted"), value: sum(rows, (r) => r.deducted), color: SERIES[2] }, { label: t("dep.refunded"), value: sum(rows, (r) => r.refunded), color: SERIES[1] }]} /></Card>
      <Card title={t("rep.c.biggestDeposits")}><HBars items={rows.map((r) => ({ label: r.renterName, sub: r.unitNumber, value: r.available }))} /></Card>
    </Charts>}
    <Card title={t("rep.deposits")} actions={<ExportMenu name="deposits" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, renter: r.renterName, status: r.status, required: r.required / 100, held: r.held / 100, deducted: r.deducted / 100, refunded: r.refunded / 100, still_held: r.available / 100, refund_due: r.refundDue ? "yes" : "" })) : []} />}>
    {d && <div className="acct"><div><span>{t("rep.stillHeld")}</span><b className="num"><Money v={d.totals.held} /></b></div><div className={d.totals.toReturn ? "warn" : ""}><span>{t("rep.toReturn")}</span><b className="num"><Money v={d.totals.toReturn} /></b></div><div className={d.totals.shortfall ? "bad" : ""}><span>{t("rep.shortfall")}</span><b className="num"><Money v={d.totals.shortfall} /></b></div></div>}
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.agreementId }))} empty={t("empty.rep.deposits")} onRow={(r) => router.push(`/agreements/${r.agreementId}`)} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName },
      { head: t("status"), cell: (r) => r.refundDue ? <Badge tone="warn">{t("rep.refundDue")}</Badge> : <StatusBadge status={r.status} /> },
      { head: t("dep.required"), cell: (r) => <Money v={r.required} />, right: true, money: true }, { head: t("dep.held"), cell: (r) => <Money v={r.held} />, right: true, money: true },
      { head: t("rep.deducted"), cell: (r) => <Money v={r.deducted} />, right: true, money: true, hide: true }, { head: t("dep.refunded"), cell: (r) => <Money v={r.refunded} />, right: true, money: true, hide: true },
      { head: t("dep.available"), cell: (r) => <Money v={r.available} strong />, right: true, money: true, sort: (r) => r.available },
    ]} />
  </Card></>;
}
