"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, DateText, Empty, Field, Message, Modal, Money, PageHeader, Skeleton, StatusBadge, Table, ViewToggle } from "@/components/ui";
import { Badge } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { email, failures, normalizePhone, phone, req, tin } from "@/lib/validate";
import { useUpload } from "@/lib/useUpload";

export default function Renters() {
  const { t } = useI18n(); const { can } = useMe();
  const [search, setSearch] = useState(""); const [adding, setAdding] = useState(false); const [open, setOpen] = useState<Id<"renters"> | null>(null);
  const renters = useQuery(api.renters.list, { search: search || undefined });
  const [view, setViewState] = useState<"grid" | "table">("grid");
  useEffect(() => { try { if (localStorage.getItem("renterView") === "table") setViewState("table"); } catch {} }, []);
  const setView = (v: "grid" | "table") => { setViewState(v); try { localStorage.setItem("renterView", v); } catch {} };
  return (
    <div className="stack">
      <PageHeader title={t("nav.renters")}
        filters={<><input type="search" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("search")} /><span className="spacer" /><ViewToggle value={view} onChange={setView} labels={[t("view.cards"), t("view.table")]} /></>}
        actions={can("propertyManager", "financeOfficer") ? <button className="btn primary" onClick={() => setAdding(true)}>{t("renter.add")}</button> : undefined} />
      {view === "grid" ? (
        !renters ? <Card><Skeleton lines={4} /></Card> : renters.length === 0 ? <Card><Empty title={t("none")} hint={t("first.2")} /></Card> : (
          <div className="tiles">{renters.map((r) => (
            <div key={r._id} className="tile clickable occupied" role="button" tabIndex={0} onClick={() => setOpen(r._id)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(r._id); }}>
              <div className="person"><div className="avatar" aria-hidden="true">{r.name.split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase()}</div><div><b>{r.name}</b><span>{r.phone}</span></div></div>
              <div className="row"><Badge tone={r.kind === "company" ? "info" : "muted"}>{t(r.kind)}</Badge>{r.tin && <span className="muted num">TIN {r.tin}</span>}</div>
            </div>))}
          </div>)
      ) : (
      <Card flush><Table rows={renters} onRow={(r) => setOpen(r._id)} cols={[
        { head: t("name"), cell: (r) => <strong>{r.name}</strong>, sort: (r) => r.name }, { head: t("renter.kind"), cell: (r) => t(r.kind), sort: (r) => r.kind },
        { head: t("renter.tin"), cell: (r) => r.tin ?? "—" }, { head: t("renter.phone"), cell: (r) => r.phone },
      ]} /></Card>
      )}
      {adding && <RenterForm onClose={() => setAdding(false)} />}
      {open && <RenterDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RenterForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.renters.create); const { run, error, busy } = useRun();
  const [f, setF] = useState({ kind: "company" as "company" | "individual", name: "", tin: "", businessLicenseNo: "", phone: "", email: "", legalRepresentative: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: "" }); };
  return (
    <Modal title={t("renter.add")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ name: req(f.name, t), phone: req(f.phone, t) ?? phone(f.phone, t), tin: f.kind === "company" ? (req(f.tin, t) ?? tin(f.tin, t)) : (f.tin.trim() ? tin(f.tin, t) : null), email: email(f.email, t) });
        setErrs(found);
        if (Object.keys(found).length) return;
        const opt = (s: string) => (s.trim() ? s.trim() : undefined);
        if (await run(() => create({ kind: f.kind, name: f.name.trim(), phone: normalizePhone(f.phone), tin: opt(f.tin)?.replace(/\s/g, ""), businessLicenseNo: opt(f.businessLicenseNo), email: opt(f.email), legalRepresentative: opt(f.legalRepresentative) }), t("saved"))) onClose();
      }}>
        <Field label={t("renter.kind")}><select value={f.kind} onChange={set("kind")}><option value="company">{t("company")}</option><option value="individual">{t("individual")}</option></select></Field>
        <Field label={t("name")} error={errs.name}><input autoFocus value={f.name} onChange={set("name")} /></Field>
        <Field label={t("renter.tin")} error={errs.tin} hint={f.kind === "company" ? undefined : t("optional")}><input inputMode="numeric" value={f.tin} onChange={set("tin")} /></Field>
        <Field label={t("renter.license")}><input value={f.businessLicenseNo} onChange={set("businessLicenseNo")} /></Field>
        <Field label={t("renter.phone")} error={errs.phone}><input type="tel" value={f.phone} onChange={set("phone")} placeholder="0911 20 01 01" /></Field>
        <Field label={t("email")} error={errs.email} hint={t("optional")}><input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("renter.rep")} hint={t("optional")}><input value={f.legalRepresentative} onChange={set("legalRepresentative")} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

function RenterDetail({ id, onClose }: { id: Id<"renters">; onClose: () => void }) {
  const { t } = useI18n(); const { can } = useMe();
  const data = useQuery(api.renters.get, { renterId: id });
  const ledger = useQuery(api.reports.tenantLedger, { renterId: id });
  const credit = useQuery(api.payments.credit, { renterId: id });
  const add = useMutation(api.renters.addDocument); const upload = useUpload(); const { run, error, notice } = useRun();
  const [kind, setKind] = useState("Business licence");
  return (
    <Modal title={data?.renter.name ?? t("loading")} onClose={onClose}>
      {data && <div className="stack">
        <p className="muted">{t(data.renter.kind)} · {data.renter.phone}{data.renter.tin ? ` · TIN ${data.renter.tin}` : ""}</p>
        <Card title={t("renter.documents")}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{data.documents.map((d) => <li key={d._id}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.kind}</a> : d.kind}</li>)}</ul>
          {can("propertyManager", "financeOfficer") && <div className="row" style={{ marginTop: 10 }}>
            <input value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("renter.documents")} />
            <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(async () => add({ renterId: id, kind, fileId: await upload(f) }), t("saved")); e.target.value = ""; }} />
          </div>}
          <Message error={error} notice={notice} />
        </Card>
        <Card title={t("renter.ledger")} actions={<>
          <span className="muted">{t("pay.credit")}: <Money v={credit ?? 0} /></span>
          <button className="btn sm" onClick={() => ledger && downloadCsv(`statement-${data.renter.name}.csv`, ledger.map((l) => ({ date: new Date(l.at).toISOString().slice(0, 10), type: l.kind, reference: l.ref, debit: l.debit / 100, credit: l.credit / 100, balance: l.balance / 100 })))}>{t("export")}</button></>}>
          <Table rows={ledger?.map((l, i) => ({ ...l, _id: String(i) }))} cols={[
            { head: t("date"), cell: (l) => <DateText ms={l.at} /> }, { head: t("status"), cell: (l) => l.kind }, { head: t("pay.reference"), cell: (l) => l.ref },
            { head: "Debit", cell: (l) => l.debit ? <Money v={l.debit} /> : "", right: true, money: true }, { head: "Credit", cell: (l) => l.credit ? <Money v={l.credit} /> : "", right: true, money: true },
            { head: t("bill.due"), cell: (l) => <Money v={l.balance} strong />, right: true, money: true },
          ]} />
        </Card>
        <Card title={t("nav.agreements")}><Table rows={data.agreements} cols={[
          { head: t("ag.start"), cell: (a) => <DateText ms={a.startsAt} /> }, { head: t("ag.end"), cell: (a) => <DateText ms={a.endsAt} /> }, { head: t("status"), cell: (a) => <StatusBadge status={a.status} /> },
        ]} /></Card>
      </div>}
    </Modal>
  );
}
