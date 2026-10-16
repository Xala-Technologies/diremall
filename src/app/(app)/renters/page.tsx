"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, DateField, DateText, Empty, Field, Message, Modal, Money, PageHeader, SearchInput, Skeleton, StatusBadge, Table, ViewToggle } from "@/components/ui";
import { Badge } from "@/components/ui";
import { FilterSelect } from "@/components/FilterSelect";
import { Building2, User, Users } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { FILE_ACCEPT, email, failures, fileProblem, normalizePhone, phone, req, tin } from "@/lib/validate";
import { HBars, Columns, Ring, SERIES, compact } from "@/components/charts";
import { Kpi } from "@/components/ui";
import { pct } from "@/lib/format";
import { useToast } from "@/components/toast";
import { useOpenFile } from "@/lib/useOpenFile";
import { useUpload } from "@/lib/useUpload";

export default function Renters() {
  const { t } = useI18n(); const { can } = useMe();
  const [search, setSearch] = useState(""); const [kind, setKind] = useState(""); const [adding, setAdding] = useState(false); const [open, setOpen] = useState<Id<"renters"> | null>(null);
  const rentersAll = useQuery(api.renters.list, { search: search || undefined });
  const renters = rentersAll?.filter((r) => !kind || r.kind === kind);
  const [view, setViewState] = useState<"grid" | "table">("grid");
  useEffect(() => { try { if (localStorage.getItem("renterView") === "table") setViewState("table"); } catch {} }, []);
  const setView = (v: "grid" | "table") => { setViewState(v); try { localStorage.setItem("renterView", v); } catch {} };
  return (
    <div className="stack">
      <PageHeader title={t("nav.renters")}
        filters={<><SearchInput value={search} onChange={setSearch} placeholder={t("filter.searchRenters")} /><FilterSelect label={t("renter.kind")} placeholder={t("renter.kind")} value={kind} onChange={setKind} options={[{ value: "", label: t("filter.allTypes"), icon: <Users size={16} /> }, { value: "company", label: t("company"), icon: <Building2 size={16} /> }, { value: "individual", label: t("individual"), icon: <User size={16} /> }]} />{(search || kind) && <button type="button" className="btn ghost sm" onClick={() => { setSearch(""); setKind(""); }}>{t("filter.clear")}</button>}<span className="spacer" /><ViewToggle value={view} onChange={setView} labels={[t("view.cards"), t("view.table")]} /></>}
        actions={can("propertyManager", "financeOfficer") ? <button className="btn primary" onClick={() => setAdding(true)}>{t("renter.add")}</button> : undefined} />
      <RenterInsights renters={rentersAll} />
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

type RenterDoc = { _id: Id<"renters">; kind: "company" | "individual"; name: string; tin?: string; phone: string; email?: string; businessLicenseNo?: string; legalRepresentative?: string; idNumber?: string; address?: string; contactPerson?: string; contactPhone?: string; vatNumber?: string; licenseExpiresAt?: number; notes?: string; smsLanguage?: "en" | "am"; smsOptOut?: boolean };

/** Add a renter, or edit one. Companies and individuals are asked for different things. */
function RenterForm({ renter, onClose }: { renter?: RenterDoc; onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.renters.create); const update = useMutation(api.renters.update); const addDoc = useMutation(api.renters.addDocument);
  const upload = useUpload(); const toast = useToast(); const { run, error, busy } = useRun();
  const [f, setF] = useState({ kind: renter?.kind ?? ("company" as "company" | "individual"), name: renter?.name ?? "", tin: renter?.tin ?? "", businessLicenseNo: renter?.businessLicenseNo ?? "", phone: renter?.phone ?? "", email: renter?.email ?? "",
    legalRepresentative: renter?.legalRepresentative ?? "", idNumber: renter?.idNumber ?? "", address: renter?.address ?? "", contactPerson: renter?.contactPerson ?? "", contactPhone: renter?.contactPhone ?? "", vatNumber: renter?.vatNumber ?? "", notes: renter?.notes ?? "" });
  const [expires, setExpires] = useState<number | null>(renter?.licenseExpiresAt ?? null);
  const [smsLang, setSmsLang] = useState<"en" | "am">(renter?.smsLanguage ?? "en"); const [smsOpt, setSmsOpt] = useState(!!renter?.smsOptOut);
  const [files, setFiles] = useState<Record<string, File | null>>({ license: null, tin: null, id: null });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: "" }); };
  const company = f.kind === "company";
  const setFile = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0] ?? null; const p = fileProblem(file, t); setErrs({ ...errs, [`file_${k}`]: p ?? "" }); setFiles({ ...files, [k]: p ? null : file }); if (p) e.target.value = ""; };
  const docSlots = company ? [["license", "renter.doc.license", "Business licence"], ["tin", "renter.doc.tin", "TIN certificate"]] as const : [["id", "renter.doc.id", "ID copy"]] as const;
  return (
    <Modal title={renter ? `${t("renter.edit")}: ${renter.name}` : t("renter.add")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({
          name: req(f.name, t), phone: req(f.phone, t) ?? phone(f.phone, t),
          tin: company ? (req(f.tin, t) ?? tin(f.tin, t)) : (f.tin.trim() ? tin(f.tin, t) : (f.idNumber.trim() ? null : t("v.idOrTin"))),
          idNumber: !company && !f.tin.trim() && !f.idNumber.trim() ? t("v.idOrTin") : null,
          email: email(f.email, t), contactPhone: f.contactPhone.trim() ? phone(f.contactPhone, t) : null,
          vatNumber: f.vatNumber.trim() && !/^\d{6,15}$/.test(f.vatNumber.replace(/\s/g, "")) ? t("v.vat") : null,
        });
        setErrs(found); if (Object.keys(found).length) return;
        const text = { name: f.name.trim(), tin: f.tin.replace(/\s/g, ""), phone: normalizePhone(f.phone), email: f.email.trim(), businessLicenseNo: f.businessLicenseNo, legalRepresentative: f.legalRepresentative, idNumber: f.idNumber, address: f.address,
          contactPerson: f.contactPerson, contactPhone: f.contactPhone.trim() ? normalizePhone(f.contactPhone) : "", vatNumber: f.vatNumber, notes: f.notes };
        if (renter) { if ((await run(() => update({ renterId: renter._id, patch: { ...text, licenseExpiresAt: expires ?? 0, smsLanguage: smsLang, smsOptOut: smsOpt } }), t("saved"))) !== undefined) onClose(); return; }
        const opt = <K extends keyof typeof text>(k: K) => (String(text[k]).trim() ? text[k] : undefined);
        const id = await run(() => create({ kind: f.kind, name: text.name, phone: text.phone, tin: opt("tin"), email: opt("email"), businessLicenseNo: opt("businessLicenseNo"), legalRepresentative: opt("legalRepresentative"), idNumber: opt("idNumber"),
          address: opt("address"), contactPerson: opt("contactPerson"), contactPhone: opt("contactPhone"), vatNumber: opt("vatNumber"), notes: opt("notes"), licenseExpiresAt: expires ?? undefined, smsLanguage: smsLang, smsOptOut: smsOpt || undefined }), t("saved"));
        if (!id) return;
        // the renter exists now; attach what was chosen. A failed upload must not create the renter twice, so it only warns.
        for (const [k, , kind] of docSlots) {
          const file = files[k]; if (!file) continue;
          try { await addDoc({ renterId: id, kind, fileId: await upload(file) }); } catch { toast(`${kind}: ${t("renter.docFailed")}`); }
        }
        onClose();
      }}>
        <Field label={t("renter.kind")}><select value={f.kind} disabled={!!renter} onChange={set("kind")}><option value="company">{t("company")}</option><option value="individual">{t("individual")}</option></select></Field>
        <Field label={t("name")} error={errs.name}><input autoFocus value={f.name} onChange={set("name")} /></Field>
        {company ? <>
          <Field label={t("renter.tin")} error={errs.tin}><input inputMode="numeric" value={f.tin} onChange={set("tin")} placeholder="0012345678" /></Field>
          <Field label={t("renter.license")} hint={t("optional")}><input value={f.businessLicenseNo} onChange={set("businessLicenseNo")} /></Field>
          <Field label={t("renter.licenseExpires")} hint={t("optional")}><div className="row"><DateField value={expires} onChange={setExpires} />{expires != null && <button type="button" className="btn ghost sm" onClick={() => setExpires(null)}>{t("clear")}</button>}</div></Field>
          <Field label={t("renter.vat")} error={errs.vatNumber} hint={t("optional")}><input inputMode="numeric" value={f.vatNumber} onChange={set("vatNumber")} /></Field>
          <Field label={t("renter.rep")} hint={t("optional")}><input value={f.legalRepresentative} onChange={set("legalRepresentative")} /></Field>
        </> : <>
          <Field label={t("renter.idNumber")} error={errs.idNumber} hint={t("renter.idHint")}><input value={f.idNumber} onChange={set("idNumber")} /></Field>
          <Field label={t("renter.tin")} error={errs.tin} hint={t("optional")}><input inputMode="numeric" value={f.tin} onChange={set("tin")} /></Field>
        </>}
        <Field label={t("renter.phone")} error={errs.phone}><input type="tel" value={f.phone} onChange={set("phone")} placeholder="0911 20 01 01" /></Field>
        <Field label={t("email")} error={errs.email} hint={t("optional")}><input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("renter.contactPerson")} hint={t("optional")}><input value={f.contactPerson} onChange={set("contactPerson")} /></Field>
        <Field label={t("renter.contactPhone")} error={errs.contactPhone} hint={t("optional")}><input type="tel" value={f.contactPhone} onChange={set("contactPhone")} /></Field>
        <Field label={t("sms.language")}><select value={smsLang} onChange={(e) => setSmsLang(e.target.value as "en" | "am")}><option value="en">English</option><option value="am">አማርኛ</option></select></Field>
        <label className="field"><span>{t("sms.tab.log")}</span><span className="row"><input type="checkbox" checked={smsOpt} onChange={(e) => setSmsOpt(e.target.checked)} />{t("sms.optOut")}</span></label>
        <div className="wide"><Field label={t("renter.address")} hint={t("optional")}><input value={f.address} onChange={set("address")} /></Field></div>
        <div className="wide"><Field label={t("renter.notes")} hint={t("optional")}><textarea rows={2} value={f.notes} onChange={set("notes")} /></Field></div>
        {!renter && <fieldset className="wide docs-now"><legend>{t("renter.attachNow")}</legend><p className="muted">{t("renter.attachHint")}</p>
          {docSlots.map(([k, label]) => <Field key={k} label={t(label)} error={errs[`file_${k}`]}><input type="file" accept={FILE_ACCEPT} onChange={setFile(k)} /></Field>)}</fieldset>}
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{renter ? t("save") : t("create")}</button></div>
      </form>
    </Modal>
  );
}

function RenterDetail({ id, onClose }: { id: Id<"renters">; onClose: () => void }) {
  const { t } = useI18n(); const { can } = useMe(); const openFile = useOpenFile();
  const data = useQuery(api.renters.get, { renterId: id });
  const ledger = useQuery(api.reports.tenantLedger, { renterId: id });
  const credit = useQuery(api.payments.credit, { renterId: id });
  const add = useMutation(api.renters.addDocument); const upload = useUpload(); const { run, error, notice } = useRun();
  const [kind, setKind] = useState("Business licence"); const [editing, setEditing] = useState(false);
  return (
    <Modal title={data?.renter.name ?? t("loading")} onClose={onClose}>
      {data && <div className="stack">
        <Card title={t("renter.details")} actions={can("propertyManager", "financeOfficer") ? <button className="btn sm" onClick={() => setEditing(true)}>{t("renter.edit")}</button> : undefined}>
          <dl className="dl">
            <div><dt>{t("renter.kind")}</dt><dd>{t(data.renter.kind)}</dd></div>
            <div><dt>{t("renter.phone")}</dt><dd>{data.renter.phone}</dd></div>
            {data.renter.email && <div><dt>{t("email")}</dt><dd>{data.renter.email}</dd></div>}
            {data.renter.tin && <div><dt>{t("renter.tin")}</dt><dd className="num">{data.renter.tin}</dd></div>}
            {data.renter.idNumber && <div><dt>{t("renter.idNumber")}</dt><dd>{data.renter.idNumber}</dd></div>}
            {data.renter.businessLicenseNo && <div><dt>{t("renter.license")}</dt><dd>{data.renter.businessLicenseNo}</dd></div>}
            {data.renter.licenseExpiresAt != null && <div><dt>{t("renter.licenseExpires")}</dt><dd><DateText ms={data.renter.licenseExpiresAt} />{" "}
              {data.renter.licenseExpiresAt < Date.now() ? <Badge tone="bad">{t("renter.licenseExpired")}</Badge> : data.renter.licenseExpiresAt < Date.now() + 60 * 86400000 ? <Badge tone="warn">{t("renter.licenseSoon")}</Badge> : null}</dd></div>}
            {data.renter.vatNumber && <div><dt>{t("renter.vat")}</dt><dd className="num">{data.renter.vatNumber}</dd></div>}
            {data.renter.legalRepresentative && <div><dt>{t("renter.rep")}</dt><dd>{data.renter.legalRepresentative}</dd></div>}
            {data.renter.contactPerson && <div><dt>{t("renter.contactPerson")}</dt><dd>{data.renter.contactPerson}{data.renter.contactPhone ? ` · ${data.renter.contactPhone}` : ""}</dd></div>}
            {data.renter.address && <div><dt>{t("renter.address")}</dt><dd>{data.renter.address}</dd></div>}
            {data.renter.notes && <div><dt>{t("renter.notes")}</dt><dd>{data.renter.notes}</dd></div>}
          </dl>
        </Card>
        {editing && <RenterForm renter={data.renter as RenterDoc} onClose={() => setEditing(false)} />}
        <Card title={t("renter.documents")}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{data.documents.map((d) => <li key={d._id}><button type="button" className="linklike" onClick={() => void openFile("renterDoc", d._id)}>{d.kind}</button></li>)}</ul>
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

/** Who the renters are, and who pays the most rent. Rent comes from the active leases. */
function RenterInsights({ renters }: { renters?: { _id: string; name: string; kind: "company" | "individual" }[] }) {
  const { t } = useI18n(); const leases = useQuery(api.agreements.list, { status: "active" });
  if (!renters || !leases) return <div className="kpis kpis-4">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton lines={3} /></div>)}</div>;
  if (renters.length === 0) return null;
  const rent = new Map<string, number>(), units = new Map<string, number>();
  for (const a of leases) { rent.set(a.renterId, (rent.get(a.renterId) ?? 0) + a.rent); units.set(a.renterId, (units.get(a.renterId) ?? 0) + 1); }
  const companies = renters.filter((r) => r.kind === "company").length, withLease = renters.filter((r) => rent.has(r._id)).length;
  const total = [...rent.values()].reduce((a, b) => a + b, 0), top = [...rent.entries()].sort((a, b) => b[1] - a[1])[0];
  return <>
    <div className="kpis kpis-4">
      <Kpi tone="info" icon="renters" label={t("nav.renters")} value={renters.length} sub={`${companies} ${t("company").toLowerCase()} · ${renters.length - companies} ${t("individual").toLowerCase()}`} />
      <Kpi tone="good" icon="agreements" label={t("ren.k.withLease")} value={withLease} sub={`${renters.length - withLease} ${t("ren.k.noLease")}`} />
      <Kpi tone="info" icon="payments" label={t("rep.k.monthlyRent")} unit="ETB" value={Math.round(total / 100).toLocaleString()} sub={t("ren.k.fromActive")} />
      <Kpi icon="reports" label={t("ren.k.largest")} unit="ETB" value={top ? Math.round(top[1] / 100).toLocaleString() : "0"} sub={top ? renters.find((r) => r._id === top[0])?.name : undefined} />
    </div>
    {total > 0 && <div className="cols-2">
      <Card title={t("ren.c.type")}><Ring caption={t("nav.renters")} center={renters.length} parts={[{ label: t("company"), value: companies, color: SERIES[0] }, { label: t("individual"), value: renters.length - companies, color: SERIES[1] }]} /></Card>
      <Card title={t("ren.c.top")}><HBars items={[...rent.entries()].map(([id, v]) => ({ label: renters.find((r) => r._id === id)?.name ?? "", sub: `${t("ag.unit")}: ${units.get(id)}`, value: v })).filter((x) => x.label)} limit={6} /></Card>
    </div>}
  </>;
}
