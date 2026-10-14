"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, DateText, Message, PageHeader, StatusBadge, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function Messages() {
  const { t } = useI18n(); const { can } = useMe();
  const rows = useQuery(api.smsQueue.list, {}); const retry = useMutation(api.smsQueue.retry); const { run, error } = useRun();
  return (
    <div className="stack">
      <PageHeader title={t("nav.messages")} /><Message error={error} />
      <Card><Table rows={rows} cols={[
        { head: t("date"), cell: (m) => <DateText ms={m._creationTime} /> }, { head: t("ag.renter"), cell: (m) => m.renterName }, { head: "SMS", cell: (m) => m.body },
        { head: t("status"), cell: (m) => <StatusBadge status={m.status} /> },
        { head: "", cell: (m) => (m.status === "failed" || m.status === "uncertain") && can("financeOfficer") ? <button className="btn sm" onClick={() => void run(() => retry({ id: m._id }))}>{t("sms.retry")}</button> : null }]} /></Card>
    </div>
  );
}
