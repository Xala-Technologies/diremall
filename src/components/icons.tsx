import { useId } from "react";
import { Trash2, Bell, AlertCircle, ArrowDown, Eye, EyeOff, ArrowUp, ArrowUpDown, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, ChartColumn, Download, FileText, Globe, History, Inbox, Landmark, LayoutDashboard, type LucideIcon, Menu, MessageSquare, Monitor, Moon, Plus, Printer, Receipt, Search, Settings, ShieldCheck, Sun, Upload, Users, Wallet, X, Zap } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard, buildings: Building2, renters: Users, agreements: FileText, bills: Receipt, payments: Wallet, bank: Landmark, utilities: Zap,
  reports: ChartColumn, messages: MessageSquare, settings: Settings, access: ShieldCheck, history: History, chevron: ChevronRight, back: ChevronLeft, menu: Menu,
  sort: ArrowUpDown, sortUp: ArrowUp, sortDown: ArrowDown, search: Search, bell: Bell, eye: Eye, eyeOff: EyeOff, upload: Upload, check: Check, plus: Plus, close: X, trash: Trash2, download: Download, print: Printer, inbox: Inbox, alert: AlertCircle, globe: Globe, calendar: CalendarDays, sun: Sun, moon: Moon, monitor: Monitor,
};

/** lucide-react icons, 16–18 px inside controls (same icon family as the Møterom app). */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Inbox;
  return <C className="icon" size={size} strokeWidth={1.75} aria-hidden="true" />;
}

/**
 * The Dire Mall mark: a "D" whose opening shows the mall's atrium, galleries of lit shopfronts around a courtyard kiosk.
 * Below about 30 px the scene turns to mush, so small sizes use the simple version (gallery floors, one lit).
 */
export function Mark({ size = 36 }: { size?: number }) {
  const id = `dm${useId().replace(/:/g, "")}`;
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {size >= 30 ? <><defs><clipPath id={`${id}-c`}><path d="M17 14H35C45 14 52 21 52 32C52 43 45 50 35 50H17Z"/></clipPath><linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#06233f"/><stop offset="1" stopColor="#14496f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#003057"/><path fill="#fff" fillRule="evenodd" d="M10 7H35C50 7 58 17.5 58 32C58 46.5 50 57 35 57H10ZM17 14V50H35C45 50 52 43 52 32C52 21 45 14 35 14Z"/><g clipPath={`url(#${id}-c)`}><g transform="translate(34.5 32) scale(1.07) translate(-35 -32)"><rect x="14" y="12" width="42" height="42" fill={`url(#${id}-s)`}/><rect x="30" y="15" width="10" height="26" fill="#2b6a9c"/><g fill="#9fc6e6" fillOpacity=".55"><rect x="30" y="22" width="10" height=".9"/><rect x="30" y="29" width="10" height=".9"/><rect x="30" y="36" width="10" height=".9"/></g><rect x="14" y="20.5" width="16" height="1.5" fill="#fff"/><rect x="20.2" y="22.5" width="4" height="4.2" rx=".5" fill="#F5A623"/><rect x="25.0" y="22.5" width="4" height="4.2" rx=".5" fill="#FFD58A"/><rect x="20.2" y="21.6" width="4" height=".7" fill="#E4572E"/><rect x="14" y="27.5" width="16" height="1.5" fill="#fff"/><rect x="20.2" y="29.5" width="4" height="4.2" rx=".5" fill="#FFD58A"/><rect x="25.0" y="29.5" width="4" height="4.2" rx=".5" fill="#F5A623"/><rect x="20.2" y="28.6" width="4" height=".7" fill="#4DA3FF"/><rect x="14" y="34.5" width="16" height="1.5" fill="#fff"/><rect x="20.2" y="36.5" width="4" height="4.2" rx=".5" fill="#F5A623"/><rect x="25.0" y="36.5" width="4" height="4.2" rx=".5" fill="#FFD58A"/><rect x="20.2" y="35.6" width="4" height=".7" fill="#E4572E"/><rect x="40" y="20.5" width="16" height="1.5" fill="#fff"/><rect x="40.8" y="22.5" width="4" height="4.2" rx=".5" fill="#FFD58A"/><rect x="45.6" y="22.5" width="4" height="4.2" rx=".5" fill="#F5A623"/><rect x="40.8" y="21.6" width="4" height=".7" fill="#E4572E"/><rect x="40" y="27.5" width="16" height="1.5" fill="#fff"/><rect x="40.8" y="29.5" width="4" height="4.2" rx=".5" fill="#F5A623"/><rect x="45.6" y="29.5" width="4" height="4.2" rx=".5" fill="#FFD58A"/><rect x="40.8" y="28.6" width="4" height=".7" fill="#4DA3FF"/><rect x="40" y="34.5" width="16" height="1.5" fill="#fff"/><rect x="40.8" y="36.5" width="4" height="4.2" rx=".5" fill="#FFD58A"/><rect x="45.6" y="36.5" width="4" height="4.2" rx=".5" fill="#F5A623"/><rect x="40.8" y="35.6" width="4" height=".7" fill="#E4572E"/><rect x="14" y="43" width="42" height="8" fill="#3a6f97"/><rect x="14" y="43" width="42" height=".8" fill="#fff" fillOpacity=".35"/><rect x="31" y="38.5" width="8" height="4.5" fill="#FFE2A8"/><path d="M30 38.6H40L39 36.6H31Z" fill="#E4572E"/><g fill="#fff"><rect x="32.2" y="36.6" width="1.5" height="2"/><rect x="35.2" y="36.6" width="1.5" height="2"/></g><rect x="32.2" y="39.7" width="2.2" height="3.3" fill="#F5A623"/><rect x="35.4" y="39.7" width="2.2" height="3.3" fill="#4DA3FF" fillOpacity=".8"/></g></g></> : <><defs><clipPath id={`${id}-c`}><path d="M17 14H35C45 14 52 21 52 32C52 43 45 50 35 50H17Z"/></clipPath></defs><rect width="64" height="64" rx="14" fill="#003057"/><path fill="#fff" fillRule="evenodd" d="M10 7H35C50 7 58 17.5 58 32C58 46.5 50 57 35 57H10ZM17 14V50H35C45 50 52 43 52 32C52 21 45 14 35 14Z"/><g clipPath={`url(#${id}-c)`}><rect x="17" y="19" width="36" height="4" fill="#fff"/><rect x="17" y="28" width="36" height="4" fill="#F5A623"/><rect x="17" y="37" width="36" height="4" fill="#fff"/></g></>}
    </svg>
  );
}
