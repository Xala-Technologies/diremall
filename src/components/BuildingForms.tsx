"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DeleteButton } from "@/components/DeleteButton";
import { Field, Message, Modal, Skeleton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";
import { FILE_ACCEPT, failures, fileProblem, phone, req } from "@/lib/validate";
import { useOpenFile } from "@/lib/useOpenFile";
import { useUpload } from "@/lib/useUpload";

export type BuildingDoc = { _id: Id<"buildings">; name: string; address?: string; city?: string; subCity?: string; contactName?: string; contactPhone?: string; notes?: string };
const draftOf = (b?: BuildingDoc) => ({ name: b?.name ?? "", address: b?.address ?? "", city: b?.city ?? "Dire Dawa", subCity: b?.subCity ?? "", contactName: b?.contactName ?? "", contactPhone: b?.contactPhone ?? "", notes: b?.notes ?? "" });
type Draft = ReturnType<typeof draftOf>;

function BuildingFields({ f, set, errs }: { f: Draft; set: (k: keyof Draft) => (e: { target: { value: string } }) => void; errs: Record<string, string> }) {
  const { t } = useI18n();
  return (<>
    <Field label={t("name")} error={errs.name}><input autoFocus value={f.name} onChange={set("name")} /></Field>
    <Field label={t("prop.city")} hint={t("optional")}><input value={f.city} onChange={set("city")} /></Field>
    <Field label={t("prop.subCity")} hint={t("optional")}><input value={f.subCity} onChange={set("subCity")} /></Field>
    <Field label={t("prop.address")} hint={t("optional")}><input value={f.address} onChange={set("address")} /></Field>
    <Field label={t("prop.contactName")} hint={t("optional")}><input value={f.contactName} onChange={set("contactName")} /></Field>
    <Field label={t("prop.contactPhone")} error={errs.contactPhone} hint={t("optional")}><input type="tel" value={f.contactPhone} onChange={set("contactPhone")} placeholder="0911 20 01 01" /></Field>
    <div className="wide"><Field label={t("prop.notes")} hint={t("optional")}><textarea rows={2} value={f.notes} onChange={set("notes")} /></Field></div>
  </>);
}
const checkBuilding = (f: Draft, t: (k: string) => string) => failures({ name: req(f.name, t), contactPhone: f.contactPhone.trim() ? phone(f.contactPhone, t) : null });
const buildingArgs = (f: Draft) => ({ name: f.name.trim(), address: f.address, city: f.city, subCity: f.subCity, contactName: f.contactName, contactPhone: f.contactPhone, notes: f.notes });

export function BuildingForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: Id<"buildings">) => void }) {
  const { t } = useI18n(); const create = useMutation(api.properties.createBuilding); const { run, error, busy } = useRun();
  const [f, setF] = useState(draftOf()); const [floors, setFloors] = useState("Ground"); const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: "" }); };
  return (
    <Modal title={t("prop.addBuilding")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = checkBuilding(f, t); setErrs(found); if (Object.keys(found).length) return;
        const id = await run(() => create({ ...buildingArgs(f), floors: floors.split(",").map((x) => x.trim()).filter(Boolean) }), t("saved"));
        if (id) { onCreated(id); onClose(); }
      }}>
        <BuildingFields f={f} set={set} errs={errs} />
        <div className="wide"><Field label={t("prop.floorsList")} hint={t("prop.floorsHint")}><input value={floors} onChange={(e) => setFloors(e.target.value)} placeholder="Ground, 1st, 2nd" /></Field></div>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("create")}</button></div>
      </form>
    </Modal>
  );
}

/** Edit a building's details and look after its floors and floor plans in one place. */
export function BuildingManage({ building, onClose }: { building: BuildingDoc; onClose: () => void }) {
  const { t } = useI18n(); const update = useMutation(api.properties.updateBuilding); const addFloor = useMutation(api.properties.addFloor); const updateFloor = useMutation(api.properties.updateFloor); const removeFloor = useMutation(api.removals.deleteFloor);
  const floors = useQuery(api.properties.listFloors, { buildingId: building._id }); const upload = useUpload(); const openFile = useOpenFile();
  const { run, error, busy } = useRun(); const floorRun = useRun();
  const [f, setF] = useState(draftOf(building)); const [errs, setErrs] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState(""); const [newPlan, setNewPlan] = useState<File | null>(null); const [fileErr, setFileErr] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: "" }); };
  const pick = (file: File | undefined, then: (f: File) => void) => { const p = fileProblem(file, t); setFileErr(p); if (file && !p) then(file); };
  return (
    <Modal title={`${t("prop.manageTitle")}: ${building.name}`} onClose={onClose}>
      <div className="stack">
        <form className="form" noValidate onSubmit={async (e) => {
          e.preventDefault();
          const found = checkBuilding(f, t); setErrs(found); if (Object.keys(found).length) return;
          await run(() => update({ buildingId: building._id, ...buildingArgs(f) }), t("saved"));
        }}>
          <div className="wide"><h3 className="section-h">{t("prop.details")}</h3></div>
          <BuildingFields f={f} set={set} errs={errs} />
          <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("save")}</button></div>
        </form>
        <section>
          <h3 className="section-h">{t("prop.floorsTitle")}</h3>
          {!floors ? <Skeleton lines={2} /> : (
            <ul className="floor-list">
              {floors.map((fl) => (
                <li key={fl._id}>
                  <input defaultValue={fl.label} aria-label={t("prop.floor")} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== fl.label) void floorRun.run(() => updateFloor({ floorId: fl._id, label: v }), t("saved")); else e.target.value = fl.label; }} />
                  <span className="muted floor-plan">{fl.hasPlan ? t("prop.floorPlan") : t("prop.noPlan")}</span>
                  {fl.hasPlan && <button type="button" className="btn sm" onClick={() => void openFile("plan", fl._id)}>{t("prop.viewPlan")}</button>}
                  <label className="btn sm">{fl.hasPlan ? t("prop.replacePlan") : t("prop.attachPlan")}
                    <input type="file" hidden accept={FILE_ACCEPT} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; pick(file, (x) => void floorRun.run(async () => updateFloor({ floorId: fl._id, planFileId: await upload(x) }), t("saved"))); }} /></label>
                  <DeleteButton title={t("prop.deleteFloorTitle").replace("{name}", fl.label)} message={t("prop.deleteFloorBody")} onDelete={() => removeFloor({ floorId: fl._id })} />
                </li>))}
            </ul>)}
          <form className="floor-add" onSubmit={async (e) => {
            e.preventDefault(); if (!newLabel.trim()) return;
            const ok = await floorRun.run(async () => addFloor({ buildingId: building._id, label: newLabel.trim(), planFileId: newPlan ? await upload(newPlan) : undefined }), t("saved"));
            if (ok) { setNewLabel(""); setNewPlan(null); }
          }}>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t("prop.newFloor")} aria-label={t("prop.newFloor")} />
            <label className="btn sm">{newPlan ? newPlan.name : t("prop.attachPlan")}<input type="file" hidden accept={FILE_ACCEPT} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; pick(file, setNewPlan); }} /></label>
            <button className="btn primary sm" disabled={!newLabel.trim() || floorRun.busy}>{t("prop.addFloor")}</button>
          </form>
          <Message error={fileErr ?? floorRun.error} />
        </section>
      </div>
    </Modal>
  );
}

