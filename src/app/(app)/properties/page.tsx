"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BuildingSelect, Card, Field, Message, Modal, MoneyInput, PageHeader, StatusBadge, Table, Money } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function Properties() {
  const { t } = useI18n();
  const { can } = useMe();
  const [building, setBuilding] = useState("");
  const [modal, setModal] = useState<null | "building" | "floor" | "unit">(null);
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
        {can("propertyManager") && <>
          <button className="btn" onClick={() => setModal("building")}>{t("prop.addBuilding")}</button>
          {building && <button className="btn" onClick={() => setModal("floor")}>{t("prop.addFloor")}</button>}
          {building && <button className="btn primary" onClick={() => setModal("unit")}>{t("prop.addUnit")}</button>}
        </>}
      </PageHeader>
      <Message error={error} />
      <Card>
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
      {modal === "building" && <BuildingForm onClose={() => setModal(null)} />}
      {modal === "floor" && building && <FloorForm buildingId={building as Id<"buildings">} onClose={() => setModal(null)} />}
      {modal === "unit" && building && floors && <UnitForm buildingId={building as Id<"buildings">} floors={floors} onClose={() => setModal(null)} />}
    </div>
  );
}

function BuildingForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.properties.createBuilding); const { run, error, busy } = useRun();
  const [name, setName] = useState(""); const [address, setAddress] = useState("");
  return (
    <Modal title={t("prop.addBuilding")} onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => create({ name, address: address || undefined }))) onClose(); }}>
        <Field label={t("name")}><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("prop.address")}><input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

function FloorForm({ buildingId, onClose }: { buildingId: Id<"buildings">; onClose: () => void }) {
  const { t } = useI18n(); const add = useMutation(api.properties.addFloor); const { run, error, busy } = useRun(); const [label, setLabel] = useState("");
  return (
    <Modal title={t("prop.addFloor")} onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => add({ buildingId, label }))) onClose(); }}>
        <Field label={t("prop.floor")}><input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ground, 1st, 2nd…" /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

function UnitForm({ buildingId, floors, onClose }: { buildingId: Id<"buildings">; floors: { _id: Id<"floors">; label: string }[]; onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.properties.createUnit); const { run, error, busy } = useRun();
  const [floorId, setFloorId] = useState(floors[0]?._id ?? ""); const [number, setNumber] = useState(""); const [area, setArea] = useState("");
  const [category, setCategory] = useState<"office" | "retail" | "storage" | "residential">("retail"); const [rate, setRate] = useState<number | null>(null);
  return (
    <Modal title={t("prop.addUnit")} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); if (rate == null) return;
        if (await run(() => create({ buildingId, floorId: floorId as Id<"floors">, number, areaM2: Number(area), category, ratePerM2: rate }))) onClose();
      }}>
        <Field label={t("prop.floor")}><select required value={floorId} onChange={(e) => setFloorId(e.target.value as Id<"floors">)}>{floors.map((f) => <option key={f._id} value={f._id}>{f.label}</option>)}</select></Field>
        <Field label={t("prop.unitNumber")}><input required value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label={t("prop.area")}><input required inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></Field>
        <Field label={t("prop.category")}><select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>{(["office", "retail", "storage", "residential"] as const).map((c) => <option key={c} value={c}>{t(c)}</option>)}</select></Field>
        <Field label={t("prop.rate")}><MoneyInput value={rate} onChange={setRate} /></Field>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy || rate == null || !(Number(area) > 0)}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}
