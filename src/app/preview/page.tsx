"use client";
// Design preview with sample data. Development only; needs no sign-in.
import { notFound } from "next/navigation";
import { useState } from "react";
import { Icon, Mark } from "@/components/icons";
import { Badge, Card, Empty, Modal, PageHeader, Skeleton, StatusBadge, Table, TableFoot, Tabs, Field } from "@/components/ui";
import { formatEtb, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const rows = [
  { _id: "1", number: "INV-2026-09-0001", unit: "A-101", renter: "Abebe Trading PLC", due: "2026-09-05", total: 34500000, paid: 20000000, status: "partial" },
  { _id: "2", number: "INV-2026-09-0002", unit: "A-102", renter: "Selam Pharmacy", due: "2026-09-05", total: 30000000, paid: 30000000, status: "paid" },
  { _id: "3", number: "INV-2026-09-0003", unit: "B-204", renter: "Hiwot Tailoring", due: "2026-09-05", total: 36500000, paid: 0, status: "outstanding" },
  { _id: "4", number: "", unit: "C-012", renter: "Dire Dawa Coffee House", due: "2026-10-05", total: 11250000, paid: 0, status: "draft" },
];

export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  const { t, lang, setLang, calendar, setCalendar } = useI18n();
  const [tab, setTab] = useState("");
  const [modal, setModal] = useState(false);
  const billed = 101000000, applied = 75000000, out = 26000000;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Mark /><span className="brand-text">Dire Mall<small>{t("appSub")}</small></span></div>
        <div className="tibeb" />
        <nav className="nav-scroll">
          {[["Operate", [["overview", t("nav.dashboard")], ["buildings", t("nav.properties")], ["renters", t("nav.renters")], ["agreements", t("nav.agreements")]]], ["Money", [["bills", t("nav.billing")], ["payments", t("nav.payments")], ["bank", t("nav.bank")], ["utilities", t("nav.utilities")]]], ["Insight", [["reports", t("nav.reports")], ["messages", t("nav.messages")]]]].map(([g, items]) => (
            <div className="nav-group" key={g as string}><div className="nav-label">{g as string}</div>
              {(items as string[][]).map(([ic, label]) => <a key={ic} href="#" className="nav" aria-current={ic === "overview" ? "page" : undefined}><Icon name={ic!} /><span className="nav-text">{label}</span></a>)}</div>))}
        </nav>
        <div className="side-foot"><div className="who"><div className="avatar">WA</div><div><b>Wahid</b><span>Super admin</span></div></div>
          <div className="row"><select value={lang} onChange={(e) => setLang(e.target.value as "en" | "am")}><option value="en">English</option><option value="am">አማርኛ</option></select>
            <select value={calendar} onChange={(e) => setCalendar(e.target.value as "gregorian" | "ethiopian")}><option value="gregorian">Gregorian</option><option value="ethiopian">Ethiopian</option></select></div></div>
      </aside>
      <div className="main"><header className="topbar"><b>Dire Mall</b></header><main className="content" id="main">
        <div className="stack">
          <PageHeader title={t("dash.title")}><select><option>All buildings</option></select><input type="month" defaultValue="2026-09" /></PageHeader>
          <div className="split">
            <section className="card lead">
              <div className="lead-label">{t("dash.outstanding")}</div>
              <div className="lead-fig num"><small>ETB</small>{formatEtb(out).replace("ETB ", "")}</div>
              <div className="muted">{t("dash.of")} <b className="num" style={{ color: "var(--ink)" }}>{formatEtb(billed)}</b> {t("dash.billedShort")} · <b className="num" style={{ color: "var(--ink)" }}>{pct(applied / billed)}</b> {t("dash.collected")}</div>
              <div className="seg"><i style={{ flexGrow: applied, background: "var(--accent)" }} /><i style={{ flexGrow: out, background: "color-mix(in srgb, var(--bad) 55%, var(--sunken))" }} /></div>
              <div className="legend"><span><i className="dot" style={{ background: "var(--accent)" }} />{t("dash.applied")} <b className="num">{formatEtb(applied)}</b></span><span><i className="dot" style={{ background: "color-mix(in srgb, var(--bad) 55%, var(--sunken))" }} />{t("dash.stillDue")} <b className="num">{formatEtb(out)}</b></span></div>
            </section>
            <Card title={t("dash.attention")}><div className="tasks">
              {[[3, t("att.draftInvoices")], [2, t("att.paymentsToConfirm")], [1, t("att.paymentsToApply")], [4, t("att.expiringAgreements")]].map(([n, l]) => <a key={l as string} className="task" href="#"><span className="count">{n}</span><span>{l}</span><span className="chev"><Icon name="chevron" size={16} /></span></a>)}</div></Card>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[["", "All"], ["draft", "Draft"], ["issued", "Issued"]]} />
          <Card flush>
            <Table rows={rows} onRow={() => setModal(true)} cols={[
              { head: "Bill", cell: (r) => r.number || "Draft" }, { head: "Unit", cell: (r) => <strong>{r.unit}</strong> }, { head: "Renter", cell: (r) => r.renter }, { head: "Due", cell: (r) => r.due },
              { head: "Total", cell: (r) => formatEtb(r.total), right: true }, { head: "Still due", cell: (r) => <strong>{formatEtb(r.total - r.paid)}</strong>, right: true }, { head: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            ]} />
            <TableFoot items={[["Total", formatEtb(112250000)], ["Paid", formatEtb(50000000)], ["Still due", formatEtb(62250000)]]} />
          </Card>
          <div className="grid">
            <Card title="Loading"><Skeleton lines={4} /></Card>
            <Card title="Empty"><Empty title="No payments yet" hint="Record the first payment to see it here." action={<button className="btn primary"><Icon name="plus" />Record payment</button>} /></Card>
            <Card title="Badges"><div className="row">{["active", "draft", "partial", "outstanding", "paid", "vacant", "flagged"].map((s) => <StatusBadge key={s} status={s} />)}<Badge tone="info">info</Badge></div></Card>
          </div>
        </div>
      </main></div>
      {modal && <Modal title="Record payment" onClose={() => setModal(false)}><div className="form"><Field label="Renter"><select><option>Abebe Trading PLC</option></select></Field><Field label="Amount (ETB)"><input defaultValue="200,000.00" /></Field><div className="wide row" style={{ justifyContent: "flex-end" }}><button className="btn ghost" onClick={() => setModal(false)}>Cancel</button><button className="btn primary">Save</button></div></div></Modal>}
    </div>
  );
}
