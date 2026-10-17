"use client";
import { MfaRequired, MfaVerify } from "@/components/Mfa";
import { CompanyAccess } from "@/components/CompanyAccess";
import { setClientCurrency } from "@/lib/format";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { Icon, Mark } from "@/components/icons";
import { Skeleton } from "@/components/ui";
import { FilterSelect } from "@/components/FilterSelect";
import { useScheme, type Scheme } from "@/lib/theme";
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
    { href: "/import", key: "nav.import", icon: "upload", roles: ["propertyManager", "financeOfficer"] },
    { href: "/settings", key: "nav.settings", icon: "settings" },
    { href: "/users", key: "nav.users", icon: "access", roles: ["accessAdmin"] },
  ] },
];


export default function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const waiting = useQuery(api.users.pendingCount, isAuthenticated && me && me.ready ? {} : "skip");
  const supportOpen = useQuery(api.settings.supportOpen, isAuthenticated && me && me.ready && !me.support ? {} : "skip");
  const switchCo = useMutation(api.users.switchCompany); const endSupport = useMutation(api.platform.endSupport);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const path = usePathname();
  const { t, lang, setLang, calendar, setCalendar } = useI18n();
  const { scheme, setScheme } = useScheme();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!isLoading && !isAuthenticated) router.replace("/login"); }, [isLoading, isAuthenticated, router]);
  useEffect(() => setOpen(false), [path]);
  // someone who only runs the platform has no company to show, so they go straight to the console
  const platformOnly = !!me && !me.ready && me.platformAdmin && me.companies.length === 0;
  useEffect(() => { if (platformOnly) router.replace("/platform"); }, [platformOnly, router]);
  // a person who has never chosen a language or calendar gets the company's defaults
  const dl = me?.org?.defaultLang, dc = me?.org?.defaultCalendar;
  useEffect(() => {
    try { if (dl && !localStorage.getItem("lang")) setLang(dl); if (dc && !localStorage.getItem("calendar")) setCalendar(dc); } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dl, dc]);

  if (isLoading || !isAuthenticated || me === undefined) return <div className="center"><div style={{ width: 240 }}><Skeleton lines={3} /></div></div>;
  if (me === null) return (
    <div className="center"><div className="card auth wait"><Mark /><h1>{t("appName")}</h1><span className="wait-ic bad" aria-hidden="true"><Icon name="alert" size={26} /></span><h2>{t("access.offTitle")}</h2><p className="muted" role="status">{t("access.offBody")}</p><button className="btn" onClick={() => void signOut()}>{t("signOut")}</button></div></div>
  );
  setClientCurrency(me.org?.currency);
  if (me.mfa === "verify") return <MfaVerify />;
  if (me.mfa === "setup") return <MfaRequired />;
  if (platformOnly) return <div className="center"><div style={{ width: 240 }}><Skeleton lines={3} /></div></div>;
  if (!me.ready) return <CompanyAccess me={me} />;
  const allowed = (i: Item) => !i.roles || me.roles.includes("superAdmin") || i.roles.some((r) => me.roles.includes(r as never));
  const initials = (me.name || me.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");

  return (
    <>
      <header className="app-header">
        <button className="btn ghost icon-only menu-btn" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}><Icon name="menu" size={20} /></button>
        <Link href="/" className="brand" aria-label={t("appName")}><Mark size={42} /><span className="brand-mark-name">{me.org?.name ?? t("appName")}<small>{t("appSub")}</small></span></Link>
        <div className="header-tools">
          <FilterSelect iconOnly badge={lang === "am" ? "አማ" : "EN"} label={t("language")} value={lang} onChange={(v) => setLang(v as "en" | "am")} options={[{ value: "en", label: "English", icon: <Icon name="globe" size={16} /> }, { value: "am", label: "አማርኛ", icon: <Icon name="globe" size={16} /> }]} />
          <FilterSelect iconOnly label={t("calendar")} value={calendar} onChange={(v) => setCalendar(v as "gregorian" | "ethiopian")} options={[{ value: "gregorian", label: t("gregorian"), icon: <Icon name="calendar" size={16} /> }, { value: "ethiopian", label: t("ethiopian"), icon: <Icon name="calendar" size={16} /> }]} />
          <FilterSelect iconOnly label={t("theme")} value={scheme} onChange={(v) => setScheme(v as Scheme)} options={[{ value: "auto", label: t("theme.auto"), icon: <Icon name="monitor" size={16} /> }, { value: "light", label: t("theme.light"), icon: <Icon name="sun" size={16} /> }, { value: "dark", label: t("theme.dark"), icon: <Icon name="moon" size={16} /> }]} />
        </div>
      </header>
      <div className="admin-layout">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`admin-sidebar ${open ? "open" : ""}`} aria-label="Main">
          <nav>
            {GROUPS.map((g) => {
              const items = g.items.filter(allowed);
              if (items.length === 0) return null;
              return (
                <div key={g.label} className="nav-group">
                  <div className="nav-label">{t(g.label)}</div>
                  {items.map((i) => {
                    const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
                    return <Link key={i.href} href={i.href} className="nav" aria-current={on ? "page" : undefined}><Icon name={i.icon} /><span>{t(i.key)}</span>{i.href === "/users" && !!waiting && <span className="nav-badge" aria-label={t("access.waitingN").replace("{n}", String(waiting))}>{waiting}</span>}</Link>;
                  })}
                </div>
              );
            })}
          </nav>
          <div className="side-foot">
            {me.platformAdmin && <Link className="btn sm" href="/platform"><Icon name="access" size={15} />{t("plat.open")}</Link>}
            {me.companies.filter((c) => c.status === "active").length > 1 && <FilterSelect label={t("co.switch")} value={me.org?._id ?? ""} onChange={(v) => void switchCo({ orgId: v as never }).then(() => router.replace("/"))} options={me.companies.filter((c) => c.status === "active").map((c) => ({ value: c.orgId, label: c.name, icon: <Icon name="buildings" size={16} /> }))} />}
            <div className="who"><div className="avatar" aria-hidden="true">{initials}</div><div><b>{me.name || me.email}</b><span>{me.roles.map((r) => t(r)).join(", ")}</span></div></div>
            <button className="btn sm" onClick={() => void signOut()}>{t("signOut")}</button>
          </div>
        </aside>
        <div className="main">
          {me.support && <div className="banner warn" role="status"><Icon name="alert" size={16} /><span>{t("plat.supportBanner").replace("{c}", me.org?.name ?? "")}</span><button className="btn sm" onClick={() => void endSupport().then(() => router.replace("/platform"))}>{t("plat.endSupport")}</button></div>}
          {!me.support && supportOpen && <div className="banner info" role="status"><Icon name="alert" size={16} /><span>{t("plat.supportOpenBanner")}</span></div>}
          {me.org?.frozen && <div className="banner bad" role="status"><Icon name="alert" size={16} /><span>{t(`plat.frozen.${me.org.frozen}`)}</span></div>}
          <main id="main" className="content" tabIndex={-1} key={path}>{children}</main>
        </div>
      </div>
    </>
  );
}
