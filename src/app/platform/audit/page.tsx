"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Badge, Card, DateText, PageHeader, SearchInput, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function PlatformAudit() {
  const { t } = useI18n(); const log = useQuery(api.platform.auditLog, { limit: 300 }); const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = log?.filter((l) => !needle || `${l.company} ${l.action} ${l.by} ${l.detail}`.toLowerCase().includes(needle));
  return (
    <div className="stack">
      <PageHeader title={t("plat.nav.audit")} sub={t("plat.auditSub")} filters={<SearchInput value={q} onChange={setQ} placeholder={t("plat.searchAudit")} />} />
      <Card flush><Table rows={rows?.map((l, i) => ({ ...l, _id: String(i) }))} cols={[
        { head: t("date"), cell: (l) => <DateText ms={l.at} /> }, { head: t("plat.company"), cell: (l) => l.company || "—" }, { head: t("plat.action"), cell: (l) => <Badge tone={l.action.startsWith("support") ? "warn" : "muted"}>{l.action}</Badge> },
        { head: t("plat.by"), cell: (l) => l.by }, { head: t("notes"), cell: (l) => <span className="muted">{l.detail}</span>, text: true }]} /></Card>
    </div>
  );
}
