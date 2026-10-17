"use client";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { downloadCsv } from "@/lib/csv";
import { Badge, Card, ConfirmDialog, DateField, DateText, ExportMenu, Kpi, Message, Money, PageHeader, Skeleton, Table, Tabs } from "@/components/ui";
import { RENTER_COLUMNS, RENTER_OPTIONAL, RENTER_TEMPLATE, UNIT_COLUMNS, UNIT_TEMPLATE, mapRows, readTable } from "@/lib/importFile";
import { AGREEMENT_COLUMNS, AGREEMENT_OPTIONAL, AGREEMENT_TEMPLATE, OPENING_COLUMNS, OPENING_OPTIONAL, OPENING_TEMPLATE, readAgreementRows, readOpeningRows, type ClientProblem } from "@/lib/migrate";
import { formatEtb, currencyCode } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

type Kind = "units" | "renters" | "agreements" | "opening";

export default function ImportPage() {
  const { t } = useI18n(); const { can } = useMe(); const st = useQuery(api.imports.status);
  const allowed: Kind[] = [...(can("propertyManager") ? ["units" as Kind] : []), "renters", ...(can("propertyManager", "approver") ? ["agreements" as Kind] : []), ...(can("financeOfficer", "approver") ? ["opening" as Kind] : [])];
  const [kind, setKind] = useState<Kind>(allowed[0]!);
  const steps: { k: Kind; done: boolean; line: string }[] = [
    { k: "units", done: !!st && st.units > 0, line: st ? (st.units > 0 ? `${st.units} ${t("rep.k.units")} · ${st.buildings} ${t("building").toLowerCase()}` : t("imp.step.empty")) : "…" },
    { k: "renters", done: !!st && st.renters > 0, line: st ? (st.renters > 0 ? `${st.renters} ${t("nav.renters").toLowerCase()}` : t("imp.step.empty")) : "…" },
    { k: "agreements", done: !!st && st.agreements > 0, line: st ? (st.agreements > 0 ? `${st.agreements} ${t("nav.agreements").toLowerCase()} · ${st.activeAgreements} ${t("active").toLowerCase()}` : t("imp.step.empty")) : "…" },
    { k: "opening", done: !!st && st.openingBills > 0, line: st ? (st.openingBills > 0 ? `${st.openingBills} ${t("imp.step.bills")} · ${currencyCode()} ${formatEtb(st.openingTotal)}` : t("imp.step.empty")) : "…" },
  ];
  return (
    <div className="stack">
      <PageHeader title={t("imp.title")} sub={t("imp.sub")} />
      <p className="msg info" role="note"><Icon name="alert" size={16} />{t("imp.backupFirst")}</p>
      <ol className="import-steps" aria-label={t("imp.stepsLabel")}>
        {steps.map((x, i) => { const ok = allowed.includes(x.k); return (
          <li key={x.k}><button type="button" disabled={!ok} aria-current={kind === x.k ? "step" : undefined} className={`istep${kind === x.k ? " is-current" : ""}${x.done ? " is-done" : ""}`} onClick={() => setKind(x.k)}>
            <span className="istep-n" aria-hidden="true">{x.done ? <Icon name="check" size={16} /> : i + 1}</span>
            <span className="istep-t"><b>{t(`imp.${x.k}`)}</b><small>{ok ? x.line : t("imp.step.locked")}</small></span>
          </button></li>); })}
      </ol>
      <p className="muted">{t(`imp.what.${kind}`)}</p>
      {kind === "units" ? <UnitImport key="u" /> : kind === "renters" ? <RenterImport key="r" /> : kind === "agreements" ? <AgreementImport key="a" /> : <OpeningImport key="o" />}
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

/** A drop target for the spreadsheet, with the columns it must contain listed beside it. */
function Picker({ f, spec, optional = [], label, template, templateName, hint }: { f: ReturnType<typeof useFile<any>>; spec: Record<string, string[]>; optional?: readonly string[]; label: (k: string) => string; template: Record<string, string | number>[]; templateName: string; hint?: string }) {
  const { t } = useI18n(); const [over, setOver] = useState(false);
  const required = Object.keys(spec).filter((k) => !optional.includes(k)), opt = Object.keys(spec).filter((k) => optional.includes(k));
  return (
    <div className="source">
      <div className="source-cols">
        <h2>{t("imp.fileNeeds")}</h2>
        {hint && <p className="muted">{hint}</p>}
        <div className="chips-static" role="list">{required.map((k) => <span key={k} role="listitem" className="col-chip req">{label(k)}</span>)}{opt.map((k) => <span key={k} role="listitem" className="col-chip">{label(k)}</span>)}</div>
        <p className="muted small"><span className="col-chip req">{t("imp.required")}</span> <span className="col-chip">{t("imp.optionalCol")}</span></p>
        <span className="caption">{t("imp.template")}</span>
        <ExportMenu name={templateName} rows={template} print={false} />
      </div>
      <label className={`dropzone${over ? " is-over" : ""}${f.name ? " has-file" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void f.pick(e.dataTransfer.files?.[0]); }}>
        <input ref={f.input} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => void f.pick(e.target.files?.[0])} />
        <span className="dz-ic"><Icon name={f.name ? "agreements" : "upload"} size={26} /></span>
        {f.name ? <><b className="dz-name">{f.name}</b><span className="muted">{t("imp.replaceFile")}</span></> : <><b>{t("imp.drop")}</b><span className="muted">{t("imp.choose")} · {t("imp.max")}</span></>}
      </label>
    </div>
  );
}

/** What happened, in plain words, once the import has gone through. */
function DoneCard({ text, again }: { text: string; again: () => void }) {
  const { t } = useI18n();
  return <Card><div className="done"><span className="done-ic"><Icon name="check" size={22} /></span><div><b>{t("imp.done")}</b><p>{text}</p></div><button className="btn" onClick={again}>{t("imp.another")}</button></div></Card>;
}

const StatusCol = (t: (k: string) => string, bad: Set<number>) => ({ head: t("status"), cell: (r: { row: number }) => (bad.has(r.row) ? <Badge tone="bad">{t("imp.problem")}</Badge> : <Badge tone="good">{t("imp.valid")}</Badge>) });

function Problems({ issues, label }: { issues: { row: number; field: string; code: string }[]; label: (f: string) => string }) {
  const { t } = useI18n();
  if (issues.length === 0) return null;
  return (
    <Card flush title={`${t("imp.problems")} (${issues.length})`} actions={<button className="btn sm" onClick={() => downloadCsv("import-problems.csv", issues.map((i) => ({ row: i.row, column: label(i.field), problem: t(`imp.err.${i.code}`) })))}><Icon name="download" size={15} />{t("imp.downloadProblems")}</button>}>
      <Table rows={issues.slice(0, 200).map((i, n) => ({ ...i, _id: String(n) }))} cols={[
        { head: t("imp.row"), cell: (i) => i.row, right: true }, { head: t("imp.column"), cell: (i) => label(i.field) }, { head: t("imp.problem"), cell: (i) => t(`imp.err.${i.code}`), text: true },
      ]} />
    </Card>
  );
}

function UnitImport() {
  const { t } = useI18n(); const f = useFile(UNIT_COLUMNS); const commit = useMutation(api.imports.commitUnits); const { run, error } = useRun(); const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const check = useQuery(api.imports.checkUnits, f.rows ? { rows: f.rows } : "skip");
  const label = (k: string) => ({ building: t("building"), floor: t("prop.floor"), unit: t("prop.unitNumber"), area: t("prop.area"), category: t("prop.category"), rate: t("prop.rate") } as Record<string, string>)[k] ?? k;
  if (done) return <DoneCard text={done} again={() => setDone(null)} />;
  return (
    <div className="stack">
      <Picker f={f} spec={UNIT_COLUMNS} label={label} template={UNIT_TEMPLATE} templateName="units-template" />
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
              { head: t("prop.area"), cell: (r) => r.area, right: true }, { head: t("prop.category"), cell: (r) => r.category }, { head: t("prop.rate"), cell: (r) => r.rate, right: true }, StatusCol(t, new Set(check.issues.map((i) => i.row))),
            ]} />
          </Card>
          {confirm && <ConfirmDialog title={t("imp.confirm").replace("{n}", String(check.summary.rows))} message={t("imp.confirmBody")} confirmLabel={t("imp.run")} onClose={() => setConfirm(false)}
            onConfirm={async () => { const r = await run(() => commit({ rows: f.rows! })); if (r) { setDone(t("imp.doneUnits").replace("{u}", String(r.units)).replace("{b}", String(r.buildings)).replace("{f}", String(r.floors))); f.reset(); } }} />}
        </>
      ))}
    </div>
  );
}

function RenterImport() {
  const { t } = useI18n(); const f = useFile(RENTER_COLUMNS, RENTER_OPTIONAL); const commit = useMutation(api.imports.commitRenters); const { run, error } = useRun(); const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const check = useQuery(api.imports.checkRenters, f.rows ? { rows: f.rows } : "skip");
  const label = (k: string) => ({ kind: t("renter.kind"), name: t("name"), tin: t("renter.tin"), license: t("renter.license"), phone: t("renter.phone"), email: t("email"), rep: t("renter.rep"), idNumber: t("renter.idNumber"), address: t("renter.address"), contactPerson: t("renter.contactPerson"), contactPhone: t("renter.contactPhone"), vat: t("renter.vat"), notes: t("renter.notes") } as Record<string, string>)[k] ?? k;
  if (done) return <DoneCard text={done} again={() => setDone(null)} />;
  return (
    <div className="stack">
      <Picker f={f} spec={RENTER_COLUMNS} optional={RENTER_OPTIONAL} label={label} template={RENTER_TEMPLATE} templateName="renters-template" />
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
              { head: t("renter.tin"), cell: (r) => r.tin }, { head: t("renter.phone"), cell: (r) => r.phone }, { head: t("email"), cell: (r) => r.email }, StatusCol(t, new Set(check.issues.map((i) => i.row))),
            ]} />
          </Card>
          {confirm && <ConfirmDialog title={t("imp.confirm").replace("{n}", String(check.summary.rows))} message={t("imp.confirmBody")} confirmLabel={t("imp.run")} onClose={() => setConfirm(false)}
            onConfirm={async () => { const r = await run(() => commit({ rows: f.rows! })); if (r) { setDone(t("imp.doneRenters").replace("{n}", String(r.renters))); f.reset(); } }} />}
        </>
      ))}
    </div>
  );
}

const FIELD = (t: (k: string) => string) => ({ building: t("building"), unit: t("prop.unitNumber"), renter: t("imp.f.renter"), start: t("imp.f.start"), startsAt: t("imp.f.start"), end: t("imp.f.end"), endsAt: t("imp.f.end"), basis: t("imp.f.basis"), amount: t("imp.f.amount"),
  dueDay: t("imp.f.dueDay"), deposit: t("imp.f.deposit"), depositPaid: t("imp.f.depositPaid"), escPercent: t("imp.f.esc"), escMonths: t("imp.f.escMonths"), due: t("imp.f.due"), dueAt: t("imp.f.due"), note: t("imp.f.note") } as Record<string, string>);

/** Save a big file in groups the server can take in one go. If a group fails the earlier ones stay saved and the message says how many. */
async function commitInChunks<R>(rows: R[], size: number, save: (part: R[]) => Promise<unknown>, onProgress: (done: number) => void): Promise<{ saved: number; failed: boolean }> {
  let saved = 0;
  for (let i = 0; i < rows.length; i += size) {
    try { await save(rows.slice(i, i + size)); } catch { return { saved, failed: true }; }
    saved += Math.min(size, rows.length - i); onProgress(saved);
  }
  return { saved, failed: false };
}

function AgreementImport() {
  const { t } = useI18n(); const { can } = useMe(); const f = useFile(AGREEMENT_COLUMNS, AGREEMENT_OPTIONAL); const commit = useMutation(api.imports.commitAgreements); const { error, busy } = useRun(); const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [progress, setProgress] = useState<number | null>(null);
  const parsed = useMemo(() => (f.rows ? readAgreementRows(f.rows) : null), [f.rows]);
  const check = useQuery(api.imports.checkAgreements, parsed && parsed.server.length ? { rows: parsed.server } : "skip");
  const label = (k: string) => FIELD(t)[k] ?? k;
  const issues: ClientProblem[] = parsed ? [...parsed.problems, ...(check?.issues ?? [])].sort((a, b) => a.row - b.row) : [];
  const ready = !!parsed && (parsed.server.length === 0 || !!check);
  const bad = new Set(issues.map((i) => i.row)).size;
  if (done) return <DoneCard text={done} again={() => setDone(null)} />;
  return (
    <div className="stack">
      <Picker f={f} spec={AGREEMENT_COLUMNS} optional={AGREEMENT_OPTIONAL} label={label} template={AGREEMENT_TEMPLATE} templateName="agreements-template" hint={t("imp.ag.hint")} />
      <Message error={error ?? f.readError ?? msg} />
      {f.missing.length > 0 && <div className="msg bad" role="alert"><Icon name="alert" />{t("imp.missingCols")}: {f.missing.map(label).join(", ")}</div>}
      {f.rows && (!ready ? <Card><Skeleton lines={4} /></Card> : (
        <>
          <div className="kpis kpis-4">
            <Kpi icon="agreements" label={t("imp.rows")} value={f.rows.length} />
            <Kpi tone="good" icon="check" label={t("imp.valid")} value={f.rows.length - bad} sub={check ? `${check.summary.active} ${t("imp.active")} · ${check.summary.expired} ${t("imp.expired")}` : undefined} />
            <Kpi tone={bad ? "bad" : undefined} icon="alert" label={t("imp.problems")} value={bad} />
          </div>
          <Problems issues={issues} label={label} />
          {issues.length > 0 && <p className="muted">{t("imp.fixFirst")}</p>}
          {!can("approver") && <p className="muted">{t("imp.needApprover")}</p>}
          <Card flush title={t("imp.preview")} actions={<button className="btn primary" disabled={issues.length > 0 || !can("approver") || busy || progress !== null} onClick={() => setConfirm(true)}>{progress !== null ? t("imp.progress").replace("{a}", String(progress)).replace("{b}", String(f.rows.length)) : `${t("imp.run")} (${f.rows.length})`}</button>}>
            <Table rows={f.rows.slice(0, 50).map((r) => ({ ...r, _id: String(r.row) }))} cols={[
              { head: t("imp.row"), cell: (r) => r.row, right: true }, { head: t("prop.unitNumber"), cell: (r) => <strong>{r.unit}</strong> }, { head: t("ag.renter"), cell: (r) => r.renter },
              { head: t("ag.start"), cell: (r) => r.start }, { head: t("ag.end"), cell: (r) => r.end }, { head: t("imp.f.basis"), cell: (r) => r.basis }, { head: t("imp.f.amount"), cell: (r) => r.amount, right: true }, { head: t("imp.f.deposit"), cell: (r) => r.deposit, right: true }, StatusCol(t, new Set(issues.map((i) => i.row))),
            ]} />
          </Card>
          {confirm && parsed && <ConfirmDialog title={t("imp.confirm").replace("{n}", String(parsed.server.length))} message={t("imp.ag.confirmBody")} confirmLabel={t("imp.run")} onClose={() => setConfirm(false)}
            onConfirm={async () => {
              setMsg(null); setProgress(0);
              const r = await commitInChunks(parsed.server, check?.chunk ?? 150, (part) => commit({ rows: part }), setProgress);
              setProgress(null);
              if (r.failed) setMsg(t("imp.partial").replace("{a}", String(r.saved)).replace("{b}", String(parsed.server.length))); else { setMsg(null); setDone(t("imp.doneAgreements").replace("{n}", String(parsed.server.length)).replace("{a}", String(check?.summary.active ?? 0)).replace("{e}", String(check?.summary.expired ?? 0))); f.reset(); }
            }} />}
        </>
      ))}
    </div>
  );
}

function OpeningImport() {
  const { t } = useI18n(); const { can } = useMe(); const f = useFile(OPENING_COLUMNS, OPENING_OPTIONAL); const commit = useMutation(api.imports.commitOpening); const { error, busy } = useRun(); const [done, setDone] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); });
  const [confirm, setConfirm] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [progress, setProgress] = useState<number | null>(null);
  const parsed = useMemo(() => (f.rows && asOf != null ? readOpeningRows(f.rows, asOf) : null), [f.rows, asOf]);
  const check = useQuery(api.imports.checkOpening, parsed && parsed.server.length ? { rows: parsed.server } : "skip");
  const label = (k: string) => FIELD(t)[k] ?? k;
  const issues: ClientProblem[] = parsed ? [...parsed.problems, ...(check?.issues ?? [])].sort((a, b) => a.row - b.row) : [];
  const ready = !!parsed && (parsed.server.length === 0 || !!check);
  const bad = new Set(issues.map((i) => i.row)).size;
  if (done) return <DoneCard text={done} again={() => setDone(null)} />;
  return (
    <div className="stack">
      <Picker f={f} spec={OPENING_COLUMNS} optional={OPENING_OPTIONAL} label={label} template={OPENING_TEMPLATE} templateName="opening-balances-template" hint={t("imp.op.hint")} />
      <Card title={t("imp.op.asOf")}><div className="row"><label className="field" style={{ minWidth: 220 }}><span className="sr-only">{t("imp.op.asOf")}</span><DateField value={asOf} onChange={setAsOf} /></label><span className="muted">{t("imp.op.asOfHint")}</span></div></Card>
      <Message error={error ?? f.readError ?? msg} />
      {f.missing.length > 0 && <div className="msg bad" role="alert"><Icon name="alert" />{t("imp.missingCols")}: {f.missing.map(label).join(", ")}</div>}
      {f.rows && (!ready ? <Card><Skeleton lines={4} /></Card> : (
        <>
          <div className="kpis kpis-4">
            <Kpi icon="bills" label={t("imp.rows")} value={f.rows.length} />
            <Kpi tone="warn" icon="alert" label={t("imp.owed")} value={check ? formatEtb(check.summary.owed) : "–"} />
            <Kpi tone="good" icon="check" label={t("imp.credit")} value={check ? formatEtb(check.summary.credit) : "–"} />
            <Kpi tone={bad ? "bad" : undefined} icon="alert" label={t("imp.problems")} value={bad} />
          </div>
          <Problems issues={issues} label={label} />
          {issues.length > 0 && <p className="muted">{t("imp.fixFirst")}</p>}
          {!can("approver") && <p className="muted">{t("imp.needApprover")}</p>}
          <Card flush title={t("imp.preview")} actions={<button className="btn primary" disabled={issues.length > 0 || !can("approver") || busy || progress !== null} onClick={() => setConfirm(true)}>{progress !== null ? t("imp.progress").replace("{a}", String(progress)).replace("{b}", String(f.rows.length)) : `${t("imp.run")} (${f.rows.length})`}</button>}>
            <Table rows={(parsed?.server ?? []).slice(0, 50).map((r) => ({ ...r, _id: String(r.row) }))} cols={[
              { head: t("imp.row"), cell: (r) => r.row, right: true }, { head: t("ag.renter"), cell: (r) => <strong>{r.renter}</strong> }, { head: t("prop.unitNumber"), cell: (r) => r.unit || "—" },
              { head: t("imp.f.amount"), cell: (r) => <Money v={r.amount} strong />, right: true, money: true }, { head: t("imp.f.due"), cell: (r) => <DateText ms={r.dueAt} /> }, { head: t("imp.f.note"), cell: (r) => r.note, text: true }, StatusCol(t, new Set(issues.map((i) => i.row))),
            ]} />
          </Card>
          {confirm && parsed && <ConfirmDialog title={t("imp.confirm").replace("{n}", String(parsed.server.length))} message={t("imp.op.confirmBody")} confirmLabel={t("imp.run")} onClose={() => setConfirm(false)}
            onConfirm={async () => {
              setMsg(null); setProgress(0);
              const r = await commitInChunks(parsed.server, check?.chunk ?? 150, (part) => commit({ rows: part }), setProgress);
              setProgress(null);
              if (r.failed) setMsg(t("imp.partial").replace("{a}", String(r.saved)).replace("{b}", String(parsed.server.length))); else { setMsg(null); setDone(t("imp.doneOpening").replace("{n}", String(parsed.server.length)).replace("{o}", formatEtb(check?.summary.owed ?? 0)).replace("{c}", formatEtb(check?.summary.credit ?? 0))); f.reset(); }
            }} />}
        </>
      ))}
    </div>
  );
}
