import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { currentPeriod, formatPeriod, shiftPeriod } from "@/lib/format";

const pad = (m: number) => String(m).padStart(2, "0");

/** A billing month: step with the arrows, or open a month grid styled like the other filter dropdowns. */
export function PeriodPicker({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const { calendar, lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const today = currentPeriod();
  const locale = lang === "am" ? "am-ET" : "en-US";

  const label = (p: string, month: "long" | "short" = "long", withYear = true) => {
    if (calendar === "ethiopian") {
      const full = formatPeriod(p, "ethiopian", lang);
      return withYear ? full : full.replace(/ \d{4}$/, "");
    }
    const [y, m] = p.split("-").map(Number) as [number, number];
    return new Intl.DateTimeFormat(locale, { month, ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(Date.UTC(y, m - 1, 1));
  };

  const ethYear = (p: string) => formatPeriod(p, "ethiopian", lang).slice(-4);
  const yearLabel = calendar === "ethiopian" ? `${ethYear(`${year}-01`)}–${ethYear(`${year}-12`)}` : String(year);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey, true); };
  }, [open]);

  useEffect(() => {
    const grid = gridRef.current;
    if (open && grid) (grid.querySelector<HTMLElement>('[aria-pressed="true"]') ?? grid.querySelector<HTMLElement>('[aria-current="date"]') ?? grid.querySelector<HTMLElement>("button"))?.focus();
  }, [open, year]);

  const toggle = () => { if (!open) setYear(Number(value.slice(0, 4))); setOpen((o) => !o); };
  const choose = (p: string) => { onChange(p); setOpen(false); triggerRef.current?.focus(); };

  const moveFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
    if (!step) return;
    e.preventDefault();
    const cells = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = cells.indexOf(document.activeElement as HTMLButtonElement);
    cells[Math.min(cells.length - 1, Math.max(0, (i < 0 ? 0 : i) + step))]?.focus();
  };

  return (
    <div className={`period-picker${open ? " is-open" : ""}`} ref={rootRef} role="group" aria-label={t("period")}>
      <div className="period-bar">
        <button type="button" className="period-step" aria-label={t("period.prev")} onClick={() => onChange(shiftPeriod(value, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <button ref={triggerRef} type="button" className="period-trigger" aria-label={`${t("period")}: ${label(value)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={menuId} onClick={toggle}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); if (!open) toggle(); } }}>
          <CalendarDays size={16} aria-hidden="true" />
          <span className="period-value">{label(value)}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="period-step" aria-label={t("period.next")} onClick={() => onChange(shiftPeriod(value, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      {open && (
        <div id={menuId} className="period-menu" role="dialog" aria-label={t("period")}>
          <div className="period-menu-head">
            <button type="button" className="period-step" aria-label={t("period.prevYear")} onClick={() => setYear((y) => y - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
            <strong aria-live="polite">{yearLabel}</strong>
            <button type="button" className="period-step" aria-label={t("period.nextYear")} onClick={() => setYear((y) => y + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
          <div className="period-grid" ref={gridRef} onKeyDown={moveFocus}>
            {Array.from({ length: 12 }, (_, i) => {
              const p = `${year}-${pad(i + 1)}`;
              return (
                <button key={p} type="button" className="period-month" title={label(p)} aria-label={label(p)}
                  aria-pressed={p === value} aria-current={p === today ? "date" : undefined} onClick={() => choose(p)}>
                  {label(p, "short", false)}
                </button>
              );
            })}
          </div>
          <div className="period-menu-foot">
            <button type="button" className="btn ghost sm" onClick={() => choose(today)}>{t("period.thisMonth")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
