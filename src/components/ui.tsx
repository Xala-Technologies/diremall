"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Building2 } from "lucide-react";
import { FilterSelect } from "./FilterSelect";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatEtb, parseEtb } from "@/lib/format";
import { Icon } from "./icons";
import { downloadCsv } from "@/lib/csv";
import { downloadXlsx } from "@/lib/xlsx";
import { ETH_MONTHS_AM, ETH_MONTHS_EN, ethiopianToGregorian, gregorianToEthiopian } from "../../convex/lib/ethiopianCalendar";

const InTable = createContext(false);
/** Inside a table the column header says ETB, so cells show only the figure. */
export const Money = ({ v, strong, bare: forceBare }: { v: number; strong?: boolean; bare?: boolean }) => {
  const bare = useContext(InTable) || !!forceBare;
  return <span className={`num ${strong ? "strong" : ""}`}>{bare ? formatEtb(v).replace("ETB ", "") : formatEtb(v)}</span>;
};

export function DateText({ ms }: { ms: number | null | undefined }) {
  const { calendar, lang } = useI18n();
  return <span>{formatDate(ms, calendar, lang)}</span>;
}

const TONE: Record<string, string> = { good: "success", warn: "warning", bad: "danger", info: "info", muted: "neutral" };
export function Badge({ tone, children }: { tone?: "good" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  const t = TONE[tone ?? "muted"];
  return <span className={`status status-${t}`}>{t === "success" ? <Icon name="check" size={13} /> : <span className="status-dot" />}{children}</span>;
}

export const statusTone = (s: string) =>
  (({ matched: "good", toMatch: "warn", ignored: "muted", active: "good", paid: "good", approved: "good", applied: "good", delivered: "good", occupied: "info", issued: "info", confirmed: "info", accepted: "info", partial: "warn", inReview: "warn", draft: "warn", recorded: "warn", queued: "warn", maintenance: "warn", flagged: "bad", failed: "bad", outstanding: "bad", terminated: "bad", voided: "bad", expired: "muted", inactive: "muted", vacant: "muted", cancelled: "muted", uncertain: "warn" }) as Record<string, "good" | "warn" | "bad" | "info" | "muted">)[s] ?? "muted";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={statusTone(status)}>{status === "paid" ? t("paidFull") : t(status)}</Badge>;
}

/**
 * Every page: the title with its main buttons on the right, then a row of filters (pickers, tabs, search) beneath.
 */
export function PageHeader({ title, sub, actions, filters, children }: { title: string; sub?: string; actions?: ReactNode; filters?: ReactNode; children?: ReactNode }) {
  // each screen names its browser tab, so several open tabs stay distinguishable
  useEffect(() => { document.title = `${title} · Dire Mall Rentals`; }, [title]);
  const buttons = actions ?? children;
  return (
    <div className="page-head-wrap">
      <header className="page-head">
        <div className="page-title"><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
        {filters && <div className="filter-bar">{filters}</div>}
        {buttons && <div className="actions">{buttons}</div>}
      </header>
    </div>
  );
}

export function Card({ title, children, actions, flush }: { title?: string; children: ReactNode; actions?: ReactNode; flush?: boolean }) {
  return <section className={`card ${flush ? "flush" : ""}`}>{(title || actions) && <header className="card-h"><h2>{title}</h2><div className="row">{actions}</div></header>}{children}</section>;
}

export type Col<T> = { head: string; cell: (r: T) => ReactNode; right?: boolean; money?: boolean; text?: boolean; hide?: boolean; sort?: (r: T) => string | number | null | undefined };
export function Table<T extends { _id?: string }>({ cols, rows, onRow, empty }: { cols: Col<T>[]; rows: T[] | undefined; onRow?: (r: T) => void; empty?: string }) {
  const { t } = useI18n();
  const [sortCol, setSortCol] = useState<number | null>(null); const [dir, setDir] = useState<1 | -1>(1);
  if (!rows) return <Skeleton lines={5} />;
  if (rows.length === 0) return <Empty title={empty ?? t("empty.default")} />;
  const sortFn = sortCol != null ? cols[sortCol]?.sort : undefined;
  const sorted = (list: T[]) => {
    if (!sortFn) return list;
    const val = (r: T) => sortFn(r) ?? "";
    return list.map((r, i) => [r, i] as const).sort(([a, ai], [b, bi]) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return c * dir || ai - bi;
    }).map(([r]) => r);
  };
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={cols.map((c) => c.head).filter(Boolean).slice(0, 3).join(", ") || t("table")}>
      <table>
        <thead><tr>{cols.map((c, i) => (
          <th key={i} className={`${c.right ? "r" : ""} ${c.head === "" ? "act" : ""} ${c.hide ? "hide-xl" : ""}`} aria-sort={sortCol === i ? (dir === 1 ? "ascending" : "descending") : c.sort ? "none" : undefined}>
            {c.head === "" ? <span className="sr-only">{t("actions")}</span> : c.sort ? (
              <button type="button" className="th-sort" onClick={() => { if (sortCol === i) setDir(dir === 1 ? -1 : 1); else { setSortCol(i); setDir(1); } }}>
                {c.head}{c.money ? " (ETB)" : ""}<Icon name={sortCol === i ? (dir === 1 ? "sortUp" : "sortDown") : "sort"} size={14} />
              </button>
            ) : <>{c.head}{c.money ? " (ETB)" : ""}</>}
          </th>))}</tr></thead>
        <tbody>{sorted(rows).map((r, i) => (
          <tr key={r._id ?? i} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined}
            tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
            {cols.map((c, j) => <td key={j} data-label={c.head || undefined} className={`${c.right ? "r" : ""} ${c.text ? "txt" : ""} ${c.head === "" ? "act" : ""} ${c.hide ? "hide-xl" : ""}`}><InTable.Provider value={!!c.money}>{c.cell(r)}</InTable.Provider></td>)}
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, narrow }: { title: string; onClose: () => void; children: ReactNode; narrow?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const d = ref.current!;
    d.showModal();
    return () => { d.close(); opener.current?.focus?.(); };
  }, []);
  return (
    <dialog className={`modal ${narrow ? "narrow" : ""}`} ref={ref} aria-labelledby="modal-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <header><h2 id="modal-title">{title}</h2><button className="btn ghost icon-only" onClick={onClose} aria-label={t("close")}><Icon name="close" size={20} /></button></header>
      {children}
    </dialog>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return <label className={`field ${error ? "invalid" : ""}`}><span>{label}</span>{children}{error ? <small className="field-error" role="alert"><Icon name="alert" size={14} />{error}</small> : hint && <small className="muted">{hint}</small>}</label>;
}

export function Message({ error, notice }: { error?: string | null; notice?: string | null }) {
  if (error) return <div className="msg bad" role="alert"><Icon name="alert" />{error}</div>;
  if (notice) return <div className="msg good" role="status"><Icon name="check" />{notice}</div>;
  return null;
}

/** ETB amount input; reports santim (or null while invalid). */
export function MoneyInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value / 100));
  return (
    <input inputMode="decimal" value={text} placeholder={placeholder ?? "0.00"}
      onChange={(e) => { setText(e.target.value); onChange(parseEtb(e.target.value)); }}
      // tidy the number when leaving the field: 12500 becomes 12,500.00
      onBlur={() => { const v = parseEtb(text); if (v != null) setText((v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }} />
  );
}

/** Date picker that follows the chosen calendar. Value is UTC midnight in ms. */
export function DateField({ value, onChange }: { value: number | null; onChange: (ms: number | null) => void }) {
  const { calendar, lang } = useI18n();
  if (calendar === "gregorian") {
    const iso = value == null ? "" : new Date(value).toISOString().slice(0, 10);
    return <input type="date" value={iso} onChange={(e) => onChange(e.target.value ? Date.parse(e.target.value) : null)} />;
  }
  const e = value == null ? { year: 2019, month: 1, day: 1 } : gregorianToEthiopian(new Date(value).getUTCFullYear(), new Date(value).getUTCMonth() + 1, new Date(value).getUTCDate());
  const set = (patch: Partial<typeof e>) => {
    const n = { ...e, ...patch };
    const maxDay = n.month === 13 ? (n.year % 4 === 3 ? 6 : 5) : 30;
    n.day = Math.min(n.day, maxDay);
    const g = ethiopianToGregorian(n);
    onChange(Date.UTC(g.year, g.month - 1, g.day));
  };
  const months = lang === "am" ? ETH_MONTHS_AM : ETH_MONTHS_EN;
  return (
    <div className="row eth-date">
      <select value={e.day} onChange={(x) => set({ day: Number(x.target.value) })}>{Array.from({ length: e.month === 13 ? 6 : 30 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
      <select value={e.month} onChange={(x) => set({ month: Number(x.target.value) })}>{months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
      <input type="number" value={e.year} min={1990} max={2100} onChange={(x) => set({ year: Number(x.target.value) })} />
    </div>
  );
}

export function useBuildingFilter(buildings: { _id: string }[] | undefined) {
  const [id, setId] = useState<string>("");
  return { id: (id || undefined) as any, setId, ready: !!buildings };
}

export function PeriodPicker({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const { calendar, lang, t } = useI18n();
  return (
    <div className="filter-chip" role="group" aria-label={t("period")}>
      <button type="button" className="btn ghost sm icon-only" aria-label={t("period.prev")} onClick={() => onChange(shiftPeriod(value, -1))}><Icon name="back" size={16} /></button>
      <input type="month" value={value} aria-label={t("period")} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button type="button" className="btn ghost sm icon-only" aria-label={t("period.next")} onClick={() => onChange(shiftPeriod(value, 1))}><Icon name="chevron" size={16} /></button>
      {calendar === "ethiopian" && <span className="muted chip-note">{formatPeriodLabel(value, lang)}</span>}
    </div>
  );
}
import { formatPeriod, shiftPeriod } from "@/lib/format";
const formatPeriodLabel = (p: string, lang: "en" | "am") => formatPeriod(p, "ethiopian", lang);

export function BuildingSelect({ buildings, value, onChange }: { buildings: { _id: string; name: string }[] | undefined; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <FilterSelect label={t("building")} placeholder={t("building")} value={value} onChange={onChange}
      options={[{ value: "", label: t("allBuildings"), icon: <Building2 size={16} /> }, ...(buildings ?? []).map((b) => ({ value: b._id, label: b.name, icon: <Building2 size={16} /> }))]} />
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <div className="pill-tabs" role="group">{tabs.map(([k, label]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{label}</button>)}</div>;
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <div key={i} className="sk" style={{ width: `${92 - ((i * 13) % 38)}%` }} />)}</div>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="inbox" size={26} /></div><b>{title}</b>{hint && <span>{hint}</span>}{action}</div>;
}

/** Ask for a reason (void, return, terminate…) without a browser prompt. */
export function ReasonDialog({ title, error, onClose, onSave }: { title: string; error?: string | null; onClose: () => void; onSave: (reason: string) => Promise<unknown> }) {
  const { t } = useI18n();
  const [r, setR] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} narrow>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const ok = await onSave(r.trim()); setBusy(false); if (ok !== undefined) onClose(); }}>
        <div className="wide"><Field label={t("reason")}><input autoFocus value={r} onChange={(e) => setR(e.target.value)} /></Field></div>
        <div className="wide"><Message error={error} /></div>
        <div className="wide row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={onClose}>{t("cancel")}</button><button className="btn primary" disabled={busy || !r.trim()}>{t("save")}</button></div>
      </form>
    </Modal>
  );
}

/** Totals under a table. */
export function TableFoot({ items }: { items: [string, ReactNode][] }) {
  return <div className="table-foot">{items.map(([k, v]) => <span key={k}>{k}<b>{v}</b></span>)}</div>;
}

export function Kpi({ icon, label, value, sub, tone, unit }: { icon: string; label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "info" | "warn"; unit?: string }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="kpi-top"><span>{label}</span><span className="kpi-ic"><Icon name={icon} size={20} /></span></div>
      <div className="kpi-v">{unit && <small>{unit}</small>}{value}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

/** Grouped bars per period: billed (light) and collected (solid). Values in santim; labelled in ETB thousands. */
export function BarChart({ data, labelA, labelB }: { data: { label: string; a: number; b: number }[]; labelA: string; labelB: string }) {
  const W = 560, H = 210, L = 44, B = 26, T = 10;
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const bw = (W - L) / Math.max(1, data.length);
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const k = (v: number) => (v / 100 >= 1_000_000 ? `${(v / 100 / 1_000_000).toFixed(1)}M` : `${Math.round(v / 100 / 1000)}k`);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labelA}, ${labelB}`}>
        {[0, 0.5, 1].map((f) => <g key={f}><line className="grid" x1={L} x2={W} y1={y(nice * f)} y2={y(nice * f)} /><text x={L - 8} y={y(nice * f) + 4} textAnchor="end">{k(nice * f)}</text></g>)}
        {data.map((d, i) => {
          const x = L + i * bw + bw * 0.16, w = bw * 0.34;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${labelA} ${(d.a / 100).toLocaleString()} · ${labelB} ${(d.b / 100).toLocaleString()}`}</title>
              <rect className="bar-a" x={x} y={y(d.a)} width={w} height={Math.max(0, H - B - y(d.a))} rx={3} />
              <rect className="bar-b" x={x + w + 3} y={y(d.b)} width={w} height={Math.max(0, H - B - y(d.b))} rx={3} />
              <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: 6 }}><span><i className="dot" style={{ background: "var(--ds-color-accent-surface-tinted)" }} />{labelA}</span><span><i className="dot" style={{ background: "var(--viz)" }} />{labelB}</span></div>
    </div>
  );
}

export function Donut({ parts, size = 120 }: { parts: { value: number; color: string; label: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = size / 2 - 11, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={16} />
      {parts.map((p) => {
        const len = (p.value / total) * c;
        const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={16} strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
        off += len;
        return el;
      })}
    </svg>
  );
}

export function ViewToggle({ value, onChange, labels }: { value: "grid" | "table"; onChange: (v: "grid" | "table") => void; labels: [string, string] }) {
  return (
    <div className="pill-tabs tight" role="group" aria-label="View">
      <button type="button" aria-pressed={value === "grid"} onClick={() => onChange("grid")}>{labels[0]}</button>
      <button type="button" aria-pressed={value === "table"} onClick={() => onChange("table")}>{labels[1]}</button>
    </div>
  );
}

/** Excel, CSV and PDF (the browser's save-as-PDF) for the rows shown on screen, so exports match the totals you see. */
export function ExportMenu({ name, rows, print = true }: { name: string; rows: Record<string, string | number | null | undefined>[]; print?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="row no-print" role="group" aria-label={t("export")}>
      <button className="btn sm" disabled={rows.length === 0} onClick={() => void downloadXlsx(name, [{ name: name.slice(0, 31), rows }])}><Icon name="download" size={15} />Excel</button>
      <button className="btn sm" disabled={rows.length === 0} onClick={() => downloadCsv(`${name}.csv`, rows)}>CSV</button>
      {print && <button className="btn sm" onClick={() => window.print()}><Icon name="print" size={15} />PDF</button>}
    </div>
  );
}

/** "Are you sure?" for actions that cannot be undone. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: { title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<unknown> | unknown; onClose: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} narrow>
      <p style={{ marginBottom: 20 }}>{message}</p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
        <button className={`btn ${danger ? "danger" : "primary"}`} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/** Search box with a magnifier, a clear button and a "/" shortcut that focuses it from anywhere on the page. */
export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector("dialog[open]")) { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="search-box" role="search">
      <span className="search-ic" aria-hidden="true"><Icon name="search" size={16} /></span>
      <input ref={ref} type="search" value={value} placeholder={placeholder ?? t("search")} aria-label={label ?? placeholder ?? t("search")}
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); } }} />
      {value ? <button type="button" className="search-clear" aria-label={t("search.clear")} onClick={() => { onChange(""); ref.current?.focus(); }}><Icon name="close" size={14} /></button>
        : !focused && <kbd className="search-key" aria-hidden="true">/</kbd>}
    </div>
  );
}
