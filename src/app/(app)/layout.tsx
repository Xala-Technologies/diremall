"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { useI18n } from "@/lib/i18n";

type Item = { href: string; key: string; roles?: string[] };
const NAV: Item[] = [
  { href: "/", key: "nav.dashboard" },
  { href: "/properties", key: "nav.properties" },
  { href: "/renters", key: "nav.renters" },
  { href: "/agreements", key: "nav.agreements" },
  { href: "/billing", key: "nav.billing" },
  { href: "/payments", key: "nav.payments" },
  { href: "/utilities", key: "nav.utilities" },
  { href: "/reports", key: "nav.reports" },
  { href: "/bank", key: "nav.bank", roles: ["financeOfficer", "approver"] },
  { href: "/messages", key: "nav.messages" },
  { href: "/settings", key: "nav.settings", roles: ["approver"] },
  { href: "/users", key: "nav.users", roles: ["accessAdmin"] },
  { href: "/audit", key: "nav.audit", roles: ["auditor", "accessAdmin"] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();
  const router = useRouter();
  const path = usePathname();
  const { t, lang, setLang, calendar, setCalendar } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!isLoading && !isAuthenticated) router.replace("/login"); }, [isLoading, isAuthenticated, router]);
  useEffect(() => setOpen(false), [path]);

  if (isLoading || !isAuthenticated || me === undefined) return <div className="center muted">{t("loading")}</div>;
  if (me === null) return (
    <div className="center"><div className="card auth"><h1>{t("appName")}</h1><p>{t("pendingActivation")}</p><button className="btn" onClick={() => void signOut()}>{t("signOut")}</button></div></div>
  );
  const allowed = (i: Item) => !i.roles || me.roles.includes("superAdmin") || i.roles.some((r) => me.roles.includes(r as never));
  return (
    <div className="shell">
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand">{t("appName")}</div>
        {NAV.filter(allowed).map((i) => (
          <Link key={i.href} href={i.href} className={`nav ${(i.href === "/" ? path === "/" : path.startsWith(i.href)) ? "on" : ""}`}>{t(i.key)}</Link>
        ))}
        <div className="foot">
          <div><strong>{me.name || me.email}</strong><div className="muted">{me.roles.map((r) => t(r)).join(", ")}</div></div>
          <select aria-label={t("language")} value={lang} onChange={(e) => setLang(e.target.value as "en" | "am")}><option value="en">English</option><option value="am">አማርኛ</option></select>
          <select aria-label={t("calendar")} value={calendar} onChange={(e) => setCalendar(e.target.value as "gregorian" | "ethiopian")}><option value="gregorian">{t("gregorian")}</option><option value="ethiopian">{t("ethiopian")}</option></select>
          <button className="btn sm" onClick={() => void signOut()}>{t("signOut")}</button>
        </div>
      </aside>
      <main className="main">
        <button className="btn menu-btn no-print" style={{ marginBottom: 10 }} onClick={() => setOpen(!open)} aria-label="Menu">☰ {t("appName")}</button>
        {children}
      </main>
    </div>
  );
}
