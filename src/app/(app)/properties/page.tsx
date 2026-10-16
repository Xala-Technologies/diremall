"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, DateText, BuildingSelect, Card, Empty, Field, Message, Modal, MoneyInput, PageHeader, SearchInput, Skeleton, StatusBadge, Table, Money, ViewToggle , SelectField } from "@/components/ui";
import { FilterSelect } from "@/components/FilterSelect";
import { ArrowUpDown, Briefcase, Circle, CircleCheck, Home, LayoutGrid, Layers, Package, Store, Wrench } from "lucide-react";
import { Icon } from "@/components/icons";
import { HBars, Columns, Ring, SERIES, compact } from "@/components/charts";
import { Kpi } from "@/components/ui";
import { pct } from "@/lib/format";
import Link from "next/link";
import { DeleteButton } from "@/components/DeleteButton";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { FILE_ACCEPT, failures, fileProblem, nonNegative, phone, req } from "@/lib/validate";
import { useOpenFile } from "@/lib/useOpenFile";
import { useUpload } from "@/lib/useUpload";

export default function Properties() {
  const { t } = useI18n();
  const { can } = useMe();
  const [building, setBuilding] = useState("");
  const [modal, setModal] = useState<null | "building" | "manage" | "unit">(null); const [editUnit, setEditUnit] = useState<UnitRow | null>(null);
  const [view, setViewState] = useState<"grid" | "table">("grid"); const router = useRouter();
  useEffect(() => { try { if (localStorage.getItem("unitView") === "table") setViewState("table"); } catch {} }, []);
  const setView = (v: "grid" | "table") => { setViewState(v); try { localStorage.setItem("unitView", v); } catch {} };
  const buildings = useQuery(api.properties.listBuildings, {});
  const units = useQuery(api.properties.listUnits, { buildingId: (building || undefined) as Id<"buildings"> | undefined });
  const floors = useQuery(api.properties.listFloors, building ? { buildingId: building as Id<"buildings"> } : "skip");
  const setAvail = useMutation(api.properties.setUnitAvailability);
  const { run, error } = useRun();
  const bName = (id: string) => buildings?.find((b) => b._id === id)?.name ?? "";

  // filters: status tabs, category, floor (once a building is chosen), search and sort. All applied to the loaded units.
  const [status, setStatus] = useState(""); const [category, setCategory] = useState(""); const [floor, setFloor] = useState(""); const [q, setQ] = useState(""); const [sort, setSort] = useState("unit");
  const changeBuilding = (b: string) => { setBuilding(b); setFloor(""); };
  const needle = q.trim().toLowerCase();
  const matches = (u: NonNullable<typeof units>[number], ignoreStatus = false) =>
    (ignoreStatus || !status || u.status === status) && (!category || u.category === category) && (!floor || u.floorId === floor) &&
    (!needle || `${u.number} ${u.renterName ?? ""}`.toLowerCase().includes(needle));
  const shown = units?.filter((u) => matches(u)).sort((a, b) => sort === "area" ? b.areaM2 - a.areaM2 : sort === "rate" ? b.ratePerM2 - a.ratePerM2 : a.number.localeCompare(b.number, undefined, { numeric: true }));
  const count = (s: string) => (units ?? []).filter((u) => matches(u, true) && (s === "" || u.status === s)).length;
  const filtered = !!(status || category || floor || q);
  const clear = () => { setStatus(""); setCategory(""); setFloor(""); setQ(""); };
  const catIcon = { "": <LayoutGrid size={16} />, office: <Briefcase size={16} />, retail: <Store size={16} />, storage: <Package size={16} />, residential: <Home size={16} /> } as const;

  return (
    <div className="stack">
      <PageHeader title={t("nav.properties")}
        filters={<>
          <SearchInput value={q} onChange={setQ} placeholder={t("filter.searchUnits")} />
          <BuildingSelect buildings={buildings} value={building} onChange={changeBuilding} />
          <FilterSelect label={t("status")} placeholder={t("status")} value={status} onChange={setStatus} options={[
            { value: "", label: t("filter.anyStatus"), icon: <LayoutGrid size={16} /> },
            { value: "occupied", label: `${t("occupied")} (${count("occupied")})`, icon: <CircleCheck size={16} /> },
            { value: "vacant", label: `${t("vacant")} (${count("vacant")})`, icon: <Circle size={16} /> },
            { value: "maintenance", label: `${t("maintenance")} (${count("maintenance")})`, icon: <Wrench size={16} /> }]} />
          <FilterSelect label={t("prop.category")} placeholder={t("prop.category")} value={category} onChange={setCategory} options={(["", "office", "retail", "storage", "residential"] as const).map((c) => ({ value: c, label: c === "" ? t("filter.allCategories") : t(c), icon: catIcon[c] }))} />
          {building && floors && floors.length > 0 && <FilterSelect label={t("prop.floor")} placeholder={t("prop.floor")} value={floor} onChange={setFloor} options={[{ value: "", label: t("filter.allFloors"), icon: <Layers size={16} /> }, ...floors.map((f) => ({ value: f._id as string, label: f.label, icon: <Layers size={16} /> }))]} />}
          <FilterSelect label={t("filter.sort")} value={sort} onChange={setSort} options={[{ value: "unit", label: t("sort.unit"), icon: <ArrowUpDown size={16} /> }, { value: "area", label: t("sort.area"), icon: <ArrowUpDown size={16} /> }, { value: "rate", label: t("sort.rate"), icon: <ArrowUpDown size={16} /> }]} />
          {filtered && <><span className="muted result-count" aria-live="polite">{t("filter.showing").replace("{a}", String(shown?.length ?? 0)).replace("{b}", String(units?.length ?? 0))}</span><button className="btn ghost sm" onClick={clear}><Icon name="close" size={14} />{t("filter.clear")}</button></>}
          <ViewToggle value={view} onChange={setView} labels={[t("view.cards"), t("view.table")]} />
        </>}
        actions={can("propertyManager") ? <>
          {(buildings?.length ?? 0) > 0 && <button className="btn primary" onClick={() => setModal("unit")}>{t("prop.addUnit")}</button>}
        </> : undefined} />
      <UnitInsights units={units} buildings={buildings} building={building} />
      <Message error={error} />
      {view === "grid" ? (
        !units ? <Card><Skeleton lines={4} /></Card> : (shown ?? []).length === 0 ? <Card><Empty title={units.length === 0 ? t("none") : t("filter.noMatch")} hint={units.length === 0 ? t("first.1") : undefined} action={filtered ? <button className="btn" onClick={clear}>{t("filter.clear")}</button> : units.length === 0 && (buildings?.length ?? 0) === 0 && can("propertyManager") ? <Link className="btn primary" href="/settings?tab=buildings">{t("set.noBuildings")}: {t("prop.addBuilding")}</Link> : undefined} /></Card> : (
          <div className="tiles">
            {(shown ?? []).map((u) => {
              const agreementId = "agreementId" in u ? u.agreementId : undefined;
              return (
                <div key={u._id} className={`tile ${u.status} ${agreementId ? "clickable" : ""}`}
                  role={agreementId ? "link" : undefined} tabIndex={agreementId ? 0 : undefined}
                  onClick={() => agreementId && router.push(`/agreements/${agreementId}`)}
                  onKeyDown={(e) => { if (e.key === "Enter" && agreementId) router.push(`/agreements/${agreementId}`); }}>
                  <div className="tile-h"><span className="tile-t">{u.number}</span><StatusBadge status={u.status} /></div>
                  <div className="tile-r">{u.renterName || <span className="muted">—</span>}</div>
                  {"reservedFrom" in u && u.reservedFrom && <div className="tile-m"><Badge tone="info">{t("ag.reservedFrom")} <DateText ms={u.reservedFrom} /></Badge></div>}
                  <div className="tile-m"><span>{t(u.category)}</span><span>·</span><span className="num">{u.areaM2} m²</span><span>·</span><span className="num">{(u.ratePerM2 / 100).toLocaleString()} /m²</span></div>
                  {can("propertyManager") && (
                    <div className="row" onClick={(e) => e.stopPropagation()}>
                      {u.status === "vacant" && !("reservedFrom" in u && u.reservedFrom) && <button className="btn sm primary" onClick={() => router.push(`/agreements?new=${u._id}`)}>{t("ag.new")}</button>}
                      {u.status !== "occupied" && <button className="btn sm" onClick={() => void run(() => setAvail({ unitId: u._id, status: u.status === "vacant" ? "maintenance" : "vacant" }))}>{u.status === "vacant" ? t("maintenance") : t("vacant")}</button>}
                      <button className="btn sm" onClick={() => setEditUnit(u as UnitRow)}>{t("prop.editUnit")}</button>
                    </div>)}
                </div>
              );
            })}
          </div>
        )
      ) : (
      <Card flush>
        <Table rows={shown} empty={t("filter.noMatch")} cols={[
          { head: t("building"), cell: (u) => bName(u.buildingId) },
          { head: t("prop.unitNumber"), cell: (u) => <strong>{u.number}</strong>, sort: (u) => u.number },
          { head: t("prop.category"), cell: (u) => t(u.category) },
          { head: t("prop.area"), cell: (u) => u.areaM2, right: true, sort: (u) => u.areaM2 },
          { head: t("prop.rate").replace(" (ETB)", ""), cell: (u) => <Money v={u.ratePerM2} />, right: true, money: true },
          { head: t("status"), cell: (u) => <StatusBadge status={u.status} />, sort: (u) => u.status },
          { head: "", cell: (u) => can("propertyManager") ? (
            <div className="row">
              {u.status !== "occupied" && <button className="btn sm" onClick={() => void run(() => setAvail({ unitId: u._id, status: u.status === "vacant" ? "maintenance" : "vacant" }))}>{u.status === "vacant" ? t("maintenance") : t("vacant")}</button>}
              <button className="btn sm" onClick={() => setEditUnit(u as UnitRow)}>{t("prop.editUnit")}</button>
            </div>) : null },
        ]} />
      </Card>
      )}
      {modal === "unit" && <UnitForm buildingId={(building || (buildings?.length === 1 ? buildings[0]!._id : "")) as Id<"buildings"> | ""} onClose={() => setModal(null)} />}
      {editUnit && <UnitForm buildingId={editUnit.buildingId} unit={editUnit} onClose={() => setEditUnit(null)} />}
    </div>
  );
}

type UnitRow = { _id: Id<"units">; buildingId: Id<"buildings">; floorId: Id<"floors">; number: string; areaM2: number; category: "office" | "retail" | "storage" | "residential"; ratePerM2: number; status: "vacant" | "occupied" | "maintenance"; notes?: string };

/** Add a unit, or edit one. A leased unit's area and rate are locked: those change through an agreement term. */
function UnitForm({ buildingId: presetBuilding, unit, onClose }: { buildingId: Id<"buildings"> | ""; unit?: UnitRow; onClose: () => void }) {
  // from the unit board with no building chosen, the form asks which building the unit belongs to
  const [pickedBuilding, setPickedBuilding] = useState<string>(presetBuilding); const buildings = useQuery(api.properties.listBuildings, {});
  const buildingId = pickedBuilding as Id<"buildings">;
  const { t } = useI18n(); const create = useMutation(api.properties.createUnit); const update = useMutation(api.properties.updateUnit); const removeUnit = useMutation(api.removals.deleteUnit); const { run, error, busy } = useRun();
  const floors = useQuery(api.properties.listFloors, buildingId ? { buildingId } : "skip");
  const [floorId, setFloorId] = useState<string>(unit?.floorId ?? ""); const [number, setNumber] = useState(unit?.number ?? ""); const [area, setArea] = useState(unit ? String(unit.areaM2) : "");
  const [category, setCategory] = useState<UnitRow["category"]>(unit?.category ?? "retail"); const [rate, setRate] = useState<number | null>(unit ? unit.ratePerM2 : null);
  const [status, setStatus] = useState<"vacant" | "maintenance">("vacant"); const [notes, setNotes] = useState(unit?.notes ?? "");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clear = (k: string) => errs[k] && setErrs({ ...errs, [k]: "" });
  const locked = unit?.status === "occupied";
  const chosenFloor = floorId || floors?.[0]?._id || "";
  return (
    <Modal title={unit ? `${t("prop.editUnit")}: ${unit.number}` : t("prop.addUnit")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ building: buildingId ? null : t("v.pick"), floor: chosenFloor ? null : t("v.pick"), number: req(number, t), area: Number(area) > 0 ? null : t("v.positive"), rate: nonNegative(rate, t) });
        setErrs(found); if (Object.keys(found).length) return;
        const ok = unit
          ? await run(() => update({ unitId: unit._id, number: number.trim(), floorId: chosenFloor as Id<"floors">, notes, category, ...(locked ? {} : { areaM2: Number(area), ratePerM2: rate! }) }), t("saved"))
          : await run(() => create({ buildingId, floorId: chosenFloor as Id<"floors">, number: number.trim(), areaM2: Number(area), category, ratePerM2: rate!, notes, status }), t("saved"));
        if (ok !== undefined) onClose();
      }}>
        {!unit && !presetBuilding && <SelectField label={t("building")} error={errs.building} value={pickedBuilding} onChange={(v) => { setPickedBuilding(v); setFloorId(""); clear("building"); }} options={(buildings ?? []).map((b) => ({ value: b._id, label: b.name }))} />}
        <SelectField label={t("prop.floor")} error={errs.floor} value={chosenFloor} onChange={(v) => { setFloorId(v); clear("floor"); }} options={(floors ?? []).map((f) => ({ value: f._id, label: f.label }))} />
        <Field label={t("prop.unitNumber")} error={errs.number}><input autoFocus value={number} onChange={(e) => { setNumber(e.target.value); clear("number"); }} /></Field>
        <Field label={t("prop.area")} error={errs.area}><input inputMode="decimal" value={area} disabled={locked} onChange={(e) => { setArea(e.target.value); clear("area"); }} /></Field>
        <SelectField label={t("prop.category")} value={category} onChange={(v) => setCategory(v as UnitRow["category"])} options={(["office", "retail", "storage", "residential"] as const).map((c) => ({ value: c, label: t(c) }))} />
        <Field label={t("prop.rate")} error={errs.rate}><MoneyInput value={rate} onChange={(v) => { if (!locked) { setRate(v); clear("rate"); } }} /></Field>
        {!unit && <SelectField label={t("prop.unitStatus")} value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: "vacant", label: t("vacant") }, { value: "maintenance", label: t("maintenance") }]} />}
        {locked && <p className="muted wide">{t("prop.rateLocked")}</p>}
        <div className="wide"><Field label={t("prop.unitNotes")} hint={t("optional")}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        <div className="wide row"><Message error={error} /><button className="btn primary" disabled={busy}>{unit ? t("save") : t("create")}</button>{unit && <DeleteButton small={false} title={t("prop.deleteUnitTitle").replace("{n}", unit.number)} message={t("prop.deleteUnitBody")} disabledReason={locked ? t("prop.cannotDeleteUnit") : undefined} onDelete={() => removeUnit({ unitId: unit._id })} onDone={onClose} />}</div>
      </form>
    </Modal>
  );
}

type InsightUnit = { buildingId: string; status: string; category: string; areaM2: number; ratePerM2: number };
const potential = (u: InsightUnit) => Math.round(u.areaM2 * u.ratePerM2);

/** The numbers behind the board: how full it is, what it could earn, and where the vacant space is. */
function UnitInsights({ units, buildings, building }: { units?: InsightUnit[]; buildings?: { _id: string; name: string }[]; building: string }) {
  const { t } = useI18n();
  if (!units) return <div className="kpis kpis-4">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><Skeleton lines={3} /></div>)}</div>;
  if (units.length === 0) return null;
  const occ = units.filter((u) => u.status === "occupied"), vac = units.filter((u) => u.status === "vacant"), other = units.length - occ.length - vac.length;
  const area = (l: InsightUnit[]) => l.reduce((a, u) => a + u.areaM2, 0);
  const rent = (l: InsightUnit[]) => l.reduce((a, u) => a + potential(u), 0);
  const cats = [...new Set(units.map((u) => u.category))];
  const byBuilding = !building && (buildings?.length ?? 0) > 1;
  const groups = byBuilding ? (buildings ?? []).map((b) => ({ label: b.name, list: units.filter((u) => u.buildingId === b._id) })) : cats.map((c) => ({ label: t(c), list: units.filter((u) => u.category === c) }));
  return <>
    <div className="kpis kpis-4">
      <Kpi tone="good" icon="buildings" label={t("dash.occupancy")} value={pct(occ.length / units.length)} sub={`${occ.length} / ${units.length} ${t("rep.k.units")}`} />
      <Kpi tone="info" icon="payments" label={t("prop.k.fullRent")} unit="ETB" value={Math.round(rent(units) / 100).toLocaleString()} sub={t("prop.k.fullRentNote")} />
      <Kpi tone={vac.length ? "warn" : "good"} icon="buildings" label={t("rep.k.vacantUnits")} value={vac.length} sub={`${compact(rent(vac))} ETB ${t("prop.k.perMonth")}`} />
      <Kpi icon="reports" label={t("prop.k.totalArea")} value={`${Math.round(area(units)).toLocaleString()} m²`} sub={`${Math.round(area(vac)).toLocaleString()} m² ${t("rep.k.notLet")}`} />
    </div>
    <div className="cols-2">
      <Card title={t("rep.c.occupancy")}><Ring caption={t("dash.occupancy")} center={pct(occ.length / units.length)} parts={[{ label: t("occupied"), value: occ.length, color: SERIES[0] }, { label: t("vacant"), value: vac.length, color: SERIES[4] }, ...(other > 0 ? [{ label: t("maintenance"), value: other, color: SERIES[2] }] : [])]} /></Card>
      <Card title={byBuilding ? t("prop.c.byBuilding") : t("prop.c.byCategory")}>
        <ul className="hbars">{groups.filter((g) => g.list.length).map((g) => { const o = g.list.filter((u) => u.status === "occupied").length; return <li key={g.label}><span className="hb-l">{g.label}<small>{g.list.length} {t("rep.k.units")}</small></span><span className="hb-t"><span className="hb-f" style={{ width: `${(o / g.list.length) * 100}%`, background: SERIES[0] }} /></span><span className="hb-v num">{pct(o / g.list.length)}</span></li>; })}</ul>
      </Card>
    </div>
  </>;
}
