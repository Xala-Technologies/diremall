"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, DateText, BuildingSelect, Card, Empty, Field, Message, Modal, MoneyInput, PageHeader, Skeleton, StatusBadge, Table, Money, ViewToggle } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { failures, nonNegative, req } from "@/lib/validate";

export default function Properties() {
  const { t } = useI18n();
  const { can } = useMe();
  const [building, setBuilding] = useState("");
  const [modal, setModal] = useState<null | "building" | "floor" | "unit">(null);
  const [view, setViewState] = useState<"grid" | "table">("grid"); const router = useRouter();
  useEffect(() => { try { if (localStorage.getItem("unitView") === "table") setViewState("table"); } catch {} }, []);
  const setView = (v: "grid" | "table") => { setViewState(v); try { localStorage.setItem("unitView", v); } catch {} };
  const buildings = useQuery(api.properties.listBuildings);
  const units = useQuery(api.properties.listUnits, { buildingId: (building || undefined) as Id<"buildings"> | undefined });
  const floors = useQuery(api.properties.listFloors, building ? { buildingId: building as Id<"buildings"> } : "skip");
  const setAvail = useMutation(api.properties.setUnitAvailability);
  const { run, error } = useRun();
  const bName = (id: string) => buildings?.find((b) => b._id === id)?.name ?? "";

  return (
    <div className="stack">
      <PageHeader title={t("nav.properties")}>
        <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
        <ViewToggle value={view} onChange={setView} labels={[t("view.cards"), t("view.table")]} />
        {can("propertyManager") && <>
          <button className="btn" onClick={() => setModal("building")}>{t("prop.addBuilding")}</button>
          {building && <button className="btn" onClick={() => setModal("floor")}>{t("prop.addFloor")}</button>}
          {building && <button className="btn primary" onClick={() => setModal("unit")}>{t("prop.addUnit")}</button>}
        </>}
      </PageHeader>
      <Message error={error} />
      {view === "grid" ? (
        !units ? <Card><Skeleton lines={4} /></Card> : units.length === 0 ? <Card><Empty title={t("none")} hint={t("first.1")} /></Card> : (
          <div className="tiles">
            {units.map((u) => {
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
                  {can("propertyManager") && u.status !== "occupied" && (
                    <div className="row" onClick={(e) => e.stopPropagation()}>
                      <button className="btn sm" onClick={() => void run(() => setAvail({ unitId: u._id, status: u.status === "vacant" ? "maintenance" : "vacant" }))}>{u.status === "vacant" ? t("maintenance") : t("vacant")}</button>
                    </div>)}
                </div>
              );
            })}
          </div>
        )
      ) : (
      <Card flush>
        <Table rows={units} cols={[
          { head: t("building"), cell: (u) => bName(u.buildingId) },
          { head: t("prop.unitNumber"), cell: (u) => <strong>{u.number}</strong> },
          { head: t("prop.category"), cell: (u) => t(u.category) },
          { head: t("prop.area"), cell: (u) => u.areaM2, right: true },
          { head: t("prop.rate"), cell: (u) => <Money v={u.ratePerM2} />, right: true, money: true },
          { head: t("status"), cell: (u) => <StatusBadge status={u.status} /> },
          { head: "", cell: (u) => can("propertyManager") && u.status !== "occupied" ? (
            <button className="btn sm" onClick={() => void run(() => setAvail({ unitId: u._id, status: u.status === "vacant" ? "maintenance" : "vacant" }))}>
              {u.status === "vacant" ? t("maintenance") : t("vacant")}</button>) : null },
        ]} />
      </Card>
      )}
      {modal === "building" && <BuildingForm onClose={() => setModal(null)} />}
      {modal === "floor" && building && <FloorForm buildingId={building as Id<"buildings">} onClose={() => setModal(null)} />}
      {modal === "unit" && building && floors && <UnitForm buildingId={building as Id<"buildings">} floors={floors} onClose={() => setModal(null)} />}
    </div>
  );
}

function BuildingForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.properties.createBuilding); const { run, error, busy } = useRun();
  const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [errs, setErrs] = useState<Record<string, string>>({});
  return (
    <Modal title={t("prop.addBuilding")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ name: req(name, t) }); setErrs(found); if (Object.keys(found).length) return;
        if (await run(() => create({ name: name.trim(), address: address.trim() || undefined }), t("saved"))) onClose();
      }}>
        <Field label={t("name")} error={errs.name}><input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErrs({}); }} /></Field>
        <Field label={t("prop.address")} hint={t("optional")}><input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

function FloorForm({ buildingId, onClose }: { buildingId: Id<"buildings">; onClose: () => void }) {
  const { t } = useI18n(); const add = useMutation(api.properties.addFloor); const { run, error, busy } = useRun();
  const [label, setLabel] = useState(""); const [errs, setErrs] = useState<Record<string, string>>({});
  return (
    <Modal title={t("prop.addFloor")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ label: req(label, t) }); setErrs(found); if (Object.keys(found).length) return;
        if (await run(() => add({ buildingId, label: label.trim() }), t("saved"))) onClose();
      }}>
        <Field label={t("prop.floor")} error={errs.label}><input autoFocus value={label} onChange={(e) => { setLabel(e.target.value); setErrs({}); }} placeholder="Ground, 1st, 2nd…" /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

function UnitForm({ buildingId, floors, onClose }: { buildingId: Id<"buildings">; floors: { _id: Id<"floors">; label: string }[]; onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.properties.createUnit); const { run, error, busy } = useRun();
  const [floorId, setFloorId] = useState(floors[0]?._id ?? ""); const [number, setNumber] = useState(""); const [area, setArea] = useState("");
  const [category, setCategory] = useState<"office" | "retail" | "storage" | "residential">("retail"); const [rate, setRate] = useState<number | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clear = (k: string) => errs[k] && setErrs({ ...errs, [k]: "" });
  return (
    <Modal title={t("prop.addUnit")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ floor: floorId ? null : t("v.pick"), number: req(number, t), area: Number(area) > 0 ? null : t("v.positive"), rate: nonNegative(rate, t) });
        setErrs(found); if (Object.keys(found).length) return;
        if (await run(() => create({ buildingId, floorId: floorId as Id<"floors">, number: number.trim(), areaM2: Number(area), category, ratePerM2: rate! }), t("saved"))) onClose();
      }}>
        <Field label={t("prop.floor")} error={errs.floor}><select value={floorId} onChange={(e) => { setFloorId(e.target.value as Id<"floors">); clear("floor"); }}>{floors.length === 0 && <option value="">—</option>}{floors.map((f) => <option key={f._id} value={f._id}>{f.label}</option>)}</select></Field>
        <Field label={t("prop.unitNumber")} error={errs.number}><input autoFocus value={number} onChange={(e) => { setNumber(e.target.value); clear("number"); }} /></Field>
        <Field label={t("prop.area")} error={errs.area}><input inputMode="decimal" value={area} onChange={(e) => { setArea(e.target.value); clear("area"); }} /></Field>
        <Field label={t("prop.category")}><select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>{(["office", "retail", "storage", "residential"] as const).map((c) => <option key={c} value={c}>{t(c)}</option>)}</select></Field>
        <Field label={t("prop.rate")} error={errs.rate}><MoneyInput value={rate} onChange={(v) => { setRate(v); clear("rate"); }} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}
