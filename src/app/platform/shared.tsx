"use client";
import { Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "info" | "muted"> = { active: "good", trial: "info", past_due: "warn", suspended: "bad", cancelled: "muted" };
export function CompanyStatus({ status }: { status: string }) { const { t } = useI18n(); return <Badge tone={STATUS_TONE[status] ?? "muted"}>{t(`plat.status.${status}`)}</Badge>; }

/** A used-against-limit bar. A limit of 0 means no limit. */
export function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const { t } = useI18n(); const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0; const hot = limit > 0 && used / limit >= 0.9;
  return (
    <div className="meter" role="group" aria-label={label}>
      <div className="meter-top"><span>{label}</span><b className="num">{used.toLocaleString()}{limit > 0 ? ` / ${limit.toLocaleString()}` : ` · ${t("plat.noLimit")}`}</b></div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={limit || used || 1} aria-valuenow={used} aria-label={label}><span style={{ width: `${limit > 0 ? pct : 0}%`, background: hot ? "var(--ds-color-danger-base-default)" : undefined }} /></div>
    </div>
  );
}

export const ago = (ms: number | null | undefined, lang: string) => {
  if (!ms) return "—";
  const d = Math.round((Date.now() - ms) / 86_400_000);
  if (d <= 0) return lang === "am" ? "ዛሬ" : "today"; if (d === 1) return lang === "am" ? "ትናንት" : "yesterday";
  return lang === "am" ? `ከ${d} ቀን በፊት` : `${d} days ago`;
};
