"use client";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Card, DateField, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, SearchInput, StatusBadge, Table, Tabs } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { failures, inRange, nonNegative } from "@/lib/validate";

export default function Agreements() {
  const { t } = useI18n(); const { can } = useMe(); const router = useRouter();
  const [tab, setTab] = useState<"" | "draft" | "inReview" | "active" | "expired" | "terminated">("");
  const [ending, setEnding] = useState(false); const [adding, setAdding] = useState(false); const [preset, setPreset] = useState(""); const [q, setQ] = useState("");
  // "New agreement" from a vacant unit card arrives as /agreements?new=<unit id>
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("new"); if (id) { setPreset(id); setAdding(true); window.history.replaceState(null, "", "/agreements"); } }, []);
  const listAll = useQuery(api.agreements.list, { status: tab || undefined });
  const needle = q.trim().toLowerCase();
  const soon = Date.now() + 60 * 86400000;
  const endingSoon = (a: { status: string; endsAt: number }) => a.status === "active" && a.endsAt <= soon;
  const list = listAll?.filter((a) => (!ending || endingSoon(a)) && (!needle || `${a.unitNumber} ${a.renterName}`.toLowerCase().includes(needle)));
  return (
    <div className="stack">
      <PageHeader title={t("nav.agreements")} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchAgreements")} /><Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["", t("all")], ["draft", t("draft")], ["inReview", t("inReview")], ["active", t("active")], ["expired", t("expired")], ["terminated", t("terminated")]]} /><button type="button" className={`chip-toggle ${ending ? "on" : ""}`} aria-pressed={ending} onClick={() => setEnding(!ending)}>{t("ag.endingSoon")}{listAll ? ` (${listAll.filter(endingSoon).length})` : ""}</button></>}
        actions={can("propertyManager") ? <button className="btn primary" onClick={() => setAdding(true)}>{t("ag.new")}</button> : undefined} />
      <Card flush><Table rows={list} empty={t("empty.agreements")} onRow={(a) => router.push(`/agreements/${a._id}`)} cols={[
        { head: t("ag.unit"), cell: (a) => <strong>{a.unitNumber}</strong>, sort: (a) => a.unitNumber }, { head: t("ag.renter"), cell: (a) => a.renterName, sort: (a) => a.renterName },
        { head: t("ag.start"), cell: (a) => <DateText ms={a.startsAt} />, sort: (a) => a.startsAt },
        { head: t("ag.end"), cell: (a) => <div className="two-line"><DateText ms={a.endsAt} />{a.status === "active" && <Badge tone={endingSoon(a) ? "warn" : "muted"}>{t("ag.daysLeft").replace("{n}", String(Math.max(0, Math.ceil((a.endsAt - Date.now()) / 86400000))))}</Badge>}</div>, sort: (a) => a.endsAt },
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
        const found = failures({ unit: unitId ? null : t("v.pick"), renter: renterId ? null : t("v.pick"), start: start == null ? t("v.date") : null, end: end == null ? t("v.date") : start != null && end <= start ? t("v.dateOrder") : null, amount: nonNegative(amount, t), dueDay: inRange(dueDay, 1, 28, t("v.dueDay")), deposit: nonNegative(deposit, t), esc });
        setErrs(found); if (Object.keys(found).length) return;
        const id = await run(() => create({ unitId: unitId as Id<"units">, renterId: renterId as Id<"renters">, startsAt: start!, endsAt: end!, rent: basis === "fixed" ? { kind: "fixed", amount: amount! } : { kind: "perM2", ratePerM2: amount! }, dueDay, depositAmount: deposit!, escalation: Number(escPct) > 0 ? { percent: Number(escPct), everyMonths: Number(escEvery) } : undefined }));
        if (id) onCreated(id);
      }}>
        <Field label={t("ag.unit")} error={errs.unit}><select value={unitId} onChange={(e) => { clear("unit"); setUnitId(e.target.value); const u = vacant?.find((x) => x._id === e.target.value); if (u && basis === "perM2") setAmount(u.ratePerM2); }}><option value="" />{vacant?.map((u) => <option key={u._id} value={u._id}>{u.number} — {u.areaM2} m²</option>)}</select></Field>
        <Field label={t("ag.renter")} error={errs.renter}><select value={renterId} onChange={(e) => { setRenterId(e.target.value); clear("renter"); }}><option value="" />{renters?.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</select></Field>
        <Field label={t("ag.start")} error={errs.start}><DateField value={start} onChange={(v) => { setStart(v); clear("start"); clear("end"); }} /></Field>
        <Field label={t("ag.end")} error={errs.end}><DateField value={end} onChange={(v) => { setEnd(v); clear("end"); }} /></Field>
        <Field label={t("ag.rentBasis")}><select value={basis} onChange={(e) => { setBasis(e.target.value as "perM2" | "fixed"); setAmount(e.target.value === "perM2" && unit ? unit.ratePerM2 : null); }}><option value="perM2">{t("ag.perM2")}</option><option value="fixed">{t("ag.fixed")}</option></select></Field>
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
