"use client";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { FilterSelect } from "@/components/FilterSelect";
import { Card, Field, Message, Modal, PageHeader, SearchInput, SelectField, Table } from "@/components/ui";
import { Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";
import { CompanyStatus, ago } from "../shared";

const PLANS = ["trial", "starter", "standard", "enterprise"];

export default function Companies() {
  const { t, lang } = useI18n(); const router = useRouter(); const list = useQuery(api.platform.companies);
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [creating, setCreating] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("new")) setCreating(true); }, []);
  const needle = q.trim().toLowerCase();
  const rows = list?.filter((c) => (!status || c.status === status) && (!needle || `${c.name} ${c.slug} ${c.admins.map((a) => a.email).join(" ")}`.toLowerCase().includes(needle)));
  return (
    <div className="stack">
      <PageHeader title={t("plat.nav.companies")} actions={<button className="btn primary" onClick={() => setCreating(true)}>{t("plat.newCompany")}</button>}
        filters={<><SearchInput value={q} onChange={setQ} placeholder={t("plat.searchCompanies")} />
          <FilterSelect label={t("status")} placeholder={t("status")} value={status} onChange={setStatus} options={[{ value: "", label: t("plat.allStatuses"), icon: <Building2 size={16} /> }, ...["trial", "active", "past_due", "suspended", "cancelled"].map((s) => ({ value: s, label: t(`plat.status.${s}`), icon: <Building2 size={16} /> }))]} /></>} />
      <Card flush><Table rows={rows} empty={t("plat.noCompanies")} onRow={(c) => router.push(`/platform/companies/${c._id}`)} cols={[
        { head: t("name"), cell: (c) => <div className="two-line"><strong>{c.name}</strong><span className="muted">{c.slug}</span></div>, sort: (c) => c.name },
        { head: t("status"), cell: (c) => <CompanyStatus status={c.status} />, sort: (c) => c.status },
        { head: t("plat.plan"), cell: (c) => c.plan, sort: (c) => c.plan },
        { head: t("plat.units"), cell: (c) => `${c.units}${c.limits.units ? ` / ${c.limits.units}` : ""}`, right: true, sort: (c) => c.units },
        { head: t("plat.seats"), cell: (c) => `${c.seats}${c.limits.seats ? ` / ${c.limits.seats}` : ""}`, right: true },
        { head: "SMS", cell: (c) => `${c.smsThisMonth}${c.limits.smsPerMonth ? ` / ${c.limits.smsPerMonth}` : ""}`, right: true },
        { head: t("plat.admin"), cell: (c) => <span className="muted">{c.admins[0]?.email ?? "—"}</span> },
        { head: t("plat.lastActive"), cell: (c) => ago(c.lastActivity, lang), sort: (c) => c.lastActivity ?? 0 }]} /></Card>
      {creating && <Create onClose={() => setCreating(false)} />}
    </div>
  );
}

const slugOf = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function Create({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.platform.createCompany); const { run, error, busy } = useRun();
  const [f, setF] = useState({ name: "", slug: "", adminEmail: "", plan: "trial", country: "ET", currency: "ETB", tz: "3", lang: "en", calendar: "gregorian" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [done, setDone] = useState<{ code: string; email: string; orgId: string } | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v, ...(k === "name" && !slugTouched ? { slug: slugOf(v) } : {}) }));
  const router = useRouter();
  if (done) return (
    <Modal title={t("plat.created")} onClose={onClose}>
      <div className="stack">
        <p>{t("plat.createdHint").replace("{e}", done.email)}</p>
        <ul className="recovery"><li><code>{done.code}</code></li></ul>
        <p className="muted">{t("plat.createdNote")}</p>
        <div className="row"><button className="btn" onClick={() => void navigator.clipboard?.writeText(done.code)}>{t("mfa.copy")}</button><button className="btn primary" onClick={() => router.push(`/platform/companies/${done.orgId}`)}>{t("plat.openCompany")}</button></div>
      </div>
    </Modal>);
  return (
    <Modal title={t("plat.newCompany")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => create({ name: f.name, slug: f.slug, adminEmail: f.adminEmail, plan: f.plan, country: f.country, currency: f.currency, tzOffsetHours: Number(f.tz), defaultLang: f.lang as "en" | "am", defaultCalendar: f.calendar as "gregorian" | "ethiopian" }));
        if (r) setDone({ code: r.code, email: r.email, orgId: r.orgId });
      }}>
        <Field label={t("plat.companyName")}><input autoFocus value={f.name} onChange={(e) => set("name")(e.target.value)} /></Field>
        <Field label={t("plat.slug")} hint={t("plat.slugHint")}><input value={f.slug} onChange={(e) => { setSlugTouched(true); set("slug")(e.target.value.toLowerCase()); }} /></Field>
        <div className="wide"><Field label={t("plat.firstAdmin")} hint={t("plat.firstAdminHint")}><input type="email" value={f.adminEmail} onChange={(e) => set("adminEmail")(e.target.value)} /></Field></div>
        <SelectField label={t("plat.plan")} value={f.plan} onChange={set("plan")} options={PLANS.map((p) => ({ value: p, label: t(`plat.plan.${p}`) }))} />
        <Field label={t("plat.country")}><input maxLength={2} value={f.country} onChange={(e) => set("country")(e.target.value.toUpperCase())} /></Field>
        <Field label={t("plat.currency")} hint={t("plat.currencyHint")}><input maxLength={3} value={f.currency} onChange={(e) => set("currency")(e.target.value.toUpperCase())} /></Field>
        <Field label={t("plat.tz")} hint={t("plat.tzHint")}><input inputMode="numeric" value={f.tz} onChange={(e) => set("tz")(e.target.value)} /></Field>
        <SelectField label={t("language")} value={f.lang} onChange={set("lang")} options={[{ value: "en", label: "English" }, { value: "am", label: "አማርኛ" }]} />
        <SelectField label={t("calendar")} value={f.calendar} onChange={set("calendar")} options={[{ value: "gregorian", label: t("gregorian") }, { value: "ethiopian", label: t("ethiopian") }]} />
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy || !f.name.trim() || !f.slug || !f.adminEmail}>{t("create")}</button></div>
      </form>
    </Modal>);
}
