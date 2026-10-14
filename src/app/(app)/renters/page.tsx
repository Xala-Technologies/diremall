"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, DateText, Field, Message, Modal, Money, PageHeader, StatusBadge, Table } from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { useUpload } from "@/lib/useUpload";

export default function Renters() {
  const { t } = useI18n(); const { can } = useMe();
  const [search, setSearch] = useState(""); const [adding, setAdding] = useState(false); const [open, setOpen] = useState<Id<"renters"> | null>(null);
  const renters = useQuery(api.renters.list, { search: search || undefined });
  return (
    <div className="stack">
      <PageHeader title={t("nav.renters")}>
        <input type="search" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("search")} />
        {can("propertyManager", "financeOfficer") && <button className="btn primary" onClick={() => setAdding(true)}>{t("renter.add")}</button>}
      </PageHeader>
      <Card flush><Table rows={renters} onRow={(r) => setOpen(r._id)} cols={[
        { head: t("name"), cell: (r) => <strong>{r.name}</strong> }, { head: t("renter.kind"), cell: (r) => t(r.kind) },
        { head: t("renter.tin"), cell: (r) => r.tin ?? "—" }, { head: t("renter.phone"), cell: (r) => r.phone },
      ]} /></Card>
      {adding && <RenterForm onClose={() => setAdding(false)} />}
      {open && <RenterDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RenterForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.renters.create); const { run, error, busy } = useRun();
  const [f, setF] = useState({ kind: "company" as "company" | "individual", name: "", tin: "", businessLicenseNo: "", phone: "", email: "", legalRepresentative: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t("renter.add")} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const opt = (s: string) => (s.trim() ? s.trim() : undefined);
        if (await run(() => create({ kind: f.kind, name: f.name, phone: f.phone, tin: opt(f.tin), businessLicenseNo: opt(f.businessLicenseNo), email: opt(f.email), legalRepresentative: opt(f.legalRepresentative) }))) onClose();
      }}>
        <Field label={t("renter.kind")}><select value={f.kind} onChange={set("kind")}><option value="company">{t("company")}</option><option value="individual">{t("individual")}</option></select></Field>
        <Field label={t("name")}><input required value={f.name} onChange={set("name")} /></Field>
        <Field label={t("renter.tin")}><input value={f.tin} onChange={set("tin")} required={f.kind === "company"} /></Field>
        <Field label={t("renter.license")}><input value={f.businessLicenseNo} onChange={set("businessLicenseNo")} /></Field>
        <Field label={t("renter.phone")}><input required type="tel" value={f.phone} onChange={set("phone")} placeholder="+2519…" /></Field>
        <Field label={t("email")}><input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("renter.rep")}><input value={f.legalRepresentative} onChange={set("legalRepresentative")} /></Field>
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
