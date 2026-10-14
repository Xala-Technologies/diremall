"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { BuildingSelect, Card, Money, PageHeader, PeriodPicker, Skeleton } from "@/components/ui";
import { formatEtb, currentPeriod, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function Dashboard() {
  const { t } = useI18n();
  const [period, setPeriod] = useState(currentPeriod());
  const [building, setBuilding] = useState("");
  const buildings = useQuery(api.properties.listBuildings);
  const d = useQuery(api.reports.dashboard, { period, buildingId: (building || undefined) as any });
  const att = d?.attention;
  const tasks: [string, number, string][] = att ? [
    ["att.draftInvoices", att.draftInvoices, "/billing"], ["att.paymentsToConfirm", att.paymentsToConfirm, "/payments"], ["att.paymentsToApply", att.paymentsToApply, "/payments"],
    ["att.agreementsInReview", att.agreementsInReview, "/agreements"], ["att.expiringAgreements", att.expiringAgreements, "/agreements"],
  ] : [];
  const open = tasks.filter(([, n]) => n > 0);

  return (
    <div className="stack">
      <PageHeader title={t("dash.title")}>
        <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHeader>

      {!d ? <Card><Skeleton lines={6} /></Card> : (
        <>
          {d.units === 0 && (
            <Card title={t("first.title")}>
              <ol className="steps">
                <li><Link href="/properties">{t("first.1")}</Link></li>
                <li><Link href="/renters">{t("first.2")}</Link></li>
                <li><Link href="/agreements">{t("first.3")}</Link></li>
              </ol>
            </Card>
          )}
          <div className="split">
            <section className="card lead" aria-labelledby="lead-h">
              <div className="lead-label" id="lead-h">{t("dash.outstanding")}</div>
              <div className="lead-fig num"><small>ETB</small>{formatEtb(d.outstanding).replace("ETB ", "")}</div>
              <div className="muted">
                {t("dash.of")} <span className="num strong" style={{ color: "var(--ink)" }}>{formatEtb(d.billed)}</span> {t("dash.billedShort")} · <span className="num strong" style={{ color: "var(--ink)" }}>{pct(d.collectionRate)}</span> {t("dash.collected")}
              </div>
              <div className="seg" role="img" aria-label={`${pct(d.collectionRate)} ${t("dash.collected")}`}>
                <i style={{ flexGrow: d.appliedToBills || 0, background: "var(--accent)" }} />
                <i style={{ flexGrow: d.outstanding || 0, background: "color-mix(in srgb, var(--bad) 55%, var(--sunken))" }} />
                {d.billed === 0 && <i style={{ flexGrow: 1 }} />}
              </div>
              <div className="legend">
                <span><i className="dot" style={{ background: "var(--accent)" }} />{t("dash.applied")} <b className="num">{formatEtb(d.appliedToBills)}</b></span>
                <span><i className="dot" style={{ background: "color-mix(in srgb, var(--bad) 55%, var(--sunken))" }} />{t("dash.stillDue")} <b className="num">{formatEtb(d.outstanding)}</b></span>
              </div>
            </section>

            <Card title={t("dash.attention")}>
              {open.length === 0 ? <div className="allclear"><Icon name="check" />{t("dash.allClear")}</div> : (
                <div className="tasks">
                  {open.map(([k, n, href]) => (
                    <Link key={k} href={href} className="task"><span className="count">{n}</span><span>{t(k)}</span><span className="chev"><Icon name="chevron" size={16} /></span></Link>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="split">
            <Card title={t("nav.payments")}>
              <dl className="dl">
                <div><dt>{t("dash.confirmed")}</dt><dd><Money v={d.confirmedPayments} /></dd></div>
                <div><dt>{t("dash.waiting")}</dt><dd><Money v={d.waitingToApply} /></dd></div>
                <div><dt>{t("dash.overdue")}</dt><dd style={{ color: d.overdue > 0 ? "var(--bad)" : undefined }}><Money v={d.overdue} /></dd></div>
                <div><dt>{t("dash.deposits")}</dt><dd><Money v={d.depositsHeld} /></dd></div>
              </dl>
            </Card>
            <Card title={t("dash.occupancy")}>
              <div className="lead-fig num" style={{ fontSize: 34 }}>{pct(d.occupancyRate)}</div>
              <div className="muted">{d.occupied} / {d.units} {t("dash.occupancyNote")}</div>
              <div className="seg"><i style={{ flexGrow: d.occupied, background: "var(--accent)" }} /><i style={{ flexGrow: Math.max(0, d.units - d.occupied) || (d.units === 0 ? 1 : 0), background: "var(--line-2)" }} /></div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
