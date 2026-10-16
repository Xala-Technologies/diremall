"use client";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BROADCAST_PLACEHOLDERS, checkTemplate, renderTemplate, smsSegments } from "../../../../convex/lib/smsTemplates";
import { FilterSelect } from "@/components/FilterSelect";
import { Card, ConfirmDialog, Message } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";
import { Bubble, Chips, insertAt } from "./Templates";

type Kind = "activeLeases" | "overdue" | "building" | "renters";

/** Write a notice (maintenance, a closure, a reminder to everyone) and send it to a chosen group, in each renter's language. */
export function ComposeTab() {
  const { t } = useI18n(); const toast = useToast();
  const buildings = useQuery(api.properties.listBuildings); const renters = useQuery(api.renters.list, {});
  const send = useMutation(api.smsQueue.sendBroadcast); const { run, error, busy } = useRun(); const gw = useQuery(api.smsQueue.gateway);
  const [kind, setKind] = useState<Kind>("activeLeases"); const [buildingId, setBuildingId] = useState(""); const [picked, setPicked] = useState<Set<string>>(new Set()); const [q, setQ] = useState("");
  const [en, setEn] = useState(""); const [am, setAm] = useState(""); const [confirm, setConfirm] = useState(false);
  const enRef = useRef<HTMLTextAreaElement>(null); const amRef = useRef<HTMLTextAreaElement>(null);
  const audience = { kind, ...(kind === "building" && buildingId ? { buildingId: buildingId as Id<"buildings"> } : {}), ...(kind === "renters" ? { renterIds: [...picked] as Id<"renters">[] } : {}) };
  const ready = kind !== "building" || !!buildingId;
  const pre = useQuery(api.smsQueue.audiencePreview, ready ? { audience } : "skip");
  const checkEn = checkTemplate(BROADCAST_PLACEHOLDERS, en); const checkAm = am.trim() ? checkTemplate(BROADCAST_PLACEHOLDERS, am) : { ok: true, problems: [] as { code: string; detail?: string }[] };
  const first = pre?.recipients[0];
  const sample = (text: string) => renderTemplate(text, { renter: first?.name ?? "Abebe Trading PLC", unit: first?.unit ?? "G-01", org: "Dire Mall" });
  // an estimate of what the operator will bill: English text for English readers, the Amharic text (or English) for Amharic readers
  const nEn = pre ? pre.count - pre.amharic : 0, nAm = pre?.amharic ?? 0;
  const segs = en.trim() ? nEn * smsSegments(sample(en)).segments + nAm * smsSegments(sample(am.trim() ? am : en)).segments : 0;
  const shownRenters = (renters ?? []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const canSend = checkEn.ok && checkAm.ok && !!en.trim() && !!pre && pre.count > 0 && !pre.tooMany && !busy;
  const problems = (c: { problems: { code: string; detail?: string }[] }) => c.problems.map((p) => t(`sms.problem.${p.code}`) + (p.detail ? ` {${p.detail}}` : "")).join(" · ");
  return (
    <div className="stack">
      <p className="muted">{t("sms.composeIntro")}</p>
      <Card title={t("sms.audience")}>
        <div className="stack">
          <div className="form">
            <div className="field"><span>{t("sms.sendTo")}</span><FilterSelect label={t("sms.sendTo")} value={kind} onChange={(v) => setKind(v as Kind)} options={(["activeLeases", "overdue", "building", "renters"] as const).map((k) => ({ value: k, label: t(`sms.aud.${k}`) }))} /></div>
            {kind === "building" && <div className="field"><span>{t("building")}</span><FilterSelect label={t("building")} placeholder={t("building")} value={buildingId} onChange={setBuildingId} options={(buildings ?? []).map((b) => ({ value: b._id, label: b.name }))} /></div>}
          </div>
          {kind === "renters" && <div className="picker"><input aria-label={t("search")} placeholder={t("filter.searchRenters")} value={q} onChange={(e) => setQ(e.target.value)} />
            <ul>{shownRenters.slice(0, 60).map((r) => <li key={r._id}><label className="row"><input type="checkbox" checked={picked.has(r._id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(r._id)) n.delete(r._id); else n.add(r._id); return n; })} />{r.name}</label></li>)}</ul></div>}
          {pre && <p className="aud-sum"><b>{pre.count}</b> {t("sms.recipients")}{pre.optedOut > 0 && <> · {pre.optedOut} {t("sms.leftOutOpt")}</>}{pre.noPhone > 0 && <> · {pre.noPhone} {t("sms.leftOutPhone")}</>}{pre.amharic > 0 && <> · {pre.amharic} {t("sms.inAmharic")}</>}</p>}
          {pre?.tooMany && <p className="msg bad" role="alert">{t("err.too_many_recipients")}</p>}
        </div>
      </Card>
      <Card title={t("sms.message")}>
        <div className="sms-split">
        <div className="stack">
          <label className="field"><span>{t("sms.text")} (English)</span><textarea ref={enRef} rows={3} value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("sms.composePlaceholder")} /></label>
          <Chips names={BROADCAST_PLACEHOLDERS} onInsert={(n) => insertAt(enRef.current, n, setEn, en, `{${n}}`)} />
          <label className="field"><span>{t("sms.text")} (አማርኛ) <small className="muted">{t("optional")}</small></span><textarea ref={amRef} rows={3} lang="am" value={am} onChange={(e) => setAm(e.target.value)} /><small className="muted">{t("sms.amHint")}</small></label>
          {!checkEn.ok && en.trim() !== "" && <div className="msg bad" role="alert">{problems(checkEn)}</div>}
          {!checkAm.ok && <div className="msg bad" role="alert">{problems(checkAm)}</div>}
          {segs > 0 && <p className="muted">{t("sms.estimate").replace("{n}", String(segs))}</p>}
          {gw && !gw.configured && <p className="msg info" role="status">{t("sms.noGateway")}</p>}
          <Message error={error} />
          <div><button className="btn primary" disabled={!canSend} onClick={() => setConfirm(true)}>{t("sms.sendTo2").replace("{n}", String(pre?.count ?? 0))}</button></div>
        </div>
        <div className="sms-side"><span className="caption">{t("sms.preview")} (English)</span><Bubble text={sample(en)} lang="en" />{am.trim() && <><span className="caption">{t("sms.preview")} (አማርኛ)</span><Bubble text={sample(am)} lang="am" /></>}</div>
        </div>
      </Card>
      {confirm && <ConfirmDialog title={t("sms.confirmTitle").replace("{n}", String(pre?.count ?? 0))} message={t("sms.confirmBody")} confirmLabel={t("sms.send")} onClose={() => setConfirm(false)}
        onConfirm={async () => { const r = await run(() => send({ audience, body: en, bodyAm: am.trim() ? am : undefined })); if (r) { toast(t("sms.queuedN").replace("{n}", String(r.queued))); setEn(""); setAm(""); } }} />}
    </div>
  );
}
