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

/** Three columns of different heights: units in a building. */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M8 24V13h4v11zm6 0V8h4v16zm6 0V16h4v8z" fill="var(--accent-ink)" />
    </svg>
  );
}
