"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { api } from "../../../../convex/_generated/api";
import { Badge, Card, DateText, Kpi, Message, PageHeader, SearchInput, StatusBadge, Table } from "@/components/ui";
import { smsSegments } from "@/lib/sms";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function Messages() {
  const { t } = useI18n(); const { can } = useMe();
  const all = useQuery(api.smsQueue.list, {});
  const [q, setQ] = useState(""); const [status, setStatus] = useState("");
  const needle = q.trim().toLowerCase();
  const statuses = [...new Set(all?.map((m) => m.status as string))].sort();
  const rows = all?.filter((m) => (!status || m.status === status) && (!needle || `${m.renterName} ${m.body}`.toLowerCase().includes(needle))); const retry = useMutation(api.smsQueue.retry); const { run, error } = useRun();
  const bad = (all ?? []).filter((m) => m.status === "failed" || m.status === "uncertain");
  const count = (...s: string[]) => (all ?? []).filter((m) => s.includes(m.status)).length;
  const segs = (all ?? []).filter((m) => m.status !== "cancelled").reduce((n, m) => n + smsSegments(m.body).segments, 0);
  return (
    <div className="stack">
      <PageHeader title={t("nav.messages")} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchMessages")} /><FilterSelect label={t("status")} placeholder={t("status")} value={status} onChange={setStatus} options={[{ value: "", label: t("filter.allStatuses"), icon: <MessageSquare size={16} /> }, ...statuses.map((s) => ({ value: s, label: t(s), icon: <MessageSquare size={16} /> }))]} /></>}
        actions={can("financeOfficer") && bad.length > 0 ? <button className="btn" onClick={() => void run(async () => { for (const m of bad.slice(0, 50)) await retry({ id: m._id }); })}>{t("sms.retryAll")} ({bad.length})</button> : undefined} />
      <Message error={error} />
      <div className="kpis kpis-4">
        <Kpi icon="messages" tone="info" label={t("sms.kpi.queued")} value={all ? count("queued", "sending") : "–"} sub={t("sms.kpi.queuedSub")} />
        <Kpi icon="check" tone="good" label={t("sms.kpi.delivered")} value={all ? count("delivered", "accepted") : "–"} />
        <Kpi icon="alert" tone={bad.length ? "bad" : "good"} label={t("sms.kpi.attention")} value={all ? bad.length : "–"} sub={bad.length ? t("sms.kpi.attentionSub") : undefined} />
        <Kpi icon="bills" label={t("sms.kpi.segments")} value={all ? segs : "–"} sub={t("sms.kpi.segmentsSub")} />
      </div>
      <Card flush><Table rows={rows} empty={t("empty.messages")} cols={[
        { head: t("date"), cell: (m) => <DateText ms={m._creationTime} />, sort: (m) => m._creationTime },
        { head: t("ag.renter"), cell: (m) => m.renterName, sort: (m) => m.renterName },
        { head: t("sms.type"), cell: (m) => <Badge tone={m.kind === "paymentAck" ? "good" : m.kind === "expiryWarning" ? "warn" : "info"}>{t(`sms.kind.${m.kind}`)}</Badge>, sort: (m) => m.kind },
        { head: "SMS", cell: (m) => m.body, text: true },
        { head: t("sms.segments"), cell: (m) => { const s = smsSegments(m.body); return <span className="num" title={s.unicode ? t("sms.unicodeHint") : undefined}>{s.segments}{s.unicode ? " ᵁ" : ""}</span>; }, right: true },
        { head: t("status"), cell: (m) => <StatusBadge status={m.status} /> },
        { head: "", cell: (m) => (m.status === "failed" || m.status === "uncertain") && can("financeOfficer") ? <button className="btn sm" onClick={() => void run(() => retry({ id: m._id }))}>{t("sms.retry")}</button> : null }]} /></Card>
    </div>
  );
}
