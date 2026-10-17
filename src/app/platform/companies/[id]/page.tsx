"use client";
import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge, Card, ConfirmDialog, DateText, Field, Message, Modal, PageHeader, ReasonDialog, SectionTabs, SelectField, Skeleton, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";
import { CompanyStatus, Meter } from "../../shared";

type Tab = "overview" | "people" | "plan" | "support" | "activity";
const PLANS = ["trial", "starter", "standard", "enterprise"];

export default function CompanyDetail() {
  const { t } = useI18n(); const orgId = useParams<{ id: string }>().id as Id<"organizations">; const router = useRouter();
  const c = useQuery(api.platform.company, { orgId }); const setStatus = useMutation(api.platform.setStatus); const del = useMutation(api.platform.deleteCompany);
  const { run, error } = useRun(); const [tab, setTab] = useState<Tab>("overview"); const [dlg, setDlg] = useState<null | "suspend" | "cancel" | "delete" | "pastDue">(null);
  if (!c) return <div className="stack"><Card><Skeleton lines={5} /></Card></div>;
  const actions = <div className="row">
    {c.status === "suspended" || c.status === "past_due" || c.status === "cancelled" ? <button className="btn primary" onClick={() => void run(() => setStatus({ orgId, status: "active" }), t("saved"))}>{t("plat.reactivate")}</button> : <>
      <button className="btn" onClick={() => setDlg("pastDue")}>{t("plat.markPastDue")}</button><button className="btn" onClick={() => setDlg("suspend")}>{t("plat.suspend")}</button></>}
    {c.status !== "cancelled" && <button className="btn danger" onClick={() => setDlg("cancel")}>{t("plat.cancel")}</button>}
    {c.status === "cancelled" && <button className="btn danger" onClick={() => setDlg("delete")}>{t("plat.deleteForever")}</button>}
  </div>;
  return (
    <div className="stack">
      <PageHeader title={c.name} sub={`${c.slug} · ${t(`plat.plan.${c.plan}`) === `plat.plan.${c.plan}` ? c.plan : t(`plat.plan.${c.plan}`)}`} actions={actions}
        tabs={<SectionTabs label={c.name} value={tab} onChange={(v) => setTab(v as Tab)} tabs={(["overview", "people", "plan", "support", "activity"] as Tab[]).map((k) => [k, t(`plat.tab.${k}`)] as [string, string])} />} />
      <Message error={error} />
      {c.statusReason && c.status !== "active" && <p className="msg bad" role="status">{t("plat.reason")}: {c.statusReason}</p>}
      {tab === "overview" && <Overview c={c} />}{tab === "people" && <People c={c} />}{tab === "plan" && <Plan c={c} />}{tab === "support" && <Support c={c} />}{tab === "activity" && <Activity c={c} />}
      {dlg === "suspend" && <ReasonDialog title={t("plat.suspend")} onClose={() => setDlg(null)} onSave={(reason) => run(() => setStatus({ orgId, status: "suspended", reason }), t("saved"))} />}
      {dlg === "pastDue" && <ReasonDialog title={t("plat.markPastDue")} onClose={() => setDlg(null)} onSave={(reason) => run(() => setStatus({ orgId, status: "past_due", reason }), t("saved"))} />}
      {dlg === "cancel" && <ReasonDialog title={t("plat.cancel")} onClose={() => setDlg(null)} onSave={(reason) => run(() => setStatus({ orgId, status: "cancelled", reason }), t("saved"))} />}
      {dlg === "delete" && <DeleteDialog slug={c.slug} onClose={() => setDlg(null)} onConfirm={async (slug) => { if (await run(() => del({ orgId, confirmSlug: slug }), t("deleted"))) router.replace("/platform/companies"); }} />}
    </div>
  );
}

type C = NonNullable<ReturnType<typeof useQuery<typeof api.platform.company>>>;

function Overview({ c }: { c: C }) {
  const { t } = useI18n(); const [run, setRun] = useState(false); const health = useQuery(api.platform.health, run ? { orgId: c._id } : "skip");
  return (
    <div className="stack">
      <div className="cols-2">
        <Card title={t("plat.usage")}><div className="stack">
          <Meter label={t("plat.units")} used={c.units} limit={c.limits.units} /><Meter label={t("plat.seats")} used={c.seats} limit={c.limits.seats} /><Meter label={t("plat.smsMonth")} used={c.smsThisMonth} limit={c.limits.smsPerMonth} />
        </div></Card>
        <Card title={t("plat.facts")}><dl className="facts">
          <div><dt>{t("status")}</dt><dd><CompanyStatus status={c.status} /></dd></div>
          {c.trialEndsAt && <div><dt>{t("plat.trialEnds")}</dt><dd><DateText ms={c.trialEndsAt} /></dd></div>}
          <div><dt>{t("plat.createdOn")}</dt><dd><DateText ms={c.createdAt} /></dd></div><div><dt>{t("plat.currency")}</dt><dd>{c.currency}</dd></div>
          <div><dt>{t("plat.tz")}</dt><dd>UTC{c.tzOffsetHours >= 0 ? "+" : ""}{c.tzOffsetHours}</dd></div><div><dt>{t("plat.joinCode")}</dt><dd>{c.joinCode ? t("plat.on") : t("plat.off")}</dd></div>
          <div><dt>{t("plat.admin")}</dt><dd>{c.admins.map((a) => a.email).join(", ") || "—"}</dd></div>
        </dl></Card>
      </div>
      <Card title={t("plat.health")} actions={<button className="btn sm" onClick={() => setRun(true)}>{t("set.healthRun")}</button>}>
        <p className="muted">{t("plat.healthHint")}</p>
        {run && !health && <Skeleton lines={2} />}
        {health && <div className="stack"><p className={`msg ${health.problems.length ? "bad" : "good"}`} role="status">{health.problems.length ? t("set.healthFound").replace("{n}", String(health.problems.reduce((a, p) => a + p.n, 0))) : t("set.healthOk")}</p>
          <p className="muted small">{Object.entries(health.checked).map(([k, v]) => `${v} ${k}`).join(" · ")}</p>
          {health.problems.length > 0 && <ul className="req-list">{health.problems.map((p) => <li key={p.code}><div className="req-main"><b>{p.code.replace(/_/g, " ")}</b></div><Badge tone="warn">{p.n}</Badge></li>)}</ul>}</div>}
      </Card>
    </div>
  );
}

function People({ c }: { c: C }) {
  const { t } = useI18n(); const reinvite = useMutation(api.platform.reinviteAdmin); const { run, error } = useRun(); const [email, setEmail] = useState(""); const [code, setCode] = useState<string | null>(null);
  return (
    <div className="stack">
      <Card title={t("plat.reinviteTitle")}>
        <p className="muted">{t("plat.reinviteHint")}</p>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => reinvite({ orgId: c._id, email })); if (r) setCode(r.code); }}>
          <Field label={t("email")}><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field><button className="btn primary">{t("plat.reinvite")}</button></form>
        <Message error={error} />
        {code && <div className="stack"><p>{t("plat.createdNote")}</p><ul className="recovery"><li><code>{code}</code></li></ul></div>}
      </Card>
      <Card flush title={`${t("plat.tab.people")} (${c.people.length})`}><Table rows={c.people.map((p) => ({ ...p, _id: p.membershipId }))} cols={[
        { head: t("name"), cell: (p) => <strong>{p.name || "—"}</strong> }, { head: t("email"), cell: (p) => p.email },
        { head: t("users.roles"), cell: (p) => p.roles.map((r) => t(r)).join(", ") }, { head: t("status"), cell: (p) => <Badge tone={p.active ? "good" : "muted"}>{p.active ? t("active") : t("inactive")}</Badge> }]} /></Card>
    </div>
  );
}

function Plan({ c }: { c: C }) {
  const { t } = useI18n(); const update = useMutation(api.platform.updatePlan); const { run, error, busy } = useRun();
  const [plan, setPlan] = useState(PLANS.includes(c.plan) ? c.plan : "custom"); const [units, setUnits] = useState(String(c.limits.units)); const [seats, setSeats] = useState(String(c.limits.seats)); const [sms, setSms] = useState(String(c.limits.smsPerMonth));
  const [trial, setTrial] = useState(c.trialEndsAt ? new Date(c.trialEndsAt).toISOString().slice(0, 10) : "");
  const presets: Record<string, [number, number, number]> = { trial: [50, 5, 200], starter: [100, 5, 500], standard: [500, 20, 3000], enterprise: [0, 0, 0] };
  return (
    <Card title={t("plat.tab.plan")}>
      <form className="form" noValidate onSubmit={async (e) => { e.preventDefault(); await run(() => update({ orgId: c._id, plan, units: Number(units), seats: Number(seats), smsPerMonth: Number(sms), trialEndsAt: trial ? Date.parse(trial) : null }), t("saved")); }}>
        <p className="muted wide">{t("plat.planHint")}</p>
        <SelectField label={t("plat.plan")} value={plan} onChange={(v) => { setPlan(v); const p = presets[v]; if (p) { setUnits(String(p[0])); setSeats(String(p[1])); setSms(String(p[2])); } }} options={[...PLANS, "custom"].map((p) => ({ value: p, label: t(`plat.plan.${p}`) }))} />
        <Field label={t("plat.trialEnds")} hint={t("optional")}><input type="date" value={trial} onChange={(e) => setTrial(e.target.value)} /></Field>
        <Field label={t("plat.limitUnits")} hint={t("plat.zeroNoLimit")}><input inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
        <Field label={t("plat.limitSeats")} hint={t("plat.zeroNoLimit")}><input inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        <Field label={t("plat.limitSms")} hint={t("plat.zeroNoLimit")}><input inputMode="numeric" value={sms} onChange={(e) => setSms(e.target.value)} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("save")}</button></div>
      </form>
    </Card>
  );
}

function Support({ c }: { c: C }) {
  const { t } = useI18n(); const router = useRouter(); const start = useMutation(api.platform.startSupport); const { run, error, busy } = useRun();
  const [reason, setReason] = useState(""); const [minutes, setMinutes] = useState("30");
  return (
    <div className="stack">
      <Card title={t("plat.supportTitle")}>
        <p className="muted">{t("plat.supportHint")}</p>
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await run(() => start({ orgId: c._id, reason, minutes: Number(minutes) }))) router.push("/"); }}>
          <Field label={t("plat.supportReason")} hint={t("plat.supportReasonHint")}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <SelectField label={t("plat.supportFor")} value={minutes} onChange={setMinutes} options={["15", "30", "60", "120"].map((m) => ({ value: m, label: `${m} ${t("plat.minutes")}` }))} />
          <Message error={error} /><div><button className="btn primary" disabled={busy || reason.trim().length < 10}>{t("plat.startSupport")}</button></div>
        </form>
      </Card>
      <Card flush title={t("plat.supportHistory")}><Table rows={c.sessions} empty={t("plat.noSessions")} cols={[
        { head: t("date"), cell: (s) => <DateText ms={s.startedAt} /> }, { head: t("plat.by"), cell: (s) => s.by }, { head: t("plat.reason"), cell: (s) => <span className="muted">{s.reason}</span>, text: true },
        { head: t("status"), cell: (s) => <Badge tone={!s.endedAt && s.expiresAt > Date.now() ? "warn" : "muted"}>{!s.endedAt && s.expiresAt > Date.now() ? t("plat.open") : t("plat.ended")}</Badge> }]} /></Card>
    </div>
  );
}

function Activity({ c }: { c: C }) {
  const { t } = useI18n();
  return <Card flush><Table rows={c.log.map((l, i) => ({ ...l, _id: String(i) }))} empty={t("plat.noActivity")} cols={[
    { head: t("date"), cell: (l) => <DateText ms={l.at} /> }, { head: t("plat.action"), cell: (l) => <Badge tone={l.action.startsWith("support") ? "warn" : "muted"}>{l.action}</Badge> }, { head: t("plat.by"), cell: (l) => l.by }, { head: t("notes"), cell: (l) => <span className="muted">{l.detail}</span>, text: true }]} /></Card>;
}

function DeleteDialog({ slug, onClose, onConfirm }: { slug: string; onClose: () => void; onConfirm: (slug: string) => Promise<unknown> }) {
  const { t } = useI18n(); const [v, setV] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <Modal title={t("plat.deleteForever")} onClose={onClose} narrow>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onConfirm(v); setBusy(false); onClose(); }}>
        <p>{t("plat.deleteBody")}</p><Field label={t("plat.typeSlug").replace("{s}", slug)}><input autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={onClose}>{t("cancel")}</button><button className="btn danger" disabled={busy || v.trim().toLowerCase() !== slug}>{t("plat.deleteForever")}</button></div>
      </form>
    </Modal>
  );
}
