"use client";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Card, Skeleton, DateField, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, SearchInput, StatusBadge, Table, Tabs , SelectField } from "@/components/ui";
import { HBars, Columns, Ring, SERIES, compact } from "@/components/charts";
import { Kpi } from "@/components/ui";
import { pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { failures, inRange, nonNegative } from "@/lib/validate";
import { dayAfter, lastDay } from "@/lib/format";

export default function Agreements() {
  const { t } = useI18n(); const { can } = useMe(); const router = useRouter();
  const [tab, setTab] = useState<"" | "draft" | "inReview" | "active" | "expired" | "terminated">("");
  const [ending, setEnding] = useState(false); const [adding, setAdding] = useState(false); const [preset, setPreset] = useState(""); const [q, setQ] = useState("");
  // "New agreement" from a vacant unit card arrives as /agreements?new=<unit id>
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("new"); if (id) { setPreset(id); setAdding(true); window.history.replaceState(null, "", "/agreements"); } }, []);
  const everything = useQuery(api.agreements.list, {}); const listAll = tab ? everything?.filter((a) => a.status === tab) : everything;
  const needle = q.trim().toLowerCase();
  const soon = Date.now() + 60 * 86400000;
  const endingSoon = (a: { status: string; endsAt: number }) => a.status === "active" && a.endsAt <= soon;
  const list = listAll?.filter((a) => (!ending || endingSoon(a)) && (!needle || `${a.unitNumber} ${a.renterName}`.toLowerCase().includes(needle)));
  return (
    <div className="stack">
      <PageHeader title={t("nav.agreements")} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchAgreements")} /><Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["", t("all")], ["draft", t("draft")], ["inReview", t("inReview")], ["active", t("active")], ["expired", t("expired")], ["terminated", t("terminated")]]} /><button type="button" className={`chip-toggle ${ending ? "on" : ""}`} aria-pressed={ending} onClick={() => setEnding(!ending)}>{t("ag.endingSoon")}{listAll ? ` (${listAll.filter(endingSoon).length})` : ""}</button></>}
        actions={can("propertyManager") ? <button className="btn primary" onClick={() => setAdding(true)}>{t("ag.new")}</button> : undefined} />
      <AgreementInsights all={everything} />
      <Card flush><Table rows={list} empty={t("empty.agreements")} onRow={(a) => router.push(`/agreements/${a._id}`)} cols={[
        { head: t("ag.unit"), cell: (a) => <strong>{a.unitNumber}</strong>, sort: (a) => a.unitNumber }, { head: t("ag.renter"), cell: (a) => a.renterName, sort: (a) => a.renterName },
        { head: t("ag.start"), cell: (a) => <DateText ms={a.startsAt} />, sort: (a) => a.startsAt },
        { head: t("ag.end"), cell: (a) => <div className="two-line"><DateText ms={lastDay(a.endsAt)} />{a.status === "active" && <Badge tone={endingSoon(a) ? "warn" : "muted"}>{t("ag.daysLeft").replace("{n}", String(Math.max(0, Math.ceil((a.endsAt - Date.now()) / 86400000))))}</Badge>}</div>, sort: (a) => a.endsAt },
        { head: t("ag.rentMonth"), cell: (a) => <Money v={a.rent} />, right: true, money: true, sort: (a) => a.rent },
        { head: t("ag.signed"), cell: (a) => (a.signedFileId ? "✓" : "—") }, { head: t("status"), cell: (a) => <StatusBadge status={a.status} /> },
      ]} /></Card>
      {adding && <NewAgreement presetUnit={preset} onClose={() => setAdding(false)} onCreated={(id) => router.push(`/agreements/${id}`)} />}
    </div>
  );
}

function NewAgreement({ presetUnit, onClose, onCreated }: { presetUnit?: string; onClose: () => void; onCreated: (id: Id<"agreements">) => void }) {
  const { t } = useI18n(); const create = useMutation(api.agreements.createDraft); const { run, error, busy } = useRun();
  const vacant = useQuery(api.properties.listUnits, { status: "vacant" }); const renters = useQuery(api.renters.list, {});
  const [unitId, setUnitId] = useState(presetUnit ?? ""); const [renterId, setRenterId] = useState("");
  const [start, setStart] = useState<number | null>(null); const [end, setEnd] = useState<number | null>(null);
  const [basis, setBasis] = useState<"perM2" | "fixed">("perM2"); const [amount, setAmount] = useState<number | null>(null);
  const [dueDay, setDueDay] = useState(5); const [deposit, setDeposit] = useState<number | null>(0);
  const [escPct, setEscPct] = useState(""); const [escEvery, setEscEvery] = useState("12");
  const unit = vacant?.find((u) => u._id === unitId);
  useEffect(() => { if (presetUnit && unit && amount == null && basis === "perM2") setAmount(unit.ratePerM2); }, [presetUnit, unit, amount, basis]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clear = (k: string) => errs[k] && setErrs({ ...errs, [k]: "" });
  return (
    <Modal title={t("ag.new")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const esc = escPct.trim() === "" ? null : inRange(Number(escPct), 0.01, 100, t("v.percent")) ?? inRange(Number(escEvery), 1, 60, t("v.months"));
        const found = failures({ unit: unitId ? null : t("v.pick"), renter: renterId ? null : t("v.pick"), start: start == null ? t("v.date") : null, end: end == null ? t("v.date") : start != null && end < start ? t("v.dateOrder") : null, amount: nonNegative(amount, t), dueDay: inRange(dueDay, 1, 28, t("v.dueDay")), deposit: nonNegative(deposit, t), esc });
        setErrs(found); if (Object.keys(found).length) return;
        const id = await run(() => create({ unitId: unitId as Id<"units">, renterId: renterId as Id<"renters">, startsAt: start!, endsAt: dayAfter(end!), rent: basis === "fixed" ? { kind: "fixed", amount: amount! } : { kind: "perM2", ratePerM2: amount! }, dueDay, depositAmount: deposit!, escalation: Number(escPct) > 0 ? { percent: Number(escPct), everyMonths: Number(escEvery) } : undefined }));
        if (id) onCreated(id);
      }}>
        <SelectField label={t("ag.unit")} error={errs.unit} value={unitId} onChange={(v) => { clear("unit"); setUnitId(v); const u = vacant?.find((x) => x._id === v); if (u && basis === "perM2") setAmount(u.ratePerM2); }} options={(vacant ?? []).map((u) => ({ value: u._id, label: `${u.number} — ${u.areaM2} m²` }))} />
        <SelectField label={t("ag.renter")} error={errs.renter} value={renterId} onChange={(v) => { setRenterId(v); clear("renter"); }} options={(renters ?? []).map((r) => ({ value: r._id, label: r.name }))} />
        <Field label={t("ag.start")} error={errs.start}><DateField value={start} onChange={(v) => { setStart(v); clear("start"); clear("end"); }} /></Field>
        <Field label={t("ag.end")} error={errs.end}><DateField value={end} onChange={(v) => { setEnd(v); clear("end"); }} /></Field>
        <SelectField label={t("ag.rentBasis")} value={basis} onChange={(v) => { setBasis(v as "perM2" | "fixed"); setAmount(v === "perM2" && unit ? unit.ratePerM2 : null); }} options={[{ value: "perM2", label: t("ag.perM2") }, { value: "fixed", label: t("ag.fixed") }]} />
        <Field label={basis === "perM2" ? t("prop.rate") : t("amount")} error={errs.amount}><MoneyInput key={basis + unitId} value={amount} onChange={(v) => { setAmount(v); clear("amount"); }} /></Field>
        <Field label={t("ag.dueDay")} error={errs.dueDay}><input type="number" min={1} max={28} value={dueDay} onChange={(e) => { setDueDay(Number(e.target.value)); clear("dueDay"); }} /></Field>
        <Field label={t("ag.deposit")} error={errs.deposit}><MoneyInput value={deposit} onChange={(v) => { setDeposit(v); clear("deposit"); }} /></Field>
        <Field label={t("ag.escPct")} error={errs.esc} hint={t("optional")}><input inputMode="decimal" value={escPct} onChange={(e) => { setEscPct(e.target.value); clear("esc"); }} placeholder="10" /></Field>
        <Field label={t("ag.escEvery")}><input type="number" min={1} max={60} value={escEvery} onChange={(e) => setEscEvery(e.target.value)} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

type Lease = { status: string; endsAt: number; rent: number; depositAmount?: number; renterName: string; unitNumber: string };

/** The state of the lease book: what is live, what is about to end, and what rent is under contract. */
function AgreementInsights({ all }: { all?: Lease[] }) {
  const { t } = useI18n();
  if (!all) return <div className="kpis kpis-4">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton lines={3} /></div>)}</div>;
  if (all.length === 0) return null;
  const now = Date.now(), active = all.filter((a) => a.status === "active"), soon = active.filter((a) => a.endsAt <= now + 60 * 86400000);
  const count = (s: string) => all.filter((a) => a.status === s).length;
  const rent = active.reduce((a, l) => a + l.rent, 0);
  const next = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => { const d = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + i, 1)); const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); return { label: d.toISOString().slice(2, 7), value: active.filter((l) => l.endsAt >= d.getTime() && l.endsAt < end).reduce((a, l) => a + l.rent, 0), sub: `${active.filter((l) => l.endsAt >= d.getTime() && l.endsAt < end).length} ${t("rep.leases")}` }; });
  const left = active.filter((a) => a.endsAt > now).reduce((a, l) => a + (l.endsAt - now), 0) / Math.max(1, active.filter((a) => a.endsAt > now).length) / (30.44 * 86400000);
  return <>
    <div className="kpis kpis-4">
      <Kpi tone="good" icon="agreements" label={t("active")} value={active.length} sub={`${all.length} ${t("ag.k.total")}`} />
      <Kpi tone="info" icon="payments" label={t("ag.k.contracted")} unit="ETB" value={Math.round(rent / 100).toLocaleString()} sub={`${compact(rent * 12)} ${t("rep.k.yearly")}`} />
      <Kpi tone={soon.length ? "warn" : "good"} icon="alert" label={t("ag.k.endingSoon")} value={soon.length} sub={t("ag.k.within60")} />
      <Kpi icon="reports" label={t("ag.k.avgLeft")} value={`${left.toFixed(1)}`} sub={t("ag.k.months")} />
    </div>
    <div className="cols-2">
      <Card title={t("ag.c.status")}><Ring caption={t("nav.agreements")} center={all.length} parts={[{ label: t("active"), value: count("active"), color: SERIES[1] }, { label: t("draft") + " / " + t("inReview"), value: count("draft") + count("inReview"), color: SERIES[2] }, { label: t("expired"), value: count("expired"), color: SERIES[4] }, { label: t("terminated"), value: count("terminated"), color: SERIES[3] }]} /></Card>
      <Card title={t("ag.c.endings")}><Columns items={next} /></Card>
    </div>
  </>;
}
