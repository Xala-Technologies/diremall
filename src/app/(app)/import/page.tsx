"use client";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Card, ConfirmDialog, ExportMenu, Kpi, Message, PageHeader, Skeleton, Table, Tabs } from "@/components/ui";
import { RENTER_COLUMNS, RENTER_OPTIONAL, RENTER_TEMPLATE, UNIT_COLUMNS, UNIT_TEMPLATE, mapRows, readTable } from "@/lib/importFile";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

type Kind = "units" | "renters";

export default function ImportPage() {
  const { t } = useI18n(); const { can } = useMe();
  const [kind, setKind] = useState<Kind>(can("propertyManager") ? "units" : "renters");
  return (
    <div className="stack">
      <PageHeader title={t("imp.title")} sub={t("imp.sub")} />
      <Tabs value={kind} onChange={(v) => setKind(v as Kind)} tabs={[...(can("propertyManager") ? [["units", t("imp.units")] as [string, string]] : []), ["renters", t("imp.renters")]]} />
      {kind === "units" ? <UnitImport key="u" /> : <RenterImport key="r" />}
    </div>
  );
}

function useFile<K extends string>(spec: Record<K, string[]>, optional: readonly NoInfer<K>[] = []) {
  const { t } = useI18n();
  const [rows, setRows] = useState<({ row: number } & Record<K, string>)[] | null>(null);
  const [missing, setMissing] = useState<K[]>([]);
  const [name, setName] = useState(""); const [readError, setReadError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null); setName(file.name);
    try {
      const { rows: r, missing: m } = mapRows(await readTable(file), spec, optional);
      setMissing(m); setRows(m.length ? null : r);
    } catch { setRows(null); setMissing([]); setReadError(t("imp.readFail")); }
  };
  const reset = () => { setRows(null); setMissing([]); setName(""); if (input.current) input.current.value = ""; };
  return { rows, missing, name, readError, input, pick, reset };
}

function Picker({ f }: { f: ReturnType<typeof useFile<any>> }) {
  const { t } = useI18n();
  return (
    <div className="row">
      <label className="btn"><Icon name="upload" size={16} />{t("imp.choose")}<input ref={f.input} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => void f.pick(e.target.files?.[0])} /></label>
      {f.name && <span className="muted">{f.name}</span>}
      <span className="muted">{t("imp.max")}</span>
    </div>
  );
}

function Problems({ issues, label }: { issues: { row: number; field: string; code: string }[]; label: (f: string) => string }) {
  const { t } = useI18n();
  if (issues.length === 0) return null;
  return (
    <Card flush title={`${t("imp.problems")} (${issues.length})`}>
      <Table rows={issues.slice(0, 200).map((i, n) => ({ ...i, _id: String(n) }))} cols={[
        { head: t("imp.row"), cell: (i) => i.row, right: true }, { head: t("imp.column"), cell: (i) => label(i.field) }, { head: t("imp.problem"), cell: (i) => t(`imp.err.${i.code}`), text: true },
      ]} />
    </Card>
  );
}

function UnitImport() {
  const { t } = useI18n(); const f = useFile(UNIT_COLUMNS); const commit = useMutation(api.imports.commitUnits); const { run, error } = useRun();
  const [confirm, setConfirm] = useState(false);
  const check = useQuery(api.imports.checkUnits, f.rows ? { rows: f.rows } : "skip");
  const label = (k: string) => ({ building: t("building"), floor: t("prop.floor"), unit: t("prop.unitNumber"), area: t("prop.area"), category: t("prop.category"), rate: t("prop.rate") } as Record<string, string>)[k] ?? k;
  return (
    <div className="stack">
      <Card title={t("imp.template")} actions={<ExportMenu name="units-template" rows={UNIT_TEMPLATE} print={false} />}><Picker f={f} /></Card>
      <Message error={error ?? f.readError} />
      {f.missing.length > 0 && <div className="msg bad" role="alert"><Icon name="alert" />{t("imp.missingCols")}: {f.missing.map(label).join(", ")}</div>}
      {f.rows && (!check ? <Card><Skeleton lines={4} /></Card> : (
        <>
          <div className="kpis">
            <Kpi icon="agreements" label={t("imp.rows")} value={check.summary.rows} />
            <Kpi tone="good" icon="check" label={t("imp.valid")} value={check.summary.valid} />
            <Kpi tone={check.issues.length ? "bad" : undefined} icon="alert" label={t("imp.problems")} value={new Set(check.issues.map((i) => i.row)).size} />
            <Kpi icon="buildings" label={t("imp.newBuildings")} value={check.summary.newBuildings} sub={`${t("imp.newFloors")}: ${check.summary.newFloors}`} />
          </div>
          <Problems issues={check.issues} label={label} />
          {check.issues.length > 0 && <p className="muted">{t("imp.fixFirst")}</p>}
          <Card flush title={t("imp.preview")} actions={<button className="btn primary" disabled={check.issues.length > 0} onClick={() => setConfirm(true)}>{t("imp.run")} ({check.summary.rows})</button>}>
            <Table rows={f.rows.slice(0, 50).map((r) => ({ ...r, _id: String(r.row) }))} cols={[
              { head: t("imp.row"), cell: (r) => r.row, right: true }, { head: t("building"), cell: (r) => r.building }, { head: t("prop.floor"), cell: (r) => r.floor }, { head: t("prop.unitNumber"), cell: (r) => <strong>{r.unit}</strong> },
              { head: t("prop.area"), cell: (r) => r.area, right: true }, { head: t("prop.category"), cell: (r) => r.category }, { head: t("prop.rate"), cell: (r) => r.rate, right: true },
            ]} />
          </Card>
          {confirm && <ConfirmDialog title={t("imp.confirm").replace("{n}", String(check.summary.rows))} message={t("imp.confirmBody")} confirmLabel={t("imp.run")} onClose={() => setConfirm(false)}
            onConfirm={async () => { const r = await run(() => commit({ rows: f.rows! }), t("imp.done")); if (r) f.reset(); }} />}
        </>
      ))}
    </div>
  );
}

function RenterImport() {
  const { t } = useI18n(); const f = useFile(RENTER_COLUMNS, RENTER_OPTIONAL); const commit = useMutation(api.imports.commitRenters); const { run, error } = useRun();
  const [confirm, setConfirm] = useState(false);
  const check = useQuery(api.imports.checkRenters, f.rows ? { rows: f.rows } : "skip");
  const label = (k: string) => ({ kind: t("renter.kind"), name: t("name"), tin: t("renter.tin"), license: t("renter.license"), phone: t("renter.phone"), email: t("email"), rep: t("renter.rep"), idNumber: t("renter.idNumber"), address: t("renter.address"), contactPerson: t("renter.contactPerson"), contactPhone: t("renter.contactPhone"), vat: t("renter.vat"), notes: t("renter.notes") } as Record<string, string>)[k] ?? k;
  return (
    <div className="stack">
      <Card title={t("imp.template")} actions={<ExportMenu name="renters-template" rows={RENTER_TEMPLATE} print={false} />}><Picker f={f} /></Card>
      <Message error={error ?? f.readError} />
      {f.missing.length > 0 && <div className="msg bad" role="alert"><Icon name="alert" />{t("imp.missingCols")}: {f.missing.map(label).join(", ")}</div>}
      {f.rows && (!check ? <Card><Skeleton lines={4} /></Card> : (
        <>
          <div className="kpis">
            <Kpi icon="renters" label={t("imp.rows")} value={check.summary.rows} />
            <Kpi tone="good" icon="check" label={t("imp.valid")} value={check.summary.valid} />
            <Kpi tone={check.issues.length ? "bad" : undefined} icon="alert" label={t("imp.problems")} value={new Set(check.issues.map((i) => i.row)).size} />
          </div>
          <Problems issues={check.issues} label={label} />
          {check.issues.length > 0 && <p className="muted">{t("imp.fixFirst")}</p>}
          <Card flush title={t("imp.preview")} actions={<button className="btn primary" disabled={check.issues.length > 0} onClick={() => setConfirm(true)}>{t("imp.run")} ({check.summary.rows})</button>}>
            <Table rows={f.rows.slice(0, 50).map((r) => ({ ...r, _id: String(r.row) }))} cols={[
              { head: t("imp.row"), cell: (r) => r.row, right: true }, { head: t("renter.kind"), cell: (r) => r.kind }, { head: t("name"), cell: (r) => <strong>{r.name}</strong> },
              { head: t("renter.tin"), cell: (r) => r.tin }, { head: t("renter.phone"), cell: (r) => r.phone }, { head: t("email"), cell: (r) => r.email },
            ]} />
          </Card>
          {confirm && <ConfirmDialog title={t("imp.confirm").replace("{n}", String(check.summary.rows))} message={t("imp.confirmBody")} confirmLabel={t("imp.run")} onClose={() => setConfirm(false)}
            onConfirm={async () => { const r = await run(() => commit({ rows: f.rows! }), t("imp.done")); if (r) f.reset(); }} />}
        </>
      ))}
    </div>
  );
}
