import type { ReactNode } from "react";

// One family, 1.6 stroke, 24 grid. Drawn for this app; no icon-pack look.
const P: Record<string, ReactNode> = {
  overview: <><path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 8h6V4h-6z" /></>,
  buildings: <><path d="M5 20V9l7-5 7 5v11" /><path d="M9 20v-5h6v5M9 11h.01M15 11h.01" /></>,
  renters: <><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M16 6.2a3 3 0 0 1 0 5.6M17.5 14.6c1.8.5 2.8 2 3 4.4" /></>,
  agreements: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4M10 12h5M10 15.5h5" /></>,
  bills: <><path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" /><path d="M9.5 8.5h5M9.5 12h5" /></>,
  payments: <><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M3.5 10h17M7 14.5h3" /></>,
  bank: <><path d="M3.5 9.5 12 4.5l8.5 5zM5.5 10v7M10 10v7M14 10v7M18.5 10v7M4 19.5h16" /></>,
  utilities: <><path d="M13 3.5 6 13.5h5l-1 7 7-10h-5z" /></>,
  reports: <><path d="M4.5 20V4.5M4.5 20h15" /><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6" /></>,
  messages: <><path d="M4 5.5h16v10H12l-4.5 3.5v-3.5H4z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>,
  access: <><path d="M12 3.5 5 6.5v5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9v-5z" /><path d="M9.2 12.2l2 2 3.6-3.8" /></>,
  history: <><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v3.5H8" /><path d="M12 8v4.2l2.6 1.6" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  collapse: <><path d="M14.5 6 8.5 12l6 6" /></>,
  check: <><path d="M5 12.5l4.2 4.2L19 7" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  download: <><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14" /></>,
  print: <><path d="M7 9V4h10v5M7 17H5v-6h14v6h-2M8 14h8v6H8z" /></>,
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

/** Three columns of different heights: units in a building. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path d="M8 24V13h4v11zm6 0V8h4v16zm6 0V16h4v8z" fill="var(--accent-ink)" />
    </svg>
  );
}
