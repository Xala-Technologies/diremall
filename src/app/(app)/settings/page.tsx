"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Card, PageHeader, SectionTabs, Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { Billing } from "./Billing";
import { Buildings } from "./Buildings";
import { Organisation } from "./Organisation";
import { DataPrivacy, Formats } from "./Company";
import { Security } from "./Security";
import { Health } from "./Health";
import { History } from "./History";
import { useMe } from "@/lib/useMe";

type Tab = "overview" | "org" | "buildings" | "billing" | "security" | "history" | "data";

export default function Settings() {
  const { t } = useI18n(); const { can } = useMe();
  // each person sees the tabs their role may use; the server enforces the same rules
  const TABS: Tab[] = [...(can("approver") ? ["overview" as Tab] : []), "org", ...(can("propertyManager", "approver", "auditor") ? ["buildings" as Tab] : []), ...(can("approver", "financeOfficer") ? ["billing" as Tab] : []), "security", ...(can("auditor", "accessAdmin") ? ["history" as Tab] : []), ...(can("approver") ? ["data" as Tab] : [])];
  const [chosen, setTab] = useState<Tab | null>(null); const tab: Tab = chosen && TABS.includes(chosen) ? chosen : TABS[0]!;
  // a link such as /settings?tab=buildings opens that tab
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("tab") as Tab | null; if (q) setTab(q); }, []);
  const pick = (v: string) => { setTab(v as Tab); window.history.replaceState(null, "", `/settings?tab=${v}`); };
  return (
    <div className="stack">
      <PageHeader title={t("nav.settings")} tabs={<SectionTabs label={t("nav.settings")} value={tab} onChange={pick} tabs={TABS.map((k) => [k, t(`set.tab.${k}`)] as [string, string])} />} />
      {tab === "overview" ? <Overview go={pick} /> : tab === "org" ? <><Organisation /><Formats /></> : tab === "data" ? <DataPrivacy /> : tab === "buildings" ? <Buildings /> : tab === "billing" ? <Billing /> : tab === "history" ? <History /> : <Security />}
    </div>
  );
}

/** What still has to be set up before the system can be used for real, with a way into each item. */
function Overview({ go }: { go: (t: string) => void }) {
  const { t } = useI18n(); const { can } = useMe();
  const org = useQuery(api.settings.org) as { name?: string; tin?: string; phone?: string; bankAccounts?: string } | undefined; const buildings = useQuery(api.properties.buildingOverview);
  const s = useQuery(api.settings.get); const gw = useQuery(api.smsQueue.gateway); const mfa = useQuery(api.mfa.status);
  if (!org || !buildings || !s || !gw || !mfa) return <Card><Skeleton lines={6} /></Card>;
  const live = buildings.filter((b) => !b.archivedAt), units = live.reduce((a, b) => a + b.units, 0);
  type Item = { done: boolean; title: string; hint: string; tab?: string; href?: string };
  const items: Item[] = [
    { done: !!(org.name && org.tin && org.phone && org.bankAccounts), title: t("set.todo.org"), hint: t("set.todo.orgHint"), tab: "org" },
    { done: live.length > 0, title: t("set.todo.buildings"), hint: live.length ? `${live.length} ${t("set.inService").toLowerCase()}` : t("set.todo.buildingsHint"), tab: "buildings" },
    { done: units > 0, title: t("set.todo.units"), hint: units ? `${units} ${t("rep.k.units")}` : t("set.todo.unitsHint"), href: "/properties" },
    { done: (s["tariff.water"] ?? 0) > 0 && (s["tariff.electricity"] ?? 0) > 0, title: t("set.todo.tariffs"), hint: t("set.todo.tariffsHint"), tab: "billing" },
    { done: gw.configured, title: t("set.todo.sms"), hint: gw.configured ? t("set.todo.smsOn") : t("set.todo.smsHint"), href: "/messages" },
    { done: mfa.enabled, title: t("set.todo.mfa"), hint: t("set.todo.mfaHint"), tab: "security" },
  ];
  const done = items.filter((i) => i.done).length;
  return (
    <div className="stack">
      <Card title={t("set.setupTitle")} actions={<span className="muted">{done} / {items.length}</span>}>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label={t("set.setupTitle")}><span style={{ width: `${(done / items.length) * 100}%` }} /></div>
        <ul className="todo">
          {items.map((i) => (
            <li key={i.title} className={i.done ? "is-done" : ""}>
              <span className="todo-ic" aria-hidden="true">{i.done ? <Icon name="check" size={16} /> : <span />}</span>
              <span className="todo-t"><b>{i.title}</b><small>{i.hint}</small></span>
              {i.href ? <Link className="btn sm" href={i.href}>{i.done ? t("set.review") : t("set.doNow")}</Link> : <button className="btn sm" onClick={() => go(i.tab!)}>{i.done ? t("set.review") : t("set.doNow")}</button>}
            </li>))}
        </ul>
      </Card>
      {can("approver") && <Health />}
      <div className="cols-2">
        <Card title={t("org.title")}><dl className="facts"><div><dt>{t("org.name")}</dt><dd>{org.name ?? "—"}</dd></div><div><dt>{t("renter.tin")}</dt><dd>{org.tin ?? "—"}</dd></div><div><dt>{t("renter.phone")}</dt><dd>{org.phone ?? "—"}</dd></div></dl></Card>
        <Card title={t("set.buildingsTitle")}><dl className="facts"><div><dt>{t("set.inService")}</dt><dd>{live.length}</dd></div><div><dt>{t("rep.k.units")}</dt><dd>{units}</dd></div><div><dt>{t("set.archived")}</dt><dd>{buildings.length - live.length}</dd></div></dl></Card>
      </div>
    </div>
  );
}
