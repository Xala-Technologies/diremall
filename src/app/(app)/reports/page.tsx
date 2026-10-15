"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, BuildingSelect, Card, DateText, ExportMenu, Field, Money, PageHeader, StatusBadge, Table, Tabs } from "@/components/ui";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { currentPeriod } from "@/lib/format";
import { periodText } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function Reports() {
  const { t } = useI18n(); const [tab, setTab] = useState<"rentRoll" | "vacancy" | "aging" | "revenue" | "ledger" | "expiry" | "deposits">("rentRoll"); const [building, setBuilding] = useState("");
  const buildings = useQuery(api.properties.listBuildings); const b = (building || undefined) as Id<"buildings"> | undefined;
  return (
    <div className="stack">
      <PageHeader title={t("nav.reports")} filters={<><BuildingSelect buildings={buildings} value={building} onChange={setBuilding} /><Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["rentRoll", t("rep.rentRoll")], ["vacancy", t("rep.vacancy")], ["aging", t("rep.aging")], ["revenue", t("rep.revenue")], ["ledger", t("rep.ledger")], ["expiry", t("rep.expiry")], ["deposits", t("rep.deposits")]]} /></>}
        actions={<Link className="btn primary no-print" href="/reports/month-end">{t("rep.monthEnd")}</Link>} />
      {tab === "rentRoll" && <RentRoll b={b} />}{tab === "vacancy" && <Vacancy b={b} />}{tab === "aging" && <Aging b={b} />}{tab === "revenue" && <Revenue b={b} />}{tab === "ledger" && <Ledger />}{tab === "expiry" && <Expiry b={b} />}{tab === "deposits" && <Deposits b={b} />}
    </div>
  );
}


function RentRoll({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.rentRoll, { buildingId: b });
  return <Card title={t("rep.rentRoll")} actions={<ExportMenu name="rent-roll" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, category: r.category, area_m2: r.areaM2, status: r.status, renter: r.renterName, start: r.startsAt ? new Date(r.startsAt).toISOString().slice(0, 10) : "", end: r.endsAt ? new Date(r.endsAt).toISOString().slice(0, 10) : "", monthly_rent: r.monthlyRent / 100 })) : []} />}>
    <Table rows={d?.rows.map((r, i) => ({ ...r, _id: String(i) }))} empty={t("empty.rep.rentRoll")} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("prop.category"), cell: (r) => t(r.category), sort: (r) => r.category }, { head: t("prop.area"), cell: (r) => r.areaM2, right: true, sort: (r) => r.areaM2 },
      { head: t("status"), cell: (r) => <StatusBadge status={r.status} />, sort: (r) => r.status }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName }, { head: t("ag.end"), cell: (r) => <DateText ms={r.endsAt} />, sort: (r) => r.endsAt },
      { head: t("rent"), cell: (r) => <Money v={r.monthlyRent} />, right: true, money: true, sort: (r) => r.monthlyRent }]} />
    {d && <p style={{ textAlign: "right" }}>{t("total")}: <Money v={d.totalMonthlyRent} strong /></p>}
  </Card>;
}

function Vacancy({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.vacancy, { buildingId: b });
  return <Card title={t("rep.vacancy")} actions={<ExportMenu name="vacancy" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, category: r.category, area_m2: r.areaM2, status: r.status, potential_rent: r.potentialRent / 100 })) : []} />}>
    <Table rows={d?.rows.map((r, i) => ({ ...r, _id: String(i) }))} empty={t("empty.rep.vacancy")} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong> }, { head: t("prop.category"), cell: (r) => t(r.category) }, { head: t("prop.area"), cell: (r) => r.areaM2, right: true },
      { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> }, { head: t("rent"), cell: (r) => <Money v={r.potentialRent} />, right: true, money: true }]} />
    {d && <p style={{ textAlign: "right" }}>{t("total")}: <Money v={d.totalPotentialRent} strong /></p>}
  </Card>;
}

function Aging({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const d = useQuery(api.reports.aging, { buildingId: b });
  const cols = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
  return <Card title={t("rep.aging")} actions={<ExportMenu name="aging" rows={d ? d.rows.map((r) => ({ renter: r.renterName, units: r.units, ...Object.fromEntries(cols.map((c) => [c, r[c] / 100])) })) : []} />}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.renterId }))} empty={t("empty.rep.aging")} cols={[
      { head: t("ag.renter"), cell: (r) => <strong>{r.renterName}</strong> }, { head: t("ag.unit"), cell: (r) => r.units },
      ...cols.map((c) => ({ head: t(c), cell: (r: NonNullable<typeof d>["rows"][number]) => (r[c] ? <Money v={r[c]} /> : "—"), right: true, money: true }))]} />
    {d && <p className="row" style={{ justifyContent: "flex-end" }}>{cols.map((c) => <span key={c}>{t(c)} <Money v={d.totals[c]} strong /></span>)}</p>}
  </Card>;
}

function Revenue({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const [from, setFrom] = useState(`${new Date().getUTCFullYear()}-01`); const [to, setTo] = useState(currentPeriod());
  const d = useQuery(api.reports.revenue, { fromPeriod: from, toPeriod: to, buildingId: b });
  return <Card title={t("rep.revenue")} actions={<><input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /><input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
    <ExportMenu name="revenue" rows={d ? d.rows.map((r) => ({ period: r.period, billed: r.billed / 100, collected: r.collected / 100, outstanding: r.outstanding / 100 })) : []} /></>}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.period }))} empty={t("empty.rep.revenue")} cols={[
      { head: t("period"), cell: (r) => periodText(r.period, t) }, { head: t("dash.billed"), cell: (r) => <Money v={r.billed} />, right: true, money: true }, { head: "Collected", cell: (r) => <Money v={r.collected} />, right: true, money: true }, { head: t("outstanding"), cell: (r) => <Money v={r.outstanding} />, right: true, money: true }]} />
    {d && <p className="row" style={{ justifyContent: "flex-end" }}><span>{t("dash.billed")} <Money v={d.totals.billed} strong /></span><span>Collected <Money v={d.totals.collected} strong /></span><span>{t("outstanding")} <Money v={d.totals.outstanding} strong /></span></p>}
    <p className="muted">{t("rep.collectedNote")}</p>
  </Card>;
}

function Ledger() {
  const { t } = useI18n();
  const renters = useQuery(api.renters.list, {});
  const [renterId, setRenterId] = useState("");
  const d = useQuery(api.reports.tenantLedger, renterId ? { renterId: renterId as Id<"renters"> } : "skip");
  const name = renters?.find((r) => r._id === renterId)?.name ?? "";
  return (
    <Card title={t("rep.ledger")} actions={<ExportMenu name={`statement-${name || "renter"}`} rows={d ? d.map((l) => ({ date: new Date(l.at).toISOString().slice(0, 10), type: l.kind, reference: l.ref, debit: l.debit / 100, credit: l.credit / 100, balance: l.balance / 100 })) : []} />}>
      <div className="row" style={{ marginBottom: 12 }}>
        <FilterSelect label={t("ag.renter")} value={renterId} onChange={setRenterId} options={[{ value: "", label: `${t("ag.renter")}…`, icon: <Users size={16} /> }, ...(renters ?? []).map((r) => ({ value: r._id, label: r.name, icon: <Users size={16} /> }))]} />
      </div>
      {renterId && <Table rows={d?.map((l, i) => ({ ...l, _id: String(i) }))} empty={t("empty.rep.ledger")} cols={[
        { head: t("date"), cell: (l) => <DateText ms={l.at} /> }, { head: t("status"), cell: (l) => l.kind }, { head: t("pay.reference"), cell: (l) => l.ref },
        { head: "Debit", cell: (l) => (l.debit ? <Money v={l.debit} /> : ""), right: true, money: true }, { head: "Credit", cell: (l) => (l.credit ? <Money v={l.credit} /> : ""), right: true, money: true },
        { head: t("bill.due"), cell: (l) => <Money v={l.balance} strong />, right: true, money: true }]} />}
    </Card>
  );
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The renewal pipeline: leases ending soon, with the rent that would be lost and the deposit held. */
function Expiry({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const router = useRouter(); const [days, setDays] = useState("90");
  const d = useQuery(api.reports.leaseExpiry, { withinDays: Number(days), buildingId: b });
  return <Card title={t("rep.expiry")} actions={<><FilterSelect label={t("rep.within")} value={days} onChange={setDays} options={["30", "60", "90", "180", "365"].map((n) => ({ value: n, label: t("rep.withinDays").replace("{n}", n), icon: <Users size={16} /> }))} />
    <ExportMenu name="lease-expiry" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, renter: r.renterName, ends: iso(r.endsAt), days_left: r.daysLeft, monthly_rent: r.rent / 100, deposit_held: r.deposit / 100 })) : []} /></>}>
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.agreementId }))} empty={t("empty.rep.expiry")} onRow={(r) => router.push(`/agreements/${r.agreementId}`)} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName },
      { head: t("ag.end"), cell: (r) => <DateText ms={r.endsAt} />, sort: (r) => r.endsAt },
      { head: t("rep.timeLeft"), cell: (r) => <Badge tone={r.daysLeft < 0 ? "bad" : r.daysLeft <= 60 ? "warn" : "muted"}>{r.daysLeft < 0 ? t("rep.pastEnd").replace("{n}", String(-r.daysLeft)) : t("ag.daysLeft").replace("{n}", String(r.daysLeft))}</Badge>, sort: (r) => r.daysLeft },
      { head: t("ag.rentMonth"), cell: (r) => <Money v={r.rent} />, right: true, money: true, sort: (r) => r.rent }, { head: t("rep.depositHeld"), cell: (r) => <Money v={r.deposit} />, right: true, money: true },
    ]} />
    {d && d.rows.length > 0 && <p style={{ textAlign: "right" }}>{d.totals.leases} {t("rep.leases")} · {t("rep.rentAtStake")}: <Money v={d.totals.rent} strong />{d.totals.overdue > 0 ? ` · ${d.totals.overdue} ${t("rep.pastEndN")}` : ""}</p>}
  </Card>;
}

/** Deposits by lease, with refunds due for ended leases shown first. */
function Deposits({ b }: { b?: Id<"buildings"> }) {
  const { t } = useI18n(); const router = useRouter(); const d = useQuery(api.reports.deposits, { buildingId: b });
  return <Card title={t("rep.deposits")} actions={<ExportMenu name="deposits" rows={d ? d.rows.map((r) => ({ unit: r.unitNumber, renter: r.renterName, status: r.status, required: r.required / 100, held: r.held / 100, deducted: r.deducted / 100, refunded: r.refunded / 100, still_held: r.available / 100, refund_due: r.refundDue ? "yes" : "" })) : []} />}>
    {d && <div className="acct"><div><span>{t("rep.stillHeld")}</span><b className="num"><Money v={d.totals.held} /></b></div><div className={d.totals.toReturn ? "warn" : ""}><span>{t("rep.toReturn")}</span><b className="num"><Money v={d.totals.toReturn} /></b></div><div className={d.totals.shortfall ? "bad" : ""}><span>{t("rep.shortfall")}</span><b className="num"><Money v={d.totals.shortfall} /></b></div></div>}
    <Table rows={d?.rows.map((r) => ({ ...r, _id: r.agreementId }))} empty={t("empty.rep.deposits")} onRow={(r) => router.push(`/agreements/${r.agreementId}`)} cols={[
      { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName },
      { head: t("status"), cell: (r) => r.refundDue ? <Badge tone="warn">{t("rep.refundDue")}</Badge> : <StatusBadge status={r.status} /> },
      { head: t("dep.required"), cell: (r) => <Money v={r.required} />, right: true, money: true }, { head: t("dep.held"), cell: (r) => <Money v={r.held} />, right: true, money: true },
      { head: t("rep.deducted"), cell: (r) => <Money v={r.deducted} />, right: true, money: true, hide: true }, { head: t("dep.refunded"), cell: (r) => <Money v={r.refunded} />, right: true, money: true, hide: true },
      { head: t("dep.available"), cell: (r) => <Money v={r.available} strong />, right: true, money: true, sort: (r) => r.available },
    ]} />
  </Card>;
}
