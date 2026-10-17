"use client";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Card, DateText, Field, Message, SelectField, Skeleton, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

/** The currency, timezone and default language the company works in. */
export function Formats() {
  const { t } = useI18n(); const { can } = useMe(); const co = useQuery(api.settings.company); const save = useMutation(api.settings.setCompany); const { run, error, busy } = useRun();
  const [f, setF] = useState<{ currency: string; tz: string; lang: "en" | "am"; cal: "gregorian" | "ethiopian" } | null>(null);
  useEffect(() => { if (co && !f) setF({ currency: co.currency, tz: String(co.tzOffsetHours), lang: co.defaultLang, cal: co.defaultCalendar }); }, [co, f]);
  if (!co || !f) return <Card><Skeleton lines={3} /></Card>;
  const edit = can("approver");
  return (
    <Card title={t("set.formatsTitle")}>
      <form noValidate className="stack" onSubmit={async (e) => { e.preventDefault(); await run(() => save({ currency: f.currency.trim().toUpperCase(), tzOffsetHours: Number(f.tz), defaultLang: f.lang, defaultCalendar: f.cal }), t("saved")); }}>
        <p className="muted">{t("set.formatsHint")}</p>
        <div className="form">
          <Field label={t("set.currency")} hint={t("set.currencyHint")}><input value={f.currency} maxLength={3} disabled={!edit} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
          <Field label={t("set.tz")}><input inputMode="numeric" value={f.tz} disabled={!edit} onChange={(e) => setF({ ...f, tz: e.target.value })} /></Field>
          <SelectField label={t("set.defaultLang")} value={f.lang} disabled={!edit} onChange={(v) => setF({ ...f, lang: v as "en" | "am" })} options={[{ value: "en", label: "English" }, { value: "am", label: "አማርኛ" }]} />
          <SelectField label={t("set.defaultCal")} value={f.cal} disabled={!edit} onChange={(v) => setF({ ...f, cal: v as "gregorian" | "ethiopian" })} options={[{ value: "gregorian", label: t("gregorian") }, { value: "ethiopian", label: t("ethiopian") }]} />
        </div>
        <Message error={error} />
        {edit && <div className="row"><button className="btn primary" disabled={busy}>{t("save")}</button></div>}
      </form>
    </Card>
  );
}

/** A copy of the company's records, and the log of every time the platform team looked at them. */
export function DataPrivacy() {
  const { t } = useI18n(); const exports = useQuery(api.exports.list); const access = useQuery(api.settings.supportAccess);
  const request = useMutation(api.exports.request); const link = useMutation(api.exports.link); const { run, error, busy } = useRun();
  const site = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site");
  const download = async (id: Id<"dataExports">) => { const r = await run(() => link({ exportId: id })); if (r) window.location.href = `${site}/files/${r.token}`; };
  const tone = (s: string) => (s === "ready" ? "good" : s === "failed" ? "bad" : "info") as "good" | "bad" | "info";
  return (
    <div className="stack">
      <Card title={t("set.dataTitle")} actions={<button className="btn primary" disabled={busy} onClick={() => run(() => request(), t("saved"))}>{t("set.dataRequest")}</button>}>
        <p className="muted">{t("set.dataHint")}</p><Message error={error} />
        <Table rows={exports?.map((e) => ({ ...e, _id: e._id as string }))} empty={t("empty.default")} cols={[
          { head: t("date"), cell: (e) => <DateText ms={e.at} /> },
          { head: t("status"), cell: (e) => <Badge tone={tone(e.status)}>{e.status === "ready" ? t("set.dataReady") : e.status === "failed" ? t("set.dataFailed") : t("set.dataBuilding")}</Badge> },
          { head: "", cell: (e) => e.status === "ready" ? <button className="btn sm" onClick={() => download(e._id as Id<"dataExports">)}>{t("set.dataDownload")}</button> : null },
        ]} />
      </Card>
      <Card title={t("set.supportTitle")}>
        <p className="muted">{t("set.supportHint")}</p>
        <Table rows={access?.map((s) => ({ ...s, _id: s._id as string }))} empty={t("set.noSupport")} cols={[
          { head: t("date"), cell: (s) => <DateText ms={s.startedAt} /> },
          { head: t("plat.by"), cell: (s) => s.by },
          { head: t("plat.reason"), cell: (s) => s.reason },
          { head: t("plat.ended"), cell: (s) => <DateText ms={s.endedAt ?? s.expiresAt} /> },
        ]} />
      </Card>
    </div>
  );
}

/** The company's own SMS gateway. The key is never shown again after saving. */
export function GatewayCard() {
  const { t } = useI18n(); const { can } = useMe(); const gw = useQuery(api.smsQueue.gateway);
  const save = useMutation(api.smsQueue.saveGateway); const remove = useMutation(api.smsQueue.removeGateway); const { run, error, busy } = useRun();
  const [f, setF] = useState<{ url: string; key: string; sender: string } | null>(null); const [secret, setSecret] = useState<{ s: string; p: string } | null>(null);
  useEffect(() => { if (gw && !f) setF({ url: gw.apiUrl, key: "", sender: gw.source === "own" ? gw.sender : "" }); }, [gw, f]);
  if (!gw || !f) return <Card><Skeleton lines={3} /></Card>;
  const edit = can("approver");
  const site = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site");
  return (
    <Card title={t("set.gatewayTitle")}>
      <form noValidate className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => save({ apiUrl: f.url, apiKey: f.key || undefined, sender: f.sender }), t("saved"));
        if (r) { setF({ ...f, key: "" }); if (r.webhookSecret) setSecret({ s: r.webhookSecret, p: `${site}${r.webhookPath}` }); }
      }}>
        <p className="muted">{t("set.gatewayHint")}</p>
        <p className="muted">{gw.source === "own" ? t("set.gatewayOwn") : gw.source === "platform" ? t("set.gatewayPlatform") : t("set.gatewayNone")}</p>
        <div className="form">
          <div className="wide"><Field label={t("set.gatewayUrl")}><input type="url" value={f.url} disabled={!edit} placeholder="https://" onChange={(e) => setF({ ...f, url: e.target.value })} /></Field></div>
          <Field label={t("set.gatewayKey")} hint={gw.source === "own" ? t("set.gatewayKeyKeep") : undefined}><input type="password" autoComplete="off" value={f.key} disabled={!edit} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
          <Field label={t("set.gatewaySender")}><input value={f.sender} maxLength={20} disabled={!edit} onChange={(e) => setF({ ...f, sender: e.target.value })} /></Field>
        </div>
        <Message error={error} />
        {secret && <div className="msg info" role="status"><div className="stack"><span>{t("set.gatewayWebhook")}</span><code>{secret.p}</code><span>{t("set.gatewaySecret")}: <code>{secret.s}</code></span></div></div>}
        {edit && <div className="row"><button className="btn primary" disabled={busy}>{t("set.gatewaySave")}</button>{gw.source === "own" && <button type="button" className="btn" disabled={busy} onClick={async () => { if ((await run(() => remove(), t("saved"))) !== undefined) { setSecret(null); setF(null); } }}>{t("set.gatewayRemove")}</button>}</div>}
      </form>
    </Card>
  );
}
