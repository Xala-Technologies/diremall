"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { Icon, Mark } from "@/components/icons";
import { Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

type Item = { href: string; key: string; icon: string; roles?: string[] };
const GROUPS: { label: string; items: Item[] }[] = [
  { label: "nav.g.operate", items: [
    { href: "/", key: "nav.dashboard", icon: "overview" },
    { href: "/properties", key: "nav.properties", icon: "buildings" },
    { href: "/renters", key: "nav.renters", icon: "renters" },
    { href: "/agreements", key: "nav.agreements", icon: "agreements" },
  ] },
  { label: "nav.g.money", items: [
    { href: "/billing", key: "nav.billing", icon: "bills" },
    { href: "/payments", key: "nav.payments", icon: "payments" },
    { href: "/bank", key: "nav.bank", icon: "bank", roles: ["financeOfficer", "approver"] },
    { href: "/utilities", key: "nav.utilities", icon: "utilities" },
  ] },
  { label: "nav.g.insight", items: [
    { href: "/reports", key: "nav.reports", icon: "reports" },
    { href: "/messages", key: "nav.messages", icon: "messages" },
  ] },
  { label: "nav.g.admin", items: [
    { href: "/settings", key: "nav.settings", icon: "settings", roles: ["approver"] },
    { href: "/users", key: "nav.users", icon: "access", roles: ["accessAdmin"] },
    { href: "/audit", key: "nav.audit", icon: "history", roles: ["auditor", "accessAdmin"] },
  ] },
];

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export default function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();
  const router = useRouter();
  const path = usePathname();
  const { t, lang, setLang, calendar, setCalendar } = useI18n();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(false);
  useEffect(() => setRail(read("rail") === "1"), []);
  useEffect(() => { if (!isLoading && !isAuthenticated) router.replace("/login"); }, [isLoading, isAuthenticated, router]);
  useEffect(() => setOpen(false), [path]);

  if (isLoading || !isAuthenticated || me === undefined) return <div className="center"><div style={{ width: 240 }}><Skeleton lines={3} /></div></div>;
  if (me === null) return (
    <div className="center"><div className="card auth"><Mark /><h1>{t("appName")}</h1><p className="muted">{t("pendingActivation")}</p><button className="btn" onClick={() => void signOut()}>{t("signOut")}</button></div></div>
  );
  const allowed = (i: Item) => !i.roles || me.roles.includes("superAdmin") || i.roles.some((r) => me.roles.includes(r as never));
  const initials = (me.name || me.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  const toggleRail = () => { setRail(!rail); write("rail", rail ? "0" : "1"); };

  return (
    <div className={`shell ${rail ? "rail" : ""}`}>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? "open" : ""}`} aria-label="Main">
        <div className="brand"><Mark /><span className="brand-text">Dire Mall<small>{t("appSub")}</small></span></div>
        <div className="tibeb" aria-hidden="true" />
        <nav className="nav-scroll">
          {GROUPS.map((g) => {
            const items = g.items.filter(allowed);
            if (items.length === 0) return null;
            return (
              <div key={g.label} className="nav-group">
                <div className="nav-label">{t(g.label)}</div>
                {items.map((i) => {
                  const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
                  return (
                    <Link key={i.href} href={i.href} className="nav" aria-current={on ? "page" : undefined} title={rail ? t(i.key) : undefined}>
                      <Icon name={i.icon} /><span className="nav-text">{t(i.key)}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="who"><div className="avatar" aria-hidden="true">{initials}</div><div className="side-foot-text"><b>{me.name || me.email}</b><span>{me.roles.map((r) => t(r)).join(", ")}</span></div></div>
          <div className="side-foot-text row">
            <select aria-label={t("language")} value={lang} onChange={(e) => setLang(e.target.value as "en" | "am")}><option value="en">English</option><option value="am">አማርኛ</option></select>
            <select aria-label={t("calendar")} value={calendar} onChange={(e) => setCalendar(e.target.value as "gregorian" | "ethiopian")}><option value="gregorian">{t("gregorian")}</option><option value="ethiopian">{t("ethiopian")}</option></select>
          </div>
          <div className="row">
            <button className="btn sm grow" onClick={() => void signOut()}><span className="side-foot-text">{t("signOut")}</span><span className="sr-only">{t("signOut")}</span></button>
            <button className="btn sm icon-only no-print" onClick={toggleRail} aria-expanded={!rail} aria-label={rail ? "Expand menu" : "Collapse menu"} style={{ display: "none" }} id="rail-toggle"><Icon name="collapse" /></button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar"><button className="btn icon-only" onClick={() => setOpen(true)} aria-label="Menu" aria-expanded={open}><Icon name="menu" /></button><b>Dire Mall</b></header>
        <main id="main" className="content" tabIndex={-1} key={path}>{children}</main>
      </div>
      <style>{`@media (min-width: 861px) { #rail-toggle { display: inline-flex !important; } }`}</style>
    </div>
  );
}
