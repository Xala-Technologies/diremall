"use client";
import type { ReactNode } from "react";
import { Donut } from "@/components/ui";

/** Series colours: the brand blue first, then status colours, then neutrals. Used the same way in every report. */
export const SERIES = ["var(--viz)", "var(--ds-color-success-base-default)", "var(--ds-color-warning-base-default)", "var(--ds-color-danger-base-default)", "var(--ds-color-neutral-border-strong)"];

/** 1,234,000 ETB (in santim) -> "1.2M", 45,000 -> "45k". */
export const compact = (santim: number) => {
  const e = Math.abs(santim) / 100, s = santim < 0 ? "-" : "";
  return e >= 1_000_000 ? `${s}${(e / 1_000_000).toFixed(e >= 10_000_000 ? 0 : 1)}M` : e >= 10_000 ? `${s}${Math.round(e / 1000)}k` : `${s}${Math.round(e).toLocaleString()}`;
};
const full = (santim: number) => (santim / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const share = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "0%");

type Item = { label: string; value: number; sub?: string; color?: string };

/** Horizontal bars, longest first. The value is printed at the end of each bar, so nothing depends on colour alone. */
export function HBars({ items, format = compact, limit = 8 }: { items: Item[]; format?: (v: number) => string; limit?: number }) {
  const rows = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${full(r.value)}`}>
          <span className="hb-l">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="hb-t"><span className="hb-f" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? "var(--viz)" }} /></span>
          <span className="hb-v num">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One bar split into parts (for example arrears by age), with each part's value and share underneath. */
export function StackBar({ parts, format = compact }: { parts: Item[]; format?: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="stackbar">
      <div className="sb-bar" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} title={`${p.label}: ${full(p.value)}`} style={{ flexGrow: p.value, background: p.color }} />)}
      </div>
      <ul className="sb-legend">
        {parts.map((p) => <li key={p.label}><i className="dot" style={{ background: p.color }} /><span>{p.label}</span><b className="num">{format(p.value)}</b><small>{share(p.value, total)}</small></li>)}
      </ul>
    </div>
  );
}

/** A ring with a headline figure in the middle and a legend beside it. */
export function Ring({ parts, center, caption, format = (v: number) => String(v) }: { parts: Item[]; center: ReactNode; caption: string; format?: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="ring">
      <div className="ring-fig"><Donut size={150} parts={parts.map((p) => ({ value: p.value, color: (p.color ?? SERIES[0]) as string, label: p.label }))} /><div className="ring-c"><b>{center}</b><small>{caption}</small></div></div>
      <ul className="sb-legend">
        {parts.map((p) => <li key={p.label}><i className="dot" style={{ background: p.color }} /><span>{p.label}</span><b className="num">{format(p.value)}</b><small>{share(p.value, total)}</small></li>)}
      </ul>
    </div>
  );
}

/** Vertical columns over time (or any ordered categories). */
export function Columns({ items, format = compact, color = "var(--viz)" }: { items: Item[]; format?: (v: number) => string; color?: string }) {
  const W = 560, H = 200, L = 44, B = 26, T = 14;
  const max = Math.max(1, ...items.map((i) => i.value));
  const p = Math.pow(10, Math.floor(Math.log10(max))), nice = Math.ceil(max / p) * p;
  const bw = (W - L) / Math.max(1, items.length), y = (v: number) => T + (H - T - B) * (1 - v / nice);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={items.map((i) => `${i.label} ${format(i.value)}`).join(", ")}>
      {[0, 0.5, 1].map((f) => <g key={f}><line className="grid" x1={L} x2={W} y1={y(nice * f)} y2={y(nice * f)} /><text x={L - 8} y={y(nice * f) + 4} textAnchor="end">{format(nice * f)}</text></g>)}
      {items.map((d, i) => {
        const w = Math.min(36, bw * 0.55), x = L + i * bw + (bw - w) / 2;
        return <g key={d.label}><title>{`${d.label}: ${full(d.value)}${d.sub ? ` · ${d.sub}` : ""}`}</title>
          <rect x={x} y={y(d.value)} width={w} height={Math.max(0, H - B - y(d.value))} rx={3} fill={d.color ?? color} />
          {d.value > 0 && <text x={x + w / 2} y={y(d.value) - 5} textAnchor="middle">{format(d.value)}</text>}
          <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text></g>;
      })}
    </svg>
  );
}

/** A line with a soft area under it, for a balance or a rate over time. Handles negative values. */
export function Trend({ points, format = compact }: { points: { label: string; value: number }[]; format?: (v: number) => string }) {
  const W = 560, H = 200, L = 52, B = 26, T = 12, R = 26;
  if (points.length === 0) return null;
  const lo = Math.min(0, ...points.map((p) => p.value)), hi = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R)), y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${y(lo)} L${x(0).toFixed(1)} ${y(lo)} Z`;
  const ticks = [lo, (lo + hi) / 2, hi], step = Math.max(1, Math.ceil(points.length / 6));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={points.map((p) => `${p.label} ${format(p.value)}`).join(", ")}>
      {ticks.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 8} y={y(v) + 4} textAnchor="end">{format(v)}</text></g>)}
      <path d={area} fill="var(--viz)" opacity={0.1} /><path d={line} fill="none" stroke="var(--viz)" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => <g key={i}><title>{`${p.label}: ${full(p.value)}`}</title><circle cx={x(i)} cy={y(p.value)} r={3.5} fill="var(--viz)" />{i % step === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{p.label}</text>}</g>)}
    </svg>
  );
}
