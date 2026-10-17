"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { HBars, Ring, SERIES } from "@/components/charts";
import { Badge, Card, DateText, Kpi, PageHeader, Skeleton, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { CompanyStatus, ago } from "./shared";

export default function PlatformOverview() {
  const { t, lang } = useI18n(); const o = useQuery(api.platform.overview); const list = useQuery(api.platform.companies); const log = useQuery(api.platform.auditLog, { limit: 12 });
  const attention = (list ?? []).filter((c) => c.status === "past_due" || c.status === "suspended" || (c.status === "trial" && c.trialEndsAt && c.trialEndsAt < Date.now() + 7 * 86_400_000) || (c.limits.units > 0 && c.units >= c.limits.units * 0.9) || (c.limits.seats > 0 && c.seats >= c.limits.seats));
  return (
    <div className="stack">
      <PageHeader title={t("plat.nav.overview")} sub={t("plat.overviewSub")} actions={<Link className="btn primary" href="/platform/companies?new=1">{t("plat.newCompany")}</Link>} />
      {!o ? <div className="kpis kpis-4">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton lines={3} /></div>)}</div> : (
        <>
          <div className="kpis kpis-4">
            <Kpi tone="info" icon="buildings" label={t("plat.k.companies")} value={o.companies} sub={`${o.active} ${t("plat.status.active").toLowerCase()} · ${o.trial} ${t("plat.status.trial").toLowerCase()}`} />
            <Kpi tone={o.suspended + o.pastDue ? "warn" : "good"} icon="alert" label={t("plat.k.attention")} value={o.suspended + o.pastDue + o.endingTrials.length} sub={`${o.suspended} ${t("plat.status.suspended").toLowerCase()} · ${o.pastDue} ${t("plat.status.past_due").toLowerCase()} · ${o.endingTrials.length} ${t("plat.k.trialsEnding")}`} />
            <Kpi icon="renters" label={t("plat.k.people")} value={o.people} sub={t("plat.k.peopleSub")} />
            <Kpi icon="buildings" label={t("plat.k.units")} value={o.units.toLocaleString()} sub={`${o.smsThisMonth.toLocaleString()} SMS ${t("plat.k.thisMonth")}`} />
          </div>
          <div className="cols-2">
            <Card title={t("plat.c.status")}><Ring caption={t("plat.k.companies")} center={o.companies} parts={[
              { label: t("plat.status.active"), value: o.active, color: SERIES[1] }, { label: t("plat.status.trial"), value: o.trial, color: SERIES[0] }, { label: t("plat.status.past_due"), value: o.pastDue, color: SERIES[2] },
              { label: t("plat.status.suspended"), value: o.suspended, color: SERIES[3] }, { label: t("plat.status.cancelled"), value: o.cancelled, color: SERIES[4] }]} /></Card>
            <Card title={t("plat.c.units")}><HBars format={(n) => n.toLocaleString()} items={(list ?? []).map((c) => ({ label: c.name, sub: t(`plat.plan.${c.plan}`) === `plat.plan.${c.plan}` ? c.plan : t(`plat.plan.${c.plan}`), value: c.units }))} /></Card>
          </div>
        </>)}
      <Card title={`${t("plat.needsAttention")} (${attention.length})`} flush>
        {list && attention.length === 0 ? <p className="muted pad">{t("plat.nothingNeeds")}</p> : (
          <Table rows={attention.map((c) => ({ ...c }))} cols={[
            { head: t("name"), cell: (c) => <Link href={`/platform/companies/${c._id}`}><strong>{c.name}</strong></Link> }, { head: t("status"), cell: (c) => <CompanyStatus status={c.status} /> },
            { head: t("plat.why"), cell: (c) => <span className="muted">{[c.status === "trial" && c.trialEndsAt ? `${t("plat.trialEnds")} ${new Date(c.trialEndsAt).toISOString().slice(0, 10)}` : null, c.limits.units > 0 && c.units >= c.limits.units * 0.9 ? `${t("plat.units")} ${c.units}/${c.limits.units}` : null, c.limits.seats > 0 && c.seats >= c.limits.seats ? `${t("plat.seats")} ${c.seats}/${c.limits.seats}` : null].filter(Boolean).join(" · ") || "—"}</span> },
            { head: t("plat.lastActive"), cell: (c) => ago(c.lastActivity, lang) }]} />)}
      </Card>
      <Card title={t("plat.recent")} flush><Table rows={log?.map((l, i) => ({ ...l, _id: String(i) }))} cols={[
        { head: t("date"), cell: (l) => <DateText ms={l.at} /> }, { head: t("plat.company"), cell: (l) => l.company || "—" }, { head: t("plat.action"), cell: (l) => <Badge tone="muted">{l.action}</Badge> }, { head: t("plat.by"), cell: (l) => l.by }, { head: t("notes"), cell: (l) => <span className="muted">{l.detail}</span>, text: true }]} /></Card>
    </div>
  );
}
