"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BuildingForm, BuildingManage, type BuildingDoc } from "@/components/BuildingForms";
import { DeleteButton } from "@/components/DeleteButton";
import { Badge, Card, ConfirmDialog, Empty, Message, Skeleton } from "@/components/ui";
import { pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

/** The register of buildings. Only buildings added here (and not archived) appear anywhere else in the app. */
export function Buildings() {
  const { t } = useI18n(); const { can } = useMe(); const list = useQuery(api.properties.buildingOverview);
  const archive = useMutation(api.properties.setBuildingArchived); const remove = useMutation(api.removals.deleteBuilding); const { run, error } = useRun();
  const [adding, setAdding] = useState(false); const [managing, setManaging] = useState<Id<"buildings"> | null>(null); const [archiving, setArchiving] = useState<Id<"buildings"> | null>(null);
  const edit = can("propertyManager");
  if (!list) return <Card><Skeleton lines={5} /></Card>;
  const live = list.filter((b) => !b.archivedAt), old = list.filter((b) => b.archivedAt);
  const managed = list.find((b) => b._id === managing), toArchive = list.find((b) => b._id === archiving);
  const row = (b: (typeof list)[number]) => (
    <li key={b._id} className={`bld${b.archivedAt ? " is-archived" : ""}`}>
      <div className="bld-main">
        <div className="bld-title"><b>{b.name}</b>{b.archivedAt ? <Badge tone="muted">{t("set.archived")}</Badge> : <Badge tone="good">{t("set.inService")}</Badge>}</div>
        <span className="muted">{[b.address, b.subCity, b.city].filter(Boolean).join(", ") || t("set.noAddress")}</span>
        {b.contactName && <span className="muted">{t("prop.contactName")}: {b.contactName}{b.contactPhone ? ` · ${b.contactPhone}` : ""}</span>}
      </div>
      <dl className="bld-stats">
        <div><dt>{t("set.floors")}</dt><dd className="num">{b.floors}</dd></div>
        <div><dt>{t("set.units")}</dt><dd className="num">{b.units}</dd></div>
        <div><dt>{t("dash.occupancy")}</dt><dd className="num">{b.units ? pct(b.occupied / b.units) : "—"}</dd></div>
        <div><dt>{t("set.area")}</dt><dd className="num">{Math.round(b.areaM2).toLocaleString()}</dd></div>
      </dl>
      {edit && <div className="bld-actions">
        {!b.archivedAt && <button className="btn sm" onClick={() => setManaging(b._id)}>{t("prop.manage")}</button>}
        {b.archivedAt ? <button className="btn sm" onClick={() => void run(() => archive({ buildingId: b._id, archived: false }), t("saved"))}>{t("set.restore")}</button>
          : <button className="btn sm" disabled={b.liveAgreements > 0} title={b.liveAgreements > 0 ? t("set.cannotArchive").replace("{n}", String(b.liveAgreements)) : undefined} onClick={() => setArchiving(b._id)}>{t("set.archive")}</button>}
        <DeleteButton title={t("set.deleteTitle").replace("{name}", b.name)} message={t("set.deleteBody").replace("{u}", String(b.units)).replace("{f}", String(b.floors))} disabledReason={b.deletable ? undefined : t("set.cannotDelete")} onDelete={() => remove({ buildingId: b._id })} />
      </div>}
    </li>
  );
  return (
    <div className="stack">
      <p className="muted">{t("set.buildingsHint")}</p>
      <Message error={error} />
      <Card title={`${t("set.buildingsTitle")} (${live.length})`} actions={edit ? <button className="btn primary" onClick={() => setAdding(true)}>{t("prop.addBuilding")}</button> : undefined}>
        {live.length === 0 ? <Empty title={t("set.noBuildings")} hint={t("set.noBuildingsHint")} action={edit ? <button className="btn primary" onClick={() => setAdding(true)}>{t("prop.addBuilding")}</button> : undefined} /> : <ul className="bld-list">{live.map(row)}</ul>}
      </Card>
      {old.length > 0 && <Card title={`${t("set.archivedTitle")} (${old.length})`}><p className="muted">{t("set.archivedHint")}</p><ul className="bld-list">{old.map(row)}</ul></Card>}
      {adding && <BuildingForm onClose={() => setAdding(false)} onCreated={(id) => setManaging(id)} />}
      {managed && <BuildingManage building={managed as unknown as BuildingDoc} onClose={() => setManaging(null)} />}
      {toArchive && <ConfirmDialog danger title={t("set.archiveTitle").replace("{name}", toArchive.name)} message={t("set.archiveBody")} confirmLabel={t("set.archive")} onClose={() => setArchiving(null)} onConfirm={async () => { await run(() => archive({ buildingId: toArchive._id, archived: true }), t("saved")); setArchiving(null); }} />}
    </div>
  );
}
