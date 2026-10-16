"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { ListFilter } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { api } from "../../../../convex/_generated/api";
import { Card, DateText, SearchInput, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/** The record of who did what and when: every change to money, leases, access and settings. Read only. */
export function History() {
  const { t } = useI18n(); const all = useQuery(api.audit.recent, { limit: 200 });
  const [q, setQ] = useState(""); const [action, setAction] = useState("");
  const needle = q.trim().toLowerCase();
  const actions = [...new Set(all?.map((r) => r.action))].sort();
  const rows = all?.filter((r) => (!action || r.action === action) && (!needle || `${r.actorName} ${r.action} ${r.entity} ${r.detail ?? ""}`.toLowerCase().includes(needle)));
  return (
    <div className="stack">
      <p className="muted">{t("set.historyHint")}</p>
      <div className="tab-row"><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchAudit")} /><FilterSelect label="Action" placeholder="Action" value={action} onChange={setAction} options={[{ value: "", label: t("filter.allActions"), icon: <ListFilter size={16} /> }, ...actions.map((a) => ({ value: a, label: a, icon: <ListFilter size={16} /> }))]} /></div>
      <Card flush><Table rows={rows} cols={[
        { head: t("date"), cell: (r) => <DateText ms={r._creationTime} /> }, { head: t("name"), cell: (r) => r.actorName }, { head: "Action", cell: (r) => r.action },
        { head: "Record", cell: (r) => `${r.entity} ${r.entityId.slice(-6)}` }, { head: t("notes"), cell: (r) => <span className="muted">{r.detail}</span>, text: true }]} /></Card>
    </div>
  );
}
