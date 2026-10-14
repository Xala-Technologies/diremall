"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatEtb, parseEtb } from "@/lib/format";
import { ETH_MONTHS_AM, ETH_MONTHS_EN, ethiopianToGregorian, gregorianToEthiopian } from "../../convex/lib/ethiopianCalendar";

export const Money = ({ v, strong }: { v: number; strong?: boolean }) => <span className={`num ${strong ? "strong" : ""}`}>{formatEtb(v)}</span>;

export function DateText({ ms }: { ms: number | null | undefined }) {
  const { calendar, lang } = useI18n();
  return <span>{formatDate(ms, calendar, lang)}</span>;
}

export function Badge({ tone, children }: { tone?: "good" | "warn" | "bad" | "info" | "muted"; children: ReactNode }) {
  return <span className={`badge ${tone ?? "muted"}`}>{children}</span>;
}

export const statusTone = (s: string) =>
  (({ active: "good", paid: "good", approved: "good", applied: "good", delivered: "good", occupied: "info", issued: "info", confirmed: "info", accepted: "info", partial: "warn", inReview: "warn", draft: "warn", recorded: "warn", queued: "warn", maintenance: "warn", flagged: "bad", failed: "bad", outstanding: "bad", terminated: "bad", voided: "bad", expired: "muted", vacant: "muted", cancelled: "muted", uncertain: "warn" }) as Record<string, "good" | "warn" | "bad" | "info" | "muted">)[s] ?? "muted";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={statusTone(status)}>{status === "paid" ? t("paidFull") : t(status)}</Badge>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-header"><h1>{title}</h1><div className="row">{children}</div></div>;
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="card">{(title || actions) && <header className="card-h"><h2>{title}</h2><div className="row">{actions}</div></header>}{children}</section>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "good" }) {
  return <div className={`stat ${tone ?? ""}`}><div className="stat-l">{label}</div><div className="stat-v">{value}</div>{sub && <div className="stat-s">{sub}</div>}</div>;
}

export type Col<T> = { head: string; cell: (r: T) => ReactNode; right?: boolean };
export function Table<T extends { _id?: string }>({ cols, rows, onRow, empty }: { cols: Col<T>[]; rows: T[] | undefined; onRow?: (r: T) => void; empty?: string }) {
  const { t } = useI18n();
  if (!rows) return <p className="muted">{t("loading")}</p>;
  if (rows.length === 0) return <p className="muted">{empty ?? t("none")}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c, i) => <th key={i} className={c.right ? "r" : ""}>{c.head}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r._id ?? i} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined}>
            {cols.map((c, j) => <td key={j} className={c.right ? "r" : ""}>{c.cell(r)}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-h"><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label={t("close")}>✕</button></header>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

export function Message({ error, notice }: { error?: string | null; notice?: string | null }) {
  if (error) return <div className="msg bad" role="alert">{error}</div>;
  if (notice) return <div className="msg good" role="status">{notice}</div>;
  return null;
}

/** ETB amount input; reports santim (or null while invalid). */
export function MoneyInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value / 100));
  return (
    <input inputMode="decimal" value={text} placeholder={placeholder ?? "0.00"}
      onChange={(e) => { setText(e.target.value); onChange(parseEtb(e.target.value)); }} />
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
    <label className="row"><span className="muted">{t("period")}</span>
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      {calendar === "ethiopian" && <span className="muted">{formatPeriodLabel(value, lang)}</span>}
    </label>
  );
}
import { formatPeriod } from "@/lib/format";
const formatPeriodLabel = (p: string, lang: "en" | "am") => formatPeriod(p, "ethiopian", lang);

export function BuildingSelect({ buildings, value, onChange }: { buildings: { _id: string; name: string }[] | undefined; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <select aria-label={t("building")} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("allBuildings")}</option>
      {buildings?.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
    </select>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}</button>)}</div>;
}
