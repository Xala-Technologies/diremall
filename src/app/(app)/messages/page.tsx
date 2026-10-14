"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { api } from "../../../../convex/_generated/api";
import { Card, DateText, Message, PageHeader, SearchInput, StatusBadge, Table } from "@/components/ui";
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
  return (
    <div className="stack">
      <PageHeader title={t("nav.messages")} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchMessages")} /><FilterSelect label={t("status")} placeholder={t("status")} value={status} onChange={setStatus} options={[{ value: "", label: t("filter.allStatuses"), icon: <MessageSquare size={16} /> }, ...statuses.map((s) => ({ value: s, label: t(s), icon: <MessageSquare size={16} /> }))]} /></>} /><Message error={error} />
      <Card flush><Table rows={rows} empty={t("empty.messages")} cols={[
        { head: t("date"), cell: (m) => <DateText ms={m._creationTime} /> }, { head: t("ag.renter"), cell: (m) => m.renterName }, { head: "SMS", cell: (m) => m.body, text: true },
        { head: t("status"), cell: (m) => <StatusBadge status={m.status} /> },
        { head: "", cell: (m) => (m.status === "failed" || m.status === "uncertain") && can("financeOfficer") ? <button className="btn sm" onClick={() => void run(() => retry({ id: m._id }))}>{t("sms.retry")}</button> : null }]} /></Card>
    </div>
  );
}
