"use client";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, DateText, PageHeader, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function Audit() {
  const { t } = useI18n(); const rows = useQuery(api.audit.recent, { limit: 200 });
  return (
    <div className="stack"><PageHeader title={t("nav.audit")} />
      <Card><Table rows={rows} cols={[
        { head: t("date"), cell: (r) => <DateText ms={r._creationTime} /> }, { head: t("name"), cell: (r) => r.actorName }, { head: "Action", cell: (r) => r.action },
        { head: "Record", cell: (r) => `${r.entity} ${r.entityId.slice(-6)}` }, { head: t("notes"), cell: (r) => <span className="muted">{r.detail}</span> }]} /></Card></div>
  );
}
