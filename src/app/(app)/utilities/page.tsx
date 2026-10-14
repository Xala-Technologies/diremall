"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BuildingSelect, Card, DateField, DateText, Field, Message, Modal, Money, MoneyInput, PageHeader, PeriodPicker, StatusBadge, Table, Tabs } from "@/components/ui";
import { currentPeriod } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function Utilities() {
  const { t } = useI18n(); const [tab, setTab] = useState<"readings" | "shared">("readings");
  return (
    <div className="stack">
      <PageHeader title={t("nav.utilities")} />
      <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["readings", t("util.meters")], ["shared", t("util.shared")]]} />
      {tab === "readings" ? <Readings /> : <Shared />}
    </div>
  );
}

function Readings() {
  const { t } = useI18n(); const { can, me } = useMe();
  const pending = useQuery(api.utilities.pendingReadings);
  const units = useQuery(api.properties.listUnits, {});
  const approve = useMutation(api.utilities.approveReading); const review = useMutation(api.utilities.reviewFlagged);
  const { run, error, notice } = useRun(); const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <div className="row">{can("propertyManager", "financeOfficer") && <button className="btn primary" onClick={() => setAdding(true)}>{t("util.reading")}</button>}</div>
      <Message error={error} notice={notice} />
      <Card title={`${t("draft")} / ${t("flagged")}`}><Table rows={pending} empty={t("empty.utilities")} cols={[
        { head: t("ag.unit"), cell: (r) => r.unitNumber }, { head: t("util.meters"), cell: (r) => t(r.meterKind) }, { head: t("date"), cell: (r) => <DateText ms={r.readAt} /> },
        { head: t("util.value"), cell: (r) => r.value, right: true }, { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> },
        { head: "", cell: (r) => r.enteredBy === me?._id ? null : r.status === "draft" && can("financeOfficer", "approver")
          ? <button className="btn sm" onClick={() => void run(() => approve({ readingId: r._id }))}>{t("util.approve")}</button>
          : r.status === "flagged" && can("approver") ? <div className="row">
            <button className="btn sm" onClick={() => void run(() => review({ readingId: r._id, decision: "accept" }))}>{t("util.accept")}</button>
            <button className="btn sm" onClick={() => void run(() => review({ readingId: r._id, decision: "reset" }))}>{t("util.reset")}</button></div> : null },
      ]} /></Card>
      {adding && units && <ReadingForm units={units} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ReadingForm({ units, onClose }: { units: { _id: Id<"units">; number: string }[]; onClose: () => void }) {
  const { t } = useI18n(); const [unitId, setUnitId] = useState<Id<"units"> | "">("");
  const meters = useQuery(api.utilities.meters, unitId ? { unitId } : "skip");
  const addMeter = useMutation(api.utilities.addMeter); const enter = useMutation(api.utilities.enterReading);
  const { run, error, notice } = useRun();
  const [meterId, setMeterId] = useState(""); const [value, setValue] = useState(""); const [at, setAt] = useState<number | null>(null); const [reset, setReset] = useState(false);
  const [kind, setKind] = useState<"electricity" | "water">("electricity"); const [serial, setSerial] = useState("");
  return (
    <Modal title={t("util.reading")} onClose={onClose}>
      <div className="form">
        <Field label={t("ag.unit")}><select value={unitId} onChange={(e) => { setUnitId(e.target.value as Id<"units">); setMeterId(""); }}><option value="" />{units.map((u) => <option key={u._id} value={u._id}>{u.number}</option>)}</select></Field>
        <Field label={t("util.meters")}><select value={meterId} onChange={(e) => setMeterId(e.target.value)}><option value="" />{meters?.map((m) => <option key={m._id} value={m._id}>{t(m.kind)} · {m.serial}</option>)}</select></Field>
        <Field label={t("util.value")}><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label={t("date")}><DateField value={at} onChange={setAt} /></Field>
        <label className="row wide"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} /> {t("util.reset")}</label>
        <div className="wide"><button className="btn primary" disabled={!meterId || value === "" || at == null} onClick={() => void run(async () => { const r = await enter({ meterId: meterId as Id<"meters">, value: Number(value), readAt: at!, isReset: reset }); setValue(""); return r; }, t("saved"))}>{t("save")}</button></div>
        {unitId && <><hr className="wide" style={{ width: "100%", border: 0, borderTop: "1px solid var(--line)" }} />
          <Field label={t("util.addMeter")}><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="electricity">{t("electricity")}</option><option value="water">{t("water")}</option></select></Field>
          <Field label="Serial"><input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
          <div className="wide"><button className="btn" disabled={!serial} onClick={() => void run(async () => { await addMeter({ unitId, kind, serial }); setSerial(""); })}>{t("util.addMeter")}</button></div></>}
        <div className="wide"><Message error={error} notice={notice} /></div>
      </div>
    </Modal>
  );
}

function Shared() {
  const { t } = useI18n(); const { can, me } = useMe();
  const buildings = useQuery(api.properties.listBuildings); const [building, setBuilding] = useState(""); const [period, setPeriod] = useState(currentPeriod());
  const costs = useQuery(api.utilities.sharedCosts, building ? { buildingId: building as Id<"buildings">, period } : "skip");
  const create = useMutation(api.utilities.createSharedCost); const approve = useMutation(api.utilities.approveSharedCost);
  const { run, error, notice } = useRun();
  const [kind, setKind] = useState<"generator" | "security" | "cleaning">("generator"); const [total, setTotal] = useState<number | null>(null);
  return (
    <div className="stack">
      <div className="row"><BuildingSelect buildings={buildings} value={building} onChange={setBuilding} /><PeriodPicker value={period} onChange={setPeriod} /></div>
      {building && can("financeOfficer") && <Card title={t("util.newShared")}><div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{(["generator", "security", "cleaning"] as const).map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
        <MoneyInput value={total} onChange={setTotal} placeholder={`${t("amount")} (ETB)`} />
        <button className="btn primary" disabled={!total} onClick={() => void run(() => create({ buildingId: building as Id<"buildings">, kind, period, total: total! }), t("saved"))}>{t("create")}</button></div></Card>}
      <Message error={error} notice={notice} />
      <Card flush><Table rows={costs} empty={building ? "—" : t("allBuildings")} cols={[
        { head: t("util.shared"), cell: (c) => t(c.kind) }, { head: t("total"), cell: (c) => <Money v={c.total} />, right: true, money: true },
        { head: t("util.ownerShare"), cell: (c) => <Money v={c.ownerShare} />, right: true, money: true },
        { head: t("status"), cell: (c) => (c.approvedBy ? <StatusBadge status="approved" /> : can("approver") && c.createdBy !== me?._id ? <button className="btn sm" onClick={() => void run(() => approve({ sharedCostId: c._id }))}>{t("bill.approve")}</button> : <StatusBadge status="draft" />) },
      ]} /></Card>
    </div>
  );
}
