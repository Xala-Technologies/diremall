"use client";
import { useMutation, useQuery } from "convex/react";
import { Droplets, Zap } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BuildingSelect, Card, DateField, DateText, Field, Kpi, Message, Modal, Money, MoneyInput, PageHeader, PeriodPicker, StatusBadge, Table, Tabs } from "@/components/ui";
import { currentPeriod } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { usePeriod } from "@/lib/usePeriod";
import { useRun } from "@/lib/useRun";

type Preset = { unitId: Id<"units">; meterId: Id<"meters"> };

export default function Utilities() {
  const { t } = useI18n(); const [tab, setTab] = useState<"readings" | "shared">("readings");
  return (
    <div className="stack">
      <PageHeader title={t("nav.utilities")} filters={<Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[["readings", t("util.meters")], ["shared", t("util.shared")]]} />} />
      {tab === "readings" ? <Readings /> : <Shared />}
    </div>
  );
}

const KindIcon = ({ kind }: { kind: "electricity" | "water" }) => (kind === "electricity" ? <Zap size={15} aria-hidden="true" /> : <Droplets size={15} aria-hidden="true" />);

/** Every meter for the month, with what billing will do with it, and the readings still waiting for review. */
function Readings() {
  const { t } = useI18n(); const { can, me } = useMe();
  const [period, setPeriod] = usePeriod(); const [building, setBuilding] = useState("");
  const buildings = useQuery(api.properties.listBuildings, {});
  const reg = useQuery(api.utilities.register, { period, buildingId: (building || undefined) as Id<"buildings"> | undefined });
  const pending = useQuery(api.utilities.pendingReadings);
  const units = useQuery(api.properties.listUnits, {});
  const approve = useMutation(api.utilities.approveReading); const review = useMutation(api.utilities.reviewFlagged);
  const { run, error, notice } = useRun();
  const [form, setForm] = useState<{ preset?: Preset } | null>(null); const [history, setHistory] = useState<{ meterId: Id<"meters">; title: string } | null>(null);
  const canEnter = can("propertyManager", "financeOfficer");
  const s = reg?.summary;
  return (
    <div className="stack">
      <div className="filter-bar" style={{ gridArea: "auto" }}><BuildingSelect buildings={buildings} value={building} onChange={setBuilding} /><PeriodPicker value={period} onChange={setPeriod} />
        <span className="spacer" />{canEnter && <button className="btn primary" onClick={() => setForm({})}>{t("util.reading")}</button>}</div>
      <Message error={error} notice={notice} />
      <div className="kpis kpis-4">
        <Kpi icon="utilities" label={t("util.kpi.meters")} value={s ? s.meters : "–"} sub={s && s.withoutMeter > 0 ? t("util.noMeter").replace("{n}", String(s.withoutMeter)) : undefined} />
        <Kpi icon="check" tone="good" label={t("util.kpi.ready")} value={s ? s.ready : "–"} sub={t("util.kpi.readySub")} />
        <Kpi icon="alert" tone={s?.waiting ? "warn" : "good"} label={t("util.kpi.waiting")} value={s ? s.waiting : "–"} />
        <Kpi icon="history" tone={s?.missing ? "bad" : "good"} label={t("util.kpi.missing")} value={s ? s.missing : "–"} sub={s?.missing ? t("util.kpi.missingSub") : undefined} />
      </div>
      <Card flush title={t("util.register")}>
        <Table rows={reg?.rows.map((r) => ({ ...r, _id: r.meterId }))} empty={t("util.noMeters")} onRow={(r) => setHistory({ meterId: r.meterId, title: `${r.unitNumber} · ${t(r.kind)} ${r.serial}` })} cols={[
          { head: t("ag.unit"), cell: (r) => <div className="two-line"><strong>{r.unitNumber}</strong>{r.renterName && <small className="muted">{r.renterName}</small>}</div>, sort: (r) => r.unitNumber },
          { head: t("util.meter"), cell: (r) => <span className="kind"><KindIcon kind={r.kind} />{t(r.kind)} <span className="muted">{r.serial}</span></span> },
          { head: t("util.prev"), cell: (r) => r.previous ?? "—", right: true },
          { head: t("util.thisMonth"), cell: (r) => r.latest ?? "—", right: true },
          { head: t("util.usage"), cell: (r) => (r.usage ?? "—"), right: true, sort: (r) => r.usage ?? -1 },
          { head: t("util.charge"), cell: (r) => (r.charge ? <Money v={r.charge} strong /> : "—"), right: true, money: true },
          { head: t("status"), cell: (r) => <StatusBadge status={r.status} />, sort: (r) => r.status },
          { head: "", cell: (r) => canEnter && r.status !== "ready" ? <button className="btn sm" onClick={(e) => { e.stopPropagation(); setForm({ preset: { unitId: r.unitId, meterId: r.meterId } }); }}>{t("util.enter")}</button> : null },
        ]} />
      </Card>
      {pending && pending.length > 0 && <Card flush title={`${t("util.waitingTitle")} (${pending.length})`}><Table rows={pending} cols={[
        { head: t("ag.unit"), cell: (r) => r.unitNumber }, { head: t("util.meters"), cell: (r) => t(r.meterKind) }, { head: t("date"), cell: (r) => <DateText ms={r.readAt} /> },
        { head: t("util.value"), cell: (r) => r.value, right: true }, { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> },
        { head: "", cell: (r) => r.enteredBy === me?._id ? <small className="muted">{t("err.same_person_cannot_approve")}</small> : r.status === "draft" && can("financeOfficer", "approver")
          ? <button className="btn sm primary" onClick={() => void run(() => approve({ readingId: r._id }), t("saved"))}>{t("util.approve")}</button>
          : r.status === "flagged" && can("approver") ? <div className="row">
            <button className="btn sm" onClick={() => void run(() => review({ readingId: r._id, decision: "accept" }), t("saved"))}>{t("util.accept")}</button>
            <button className="btn sm" onClick={() => void run(() => review({ readingId: r._id, decision: "reset" }), t("saved"))}>{t("util.reset")}</button></div> : null },
      ]} /></Card>}
      {form && units && <ReadingForm units={units} preset={form.preset} onClose={() => setForm(null)} />}
      {history && <MeterHistory meterId={history.meterId} title={history.title} onClose={() => setHistory(null)} />}
    </div>
  );
}

/** Enter a reading. The last reading is shown, and a value that looks wrong is called out before saving. */
function ReadingForm({ units, preset, onClose }: { units: { _id: Id<"units">; number: string }[]; preset?: Preset; onClose: () => void }) {
  const { t } = useI18n(); const [unitId, setUnitId] = useState<Id<"units"> | "">(preset?.unitId ?? "");
  const meters = useQuery(api.utilities.meters, unitId ? { unitId } : "skip");
  const addMeter = useMutation(api.utilities.addMeter); const enter = useMutation(api.utilities.enterReading);
  const { run, error, notice } = useRun();
  const [meterId, setMeterId] = useState<string>(preset?.meterId ?? ""); const [value, setValue] = useState(""); const [at, setAt] = useState<number | null>(() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }); const [reset, setReset] = useState(false);
  const [kind, setKind] = useState<"electricity" | "water">("electricity"); const [serial, setSerial] = useState("");
  const history = useQuery(api.utilities.readings, meterId ? { meterId: meterId as Id<"meters"> } : "skip");
  const last = history?.filter((r) => r.status !== "flagged").sort((a, b) => a.readAt - b.readAt).at(-1);
  const num = value.trim() === "" ? null : Number(value);
  const lower = last && num != null && Number.isFinite(num) && num < last.value && !reset;
  const usage = last && num != null && Number.isFinite(num) && num >= last.value && !reset ? num - last.value : null;
  return (
    <Modal title={t("util.reading")} onClose={onClose}>
      <div className="form">
        <Field label={t("ag.unit")}><select value={unitId} onChange={(e) => { setUnitId(e.target.value as Id<"units">); setMeterId(""); }}><option value="" />{units.map((u) => <option key={u._id} value={u._id}>{u.number}</option>)}</select></Field>
        <Field label={t("util.meters")}><select value={meterId} onChange={(e) => setMeterId(e.target.value)}><option value="" />{meters?.map((m) => <option key={m._id} value={m._id}>{t(m.kind)} · {m.serial}</option>)}</select></Field>
        {meterId && <p className="muted wide">{last ? <>{t("util.lastReading")}: <b className="num">{last.value}</b> · <DateText ms={last.readAt} /></> : t("util.firstReading")}{usage != null && <> · {t("util.usage")}: <b className="num">+{usage}</b></>}</p>}
        <Field label={t("util.value")}><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label={t("date")}><DateField value={at} onChange={setAt} /></Field>
        <label className="row wide"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} /> {t("util.reset")}</label>
        {lower && <p className="msg bad wide" role="alert">{t("util.lowWarn").replace("{v}", String(last!.value))}</p>}
        <div className="wide"><button className="btn primary" disabled={!meterId || value === "" || at == null || !Number.isFinite(num)} onClick={() => void run(async () => { const r = await enter({ meterId: meterId as Id<"meters">, value: Number(value), readAt: at!, isReset: reset }); setValue(""); return r; }, t("saved"))}>{t("save")}</button></div>
        {unitId && <><hr className="wide" style={{ width: "100%", border: 0, borderTop: "1px solid var(--line)" }} />
          <Field label={t("util.addMeter")}><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="electricity">{t("electricity")}</option><option value="water">{t("water")}</option></select></Field>
          <Field label={t("util.serial")}><input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
          <div className="wide"><button className="btn" disabled={!serial} onClick={() => void run(async () => { await addMeter({ unitId, kind, serial }); setSerial(""); })}>{t("util.addMeter")}</button></div></>}
        <div className="wide"><Message error={error} notice={notice} /></div>
      </div>
    </Modal>
  );
}

/** All readings of one meter with the step from the one before. */
function MeterHistory({ meterId, title, onClose }: { meterId: Id<"meters">; title: string; onClose: () => void }) {
  const { t } = useI18n(); const rows = useQuery(api.utilities.readings, { meterId });
  const sorted = rows?.slice().sort((a, b) => a.readAt - b.readAt);
  const withStep = sorted?.map((r, i) => ({ ...r, step: i > 0 && !r.isReset ? r.value - sorted[i - 1]!.value : null })).reverse();
  return (
    <Modal title={`${t("util.history")}: ${title}`} onClose={onClose}>
      <Table rows={withStep} empty={t("util.noReadings")} cols={[
        { head: t("date"), cell: (r) => <DateText ms={r.readAt} /> }, { head: t("util.value"), cell: (r) => r.value, right: true },
        { head: t("util.usage"), cell: (r) => (r.isReset ? t("util.resetShort") : r.step ?? "—"), right: true }, { head: t("status"), cell: (r) => <StatusBadge status={r.status} /> },
      ]} />
    </Modal>
  );
}

function Shared() {
  const { t } = useI18n(); const { can, me } = useMe();
  const buildings = useQuery(api.properties.listBuildings, {}); const [building, setBuilding] = useState(""); const [period, setPeriod] = useState(currentPeriod());
  const costs = useQuery(api.utilities.sharedCosts, building ? { buildingId: building as Id<"buildings">, period } : "skip");
  const units = useQuery(api.properties.listUnits, building ? { buildingId: building as Id<"buildings"> } : "skip");
  const create = useMutation(api.utilities.createSharedCost); const approve = useMutation(api.utilities.approveSharedCost);
  const { run, error, notice } = useRun();
  const [kind, setKind] = useState<"generator" | "security" | "cleaning">("generator"); const [total, setTotal] = useState<number | null>(null); const [open, setOpen] = useState<string | null>(null);
  const shown = costs?.find((c) => c._id === open);
  return (
    <div className="stack">
      <div className="filter-bar" style={{ gridArea: "auto" }}><BuildingSelect buildings={buildings} value={building} onChange={setBuilding} /><PeriodPicker value={period} onChange={setPeriod} /></div>
      <p className="muted">{t("util.sharedHint")}</p>
      {building && can("financeOfficer") && <Card title={t("util.newShared")}><div className="row">
        <select aria-label={t("util.shared")} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{(["generator", "security", "cleaning"] as const).map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
        <MoneyInput value={total} onChange={setTotal} placeholder={`${t("amount")} (ETB)`} />
        <button className="btn primary" disabled={!total} onClick={() => void run(() => create({ buildingId: building as Id<"buildings">, kind, period, total: total! }), t("saved"))}>{t("create")}</button></div></Card>}
      <Message error={error} notice={notice} />
      <Card flush><Table rows={costs} empty={building ? t("util.noShared") : t("util.pickBuilding")} onRow={(c) => setOpen(c._id)} cols={[
        { head: t("util.shared"), cell: (c) => t(c.kind) }, { head: t("total"), cell: (c) => <Money v={c.total} strong />, right: true, money: true },
        { head: t("util.ownerShare"), cell: (c) => <Money v={c.ownerShare} />, right: true, money: true },
        { head: t("status"), cell: (c) => (c.approvedBy ? <StatusBadge status="approved" /> : <StatusBadge status="inReview" />) },
        { head: "", cell: (c) => <div className="row" onClick={(e) => e.stopPropagation()}>
          {!c.approvedBy && can("approver") && c.createdBy !== me?._id && <button className="btn sm primary" onClick={() => void run(() => approve({ sharedCostId: c._id }), t("saved"))}>{t("bill.approve")}</button>}
          <button className="btn sm" onClick={() => setOpen(c._id)}>{t("util.split")}</button></div> },
      ]} /></Card>
      {shown && <Modal title={`${t(shown.kind)} · ${period}`} onClose={() => setOpen(null)}>
        <div className="stack">
          <p className="muted">{t("util.splitHint")}</p>
          <Table rows={shown.allocations.map((a) => ({ ...a, _id: a._id, unit: units?.find((u) => u._id === a.unitId) }))} cols={[
            { head: t("ag.unit"), cell: (a) => <strong>{a.unit?.number ?? "—"}</strong> }, { head: t("prop.area"), cell: (a) => a.unit?.areaM2 ?? "—", right: true },
            { head: t("util.unitShare"), cell: (a) => <Money v={a.amount} />, right: true, money: true },
          ]} />
          <div className="acct"><div><span>{t("total")}</span><b className="num"><Money v={shown.total} /></b></div><div><span>{t("util.allocated")}</span><b className="num"><Money v={shown.allocations.reduce((s, a) => s + a.amount, 0)} /></b></div><div><span>{t("util.ownerShare")}</span><b className="num"><Money v={shown.ownerShare} /></b></div></div>
        </div>
      </Modal>}
    </div>
  );
}
