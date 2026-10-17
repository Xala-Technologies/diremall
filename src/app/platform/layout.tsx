"use client";
import { MfaRequired, MfaVerify } from "@/components/Mfa";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import { FilterSelect } from "@/components/FilterSelect";
import { Icon, Mark } from "@/components/icons";
import { Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useScheme, type Scheme } from "@/lib/theme";

const NAV = [
  { href: "/platform", key: "plat.nav.overview", icon: "overview", exact: true },
  { href: "/platform/companies", key: "plat.nav.companies", icon: "buildings" },
  { href: "/platform/team", key: "plat.nav.team", icon: "access" },
  { href: "/platform/audit", key: "plat.nav.audit", icon: "history" },
];

/** The platform console: separate from every company's screens. Only the platform team gets in. */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions(); const router = useRouter(); const path = usePathname();
  const { t, lang, setLang } = useI18n(); const { scheme, setScheme } = useScheme(); const [open, setOpen] = useState(false);
  useEffect(() => { if (!isLoading && !isAuthenticated) router.replace("/login"); }, [isLoading, isAuthenticated, router]);
  useEffect(() => { if (me && !me.platformAdmin) router.replace("/"); }, [me, router]);
  useEffect(() => setOpen(false), [path]);
  const brand = process.env.NEXT_PUBLIC_PLATFORM_NAME || "Rentals";
  if (isLoading || !isAuthenticated || me === undefined || me === null || !me.platformAdmin) return <div className="center"><div style={{ width: 240 }}><Skeleton lines={3} /></div></div>;
  if (me.mfa === "verify") return <MfaVerify />;
  if (me.mfa === "setup") return <MfaRequired />;
  return (
    <>
      <header className="app-header">
        <button className="btn ghost icon-only menu-btn" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}><Icon name="menu" size={20} /></button>
        <Link href="/platform" className="brand" aria-label={brand}><Mark size={34} /><span className="brand-mark-name">{brand}<small>{t("plat.console")}</small></span></Link>
        <div className="header-tools">
          <FilterSelect iconOnly badge={lang === "am" ? "አማ" : "EN"} label={t("language")} value={lang} onChange={(v) => setLang(v as "en" | "am")} options={[{ value: "en", label: "English", icon: <Icon name="globe" size={16} /> }, { value: "am", label: "አማርኛ", icon: <Icon name="globe" size={16} /> }]} />
          <FilterSelect iconOnly label={t("theme")} value={scheme} onChange={(v) => setScheme(v as Scheme)} options={[{ value: "auto", label: t("theme.auto"), icon: <Icon name="monitor" size={16} /> }, { value: "light", label: t("theme.light"), icon: <Icon name="sun" size={16} /> }, { value: "dark", label: t("theme.dark"), icon: <Icon name="moon" size={16} /> }]} />
        </div>
      </header>
      <div className="admin-layout">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`admin-sidebar ${open ? "open" : ""}`} aria-label="Main">
          <nav><div className="nav-group"><div className="nav-label">{t("plat.console")}</div>
            {NAV.map((i) => { const on = i.exact ? path === i.href : path.startsWith(i.href); return <Link key={i.href} href={i.href} className="nav" aria-current={on ? "page" : undefined}><Icon name={i.icon} /><span>{t(i.key)}</span></Link>; })}
          </div></nav>
          <div className="side-foot">
            {me.companies.some((c) => c.status === "active") && <Link className="btn sm" href="/"><Icon name="back" size={15} />{t("plat.backToCompany")}</Link>}
            <div className="who"><div className="avatar" aria-hidden="true">{(me.name || me.email || "?").slice(0, 1).toUpperCase()}</div><div><b>{me.name || me.email}</b><span>{t("plat.team")}</span></div></div>
            <button className="btn sm" onClick={() => void signOut()}>{t("signOut")}</button>
          </div>
        </aside>
        <div className="main"><main id="main" className="content" tabIndex={-1} key={path}>{children}</main></div>
      </div>
    </>
  );
}
