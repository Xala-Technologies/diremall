"use client";
import { useQuery } from "convex/react";
import { useState } from "react";
import { ListFilter } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { api } from "../../../../convex/_generated/api";
import { Card, DateText, PageHeader, SearchInput, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function Audit() {
  const { t } = useI18n(); const all = useQuery(api.audit.recent, { limit: 200 });
  const [q, setQ] = useState(""); const [action, setAction] = useState("");
  const needle = q.trim().toLowerCase();
  const actions = [...new Set(all?.map((r) => r.action))].sort();
  const rows = all?.filter((r) => (!action || r.action === action) && (!needle || `${r.actorName} ${r.action} ${r.entity} ${r.detail ?? ""}`.toLowerCase().includes(needle)));
  return (
    <div className="stack"><PageHeader title={t("nav.audit")} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchAudit")} /><FilterSelect label="Action" placeholder="Action" value={action} onChange={setAction} options={[{ value: "", label: t("filter.allActions"), icon: <ListFilter size={16} /> }, ...actions.map((a) => ({ value: a, label: a, icon: <ListFilter size={16} /> }))]} /></>} />
      <Card flush><Table rows={rows} cols={[
        { head: t("date"), cell: (r) => <DateText ms={r._creationTime} /> }, { head: t("name"), cell: (r) => r.actorName }, { head: "Action", cell: (r) => r.action },
        { head: "Record", cell: (r) => `${r.entity} ${r.entityId.slice(-6)}` }, { head: t("notes"), cell: (r) => <span className="muted">{r.detail}</span>, text: true }]} /></Card></div>
  );
}
