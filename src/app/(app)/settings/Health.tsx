"use client";
import { useConvex } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Badge, Card, Message } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

type Result = { findings: { area: string; code: string; ref: string; detail: string }[]; checked: Record<string, number>; truncated: boolean };
const words = (code: string) => { const s = code.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/** Run the books health check on demand: does every record agree with the records it is made of? Approvers only. */
export function Health() {
  const { t } = useI18n(); const convex = useConvex();
  const [res, setRes] = useState<Result | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [at, setAt] = useState<number | null>(null);
  const run = async () => { setBusy(true); setErr(null); try { setRes(await convex.query(api.integrity.check, {})); setAt(Date.now()); } catch { setErr(t("err.generic")); } finally { setBusy(false); } };
  return (
    <Card title={t("set.health")} actions={<button className="btn sm" onClick={() => void run()} disabled={busy}>{busy ? t("loading") : t("set.healthRun")}</button>}>
      <p className="muted">{t("set.healthHint")}</p>
      <Message error={err} />
      {res && <div className="stack">
        <p className={`msg ${res.findings.length ? "bad" : "good"}`} role="status"><Icon name={res.findings.length ? "alert" : "check"} size={16} />{res.findings.length ? t("set.healthFound").replace("{n}", String(res.findings.length)) : t("set.healthOk")}{at ? ` · ${new Date(at).toLocaleTimeString()}` : ""}</p>
        <p className="muted small">{Object.entries(res.checked).map(([k, v]) => `${v} ${k}`).join(" · ")}{res.truncated ? ` · ${t("set.healthPartial")}` : ""}</p>
        {res.findings.length > 0 && <ul className="req-list">{res.findings.map((f, i) => <li key={i}><div className="req-main"><b>{words(f.code)}</b><span className="muted">{f.ref}{f.detail ? ` · ${f.detail}` : ""}</span></div><Badge tone="warn">{f.area}</Badge></li>)}</ul>}
      </div>}
    </Card>
  );
}
