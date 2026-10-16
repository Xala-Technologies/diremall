"use client";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { MfaEnroll } from "@/components/Mfa";
import { Badge, Card, Message } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

/** Two-step sign-in for the person looking at the screen, and the rule that makes it compulsory for everyone. */
export function Security() {
  const { t } = useI18n(); const { can } = useMe(); const s = useQuery(api.settings.get); const set = useMutation(api.settings.set); const mfa = useQuery(api.mfa.status); const disable = useMutation(api.mfa.disable);
  const { run, error, notice } = useRun(); const [enrolling, setEnrolling] = useState(false); const [offCode, setOffCode] = useState(""); const [offMsg, setOffMsg] = useState<string | null>(null);
  return (
    <div className="stack">
      <Message error={error} notice={notice} />
      <Card title={t("mfa.title")} actions={mfa ? <Badge tone={mfa.enabled ? "good" : "warn"}>{mfa.enabled ? t("mfa.on") : t("mfa.off")}</Badge> : undefined}>
        <div className="stack">
          <p className="muted">{t("set.mfaHint")}</p>
          {mfa?.enabled && <p className="muted">{t("mfa.recoveryLeft")}: {mfa.recoveryLeft}</p>}
          {mfa && (!mfa.enabled || enrolling) && <MfaEnroll onStart={() => setEnrolling(true)} onDone={() => setEnrolling(false)} />}
          {mfa?.enabled && !mfa.required && <form className="row" onSubmit={async (e) => { e.preventDefault(); setOffMsg(null); const r = await run(() => disable({ code: offCode }), t("saved")); if (r && !r.ok) setOffMsg(t("mfa.wrong")); else setOffCode(""); }}>
            <input aria-label={t("mfa.code")} placeholder={t("mfa.code")} autoComplete="one-time-code" inputMode="numeric" value={offCode} onChange={(e) => setOffCode(e.target.value)} />
            <button className="btn" disabled={offCode.replace(/\s/g, "").length < 6}>{t("mfa.disable")}</button></form>}
          {offMsg && <Message error={offMsg} />}
        </div>
      </Card>
      {can("accessAdmin") && s && <Card title={t("set.mfaRule")}>
        <label className="row"><input type="checkbox" checked={s["mfa.required"] === 1} disabled={!mfa?.enabled && s["mfa.required"] !== 1} onChange={(e) => void run(() => set({ key: "mfa.required", value: e.target.checked ? 1 : 0 }), t("saved"))} />
          <span>{t("mfa.requiredLabel")}<br /><small className="muted">{t("mfa.requiredHint")}</small></span></label>
      </Card>}
      {can("accessAdmin") && <Card title={t("nav.users")}><p className="muted">{t("set.staffHint")}</p><Link className="btn" href="/users">{t("set.openStaff")}</Link></Card>}
    </div>
  );
}
