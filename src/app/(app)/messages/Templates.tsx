"use client";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { checkTemplate, renderTemplate, sampleVars, smsSegments, type Lang, type TemplateKind } from "../../../../convex/lib/smsTemplates";
import { Badge, Card, Message, Skeleton, Tabs } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

/** What a message will look like on a phone, with the length and cost it will have. */
export function Bubble({ text, lang }: { text: string; lang: Lang }) {
  const { t } = useI18n(); const s = smsSegments(text);
  return (
    <div className="sms-preview">
      <div className="phone" aria-hidden="false"><div className="phone-bar"><span className="phone-dot" />SMS</div><div className="sms-bubble" lang={lang}>{text || "…"}</div></div>
      <div className="sms-count">{s.length} {t("sms.chars")} · {s.segments} {s.segments === 1 ? t("sms.segment") : t("sms.segmentsN")}{s.unicode ? ` · ${t("sms.unicodeShort")}` : ""}</div>
    </div>
  );
}

/** Insert-a-placeholder buttons for a text box. */
export function Chips({ names, onInsert }: { names: readonly string[]; onInsert: (name: string) => void }) {
  const { t } = useI18n();
  return <div className="chips" role="group" aria-label={t("sms.placeholders")}>{names.map((n) => <button key={n} type="button" className="chip" onClick={() => onInsert(n)} title={`{${n}}`} aria-label={`${t("sms.placeholders")}: ${t(`sms.ph.${n}`)}`}>+ {t(`sms.ph.${n}`)}</button>)}</div>;
}

export function insertAt(el: HTMLTextAreaElement | null, text: string, setValue: (v: string) => void, current: string, token: string) {
  const start = el?.selectionStart ?? current.length, end = el?.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  setValue(next);
  requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  return next;
}

function TemplateCard({ tpl, org }: { tpl: NonNullable<ReturnType<typeof useQuery<typeof api.smsQueue.templates>>>["templates"][number]; org: string }) {
  const { t } = useI18n(); const { can } = useMe(); const save = useMutation(api.smsQueue.saveTemplate); const reset = useMutation(api.smsQueue.resetTemplate); const { run, error, busy } = useRun();
  const [lang, setLang] = useState<Lang>("en");
  const cur = tpl.langs[lang]!;
  const [drafts, setDrafts] = useState<Record<string, { body: string; enabled: boolean }>>({});
  const d = drafts[lang] ?? { body: cur.body, enabled: cur.enabled };
  const set = (patch: Partial<typeof d>) => setDrafts({ ...drafts, [lang]: { ...d, ...patch } });
  const ref = useRef<HTMLTextAreaElement>(null);
  const check = checkTemplate(tpl.placeholders, d.body);
  const changed = d.body !== cur.body || d.enabled !== cur.enabled;
  const preview = renderTemplate(d.body, sampleVars(tpl.kind as TemplateKind, lang, org));
  const canEdit = can("financeOfficer", "approver");
  return (
    <Card title={t(`sms.tpl.${tpl.kind}`)} actions={<><Badge tone={cur.edited ? "info" : "muted"}>{cur.edited ? t("sms.edited") : t("sms.builtin")}</Badge><Tabs value={lang} onChange={(v) => setLang(v as Lang)} tabs={[["en", "English"], ["am", "አማርኛ"]]} /></>}>
      <p className="muted">{t(`sms.tplWhen.${tpl.kind}`)}</p>
      <div className="sms-split">
      <div className="stack">
        <label className="field"><span>{t("sms.text")} ({lang === "en" ? "English" : "አማርኛ"})</span>
          <textarea ref={ref} rows={3} value={d.body} disabled={!canEdit} lang={lang} onChange={(e) => set({ body: e.target.value })} /></label>
        {canEdit && <Chips names={tpl.placeholders} onInsert={(n) => insertAt(ref.current, n, (v) => set({ body: v }), d.body, `{${n}}`)} />}
        {!check.ok && <div className="msg bad" role="alert">{check.problems.map((p) => t(`sms.problem.${p.code}`) + (p.detail ? ` {${p.detail}}` : "")).join(" · ")}</div>}
        <label className="row"><input type="checkbox" checked={d.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} />{t("sms.sendThis")}</label>
        <Message error={error} />
        {canEdit && <div className="row">
          <button className="btn primary" disabled={busy || !changed || !check.ok} onClick={async () => { if ((await run(() => save({ kind: tpl.kind, lang, body: d.body, enabled: d.enabled }), t("saved"))) !== undefined) setDrafts({ ...drafts, [lang]: undefined as never }); }}>{t("save")}</button>
          {cur.edited && <button className="btn" disabled={busy} onClick={async () => { if ((await run(() => reset({ kind: tpl.kind, lang }), t("saved"))) !== undefined) setDrafts({ ...drafts, [lang]: undefined as never }); }}>{t("sms.resetBuiltin")}</button>}
          {d.body !== cur.original && !cur.edited && <button className="btn ghost" onClick={() => set({ body: cur.original, enabled: true })}>{t("sms.useBuiltin")}</button>}
        </div>}
      </div>
      <div className="sms-side"><span className="caption">{t("sms.preview")}</span><Bubble text={preview} lang={lang} /></div>
      </div>
    </Card>
  );
}

export function TemplatesTab() {
  const { t } = useI18n(); const data = useQuery(api.smsQueue.templates);
  if (!data) return <Card><Skeleton lines={5} /></Card>;
  return <div className="stack"><p className="muted">{t("sms.tplIntro")}</p>{data.templates.map((tpl) => <TemplateCard key={tpl.kind} tpl={tpl} org={data.org} />)}</div>;
}
