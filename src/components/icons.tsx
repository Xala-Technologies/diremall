import { useId } from "react";
import { AlertCircle, ArrowDown, Eye, EyeOff, ArrowUp, ArrowUpDown, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, ChartColumn, Download, FileText, Globe, History, Inbox, Landmark, LayoutDashboard, type LucideIcon, Menu, MessageSquare, Monitor, Moon, Plus, Printer, Receipt, Search, Settings, ShieldCheck, Sun, Upload, Users, Wallet, X, Zap } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard, buildings: Building2, renters: Users, agreements: FileText, bills: Receipt, payments: Wallet, bank: Landmark, utilities: Zap,
  reports: ChartColumn, messages: MessageSquare, settings: Settings, access: ShieldCheck, history: History, chevron: ChevronRight, back: ChevronLeft, menu: Menu,
  sort: ArrowUpDown, sortUp: ArrowUp, sortDown: ArrowDown, search: Search, eye: Eye, eyeOff: EyeOff, upload: Upload, check: Check, plus: Plus, close: X, download: Download, print: Printer, inbox: Inbox, alert: AlertCircle, globe: Globe, calendar: CalendarDays, sun: Sun, moon: Moon, monitor: Monitor,
};

/** lucide-react icons, 16–18 px inside controls (same icon family as the Møterom app). */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Inbox;
  return <C className="icon" size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/** The Dire Mall mark: a "D" whose opening holds the gallery floors of the atrium, one of them lit. */
export function Mark({ size = 36 }: { size?: number }) {
  const id = `dm-${useId().replace(/:/g, "")}`;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs><clipPath id={id}><path d="M25 20H33C39.5 20 44 24.5 44 32C44 39.5 39.5 44 33 44H25Z" /></clipPath></defs>
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path fill="var(--accent-ink)" fillRule="evenodd" d="M16 11H33C46.5 11 54 19.5 54 32C54 44.5 46.5 53 33 53H16ZM25 20V44H33C39.5 44 44 39.5 44 32C44 24.5 39.5 20 33 20Z" />
      <g clipPath={`url(#${id})`}><rect x="22" y="22.5" width="26" height="3" fill="var(--accent-ink)" /><rect x="22" y="30.5" width="26" height="3" fill="#F5A623" /><rect x="22" y="38.5" width="26" height="3" fill="var(--accent-ink)" /></g>
    </svg>
  );
}
