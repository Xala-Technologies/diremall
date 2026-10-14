// Plain checks shared by the server (imports) and the screens (forms).
export const isPhone = (v: string) => /^(\+?251|0)?[1-9]\d{8}$/.test(v.replace(/[\s-]/g, ""));
export const isTin = (v: string) => /^\d{10}$/.test(v.replace(/\s/g, ""));
export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

/** "0911 20 01 01" or "911200101" → "+251911200101" */
export function normalizePhone(v: string): string {
  const d = v.replace(/[\s-]/g, "").replace(/^\+/, "");
  if (d.startsWith("251")) return `+${d}`;
  if (d.startsWith("0")) return `+251${d.slice(1)}`;
  return `+251${d}`;
}

/** "12,500.50" → 12500.5, or null when it is not a plain number. */
export function parseNumber(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
}
