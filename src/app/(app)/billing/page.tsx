"use client";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BuildingSelect, Card, ConfirmDialog, DateText, Message, Money, PageHeader, PeriodPicker, StatusBadge, Table, TableFoot, Tabs } from "@/components/ui";
import { useToast } from "@/components/toast";
import { downloadCsv } from "@/lib/csv";
import { usePeriod } from "@/lib/usePeriod";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function Billing() {
  const { t } = useI18n(); const { can } = useMe(); const router = useRouter();
  const [period, setPeriod] = usePeriod(); const [building, setBuilding] = useState("");
  const [picked, setPicked] = useState<Set<Id<"invoices">>>(new Set()); const [confirmIssue, setConfirmIssue] = useState<Id<"invoices">[] | null>(null);
  const buildings = useQuery(api.properties.listBuildings);
  const rows = useQuery(api.billing.list, { period });
  const generate = useMutation(api.billing.generate); const issue = useMutation(api.billing.issue);
  const { run, error, notice } = useRun(); const toast = useToast();
  const [tab, setTab] = useState(""); const [q, setQ] = useState("");
  const inBuilding = rows?.filter((r) => !building || r.buildingId === building);
  const count = (s: string) => (inBuilding ?? []).filter((r) => (s === "" ? true : r.payStatus === s)).length;
  const needle = q.trim().toLowerCase();
  const shown = inBuilding?.filter((r) => (tab === "" || r.payStatus === tab) && (!needle || `${r.unitNumber} ${r.renterName} ${r.number}`.toLowerCase().includes(needle)));
  const drafts = (inBuilding ?? []).filter((r) => r.status === "draft");
  const totals = (shown ?? []).reduce((a, r) => ({ total: a.total + r.total + r.adjustments, paid: a.paid + r.paid + r.creditUsed, due: a.due + (r.status === "issued" ? r.due : 0) }), { total: 0, paid: 0, due: 0 });
  const toggle = (id: Id<"invoices">) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="stack">
      <PageHeader title={t("nav.billing")}>
        <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
        <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPicked(new Set()); }} />
        {can("financeOfficer") && <>
          <button className="btn" onClick={async () => { const r = await run(async () => {
              // large malls are billed in batches; keep going until the server says it is done
              let created = 0; const skipped: { agreementId: string; reason: string }[] = [];
              for (let i = 0; i < 40; i++) { const part = await generate({ period, buildingId: (building || undefined) as Id<"buildings"> | undefined }); created += part.created; skipped.push(...part.skipped); if (part.done) break; }
              return { created, skipped };
            }); if (r) setPicked(new Set()); r && toast(`${r.created} ${t("bill.created")}${r.skipped.length ? `, ${r.skipped.length} ${t("bill.skipped")} (${r.skipped.map((s) => s.reason).join(", ")})` : ""}`); }}>{t("bill.generate")}</button>
          <button className="btn primary" disabled={picked.size === 0} onClick={() => setConfirmIssue([...picked])}>{t("bill.issue")} ({picked.size})</button>
          <button className="btn" disabled={drafts.length === 0} onClick={() => setConfirmIssue(drafts.map((d) => d._id))}>{t("bill.issueAll")}</button></>}
        <button className="btn" onClick={() => shown && downloadCsv(`bills-${period}.csv`, shown.map((r) => ({ number: r.number, unit: r.unitNumber, renter: r.renterName, status: r.status, total: (r.total + r.adjustments) / 100, paid: (r.paid + r.creditUsed) / 100, due: r.due / 100 })))}>{t("export")}</button>
      </PageHeader>
      <Message error={error} notice={notice} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Tabs value={tab} onChange={setTab} tabs={[["", `${t("all")} (${count("")})`], ["draft", `${t("draft")} (${count("draft")})`], ["outstanding", `${t("outstanding")} (${count("outstanding")})`], ["partial", `${t("partial")} (${count("partial")})`], ["paid", `${t("paidFull")} (${count("paid")})`]]} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} style={{ minWidth: 220 }} />
      </div>
      {confirmIssue && <ConfirmDialog title={t("confirm.issueTitle")} message={t("confirm.issueBody").replace("{n}", String(confirmIssue.length))} confirmLabel={t("bill.issueN")} onClose={() => setConfirmIssue(null)} onConfirm={async () => { await run(async () => { await issue({ invoiceIds: confirmIssue }); setPicked(new Set()); }, t("saved")); }} />}
      <Card flush>
        <Table rows={shown} empty={t("empty.bills")} onRow={(r) => router.push(`/billing/${r._id}`)} cols={[
          ...(can("financeOfficer") ? [{ head: "", cell: (r: NonNullable<typeof shown>[number]) => r.status === "draft" ? <input type="checkbox" aria-label={r.unitNumber} checked={picked.has(r._id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r._id)} /> : null }] : []),
          { head: t("bill.number"), cell: (r) => r.number || t("draft") }, { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName },
          { head: t("bill.dueDate"), cell: (r) => <DateText ms={r.dueAt} />, sort: (r) => r.dueAt }, { head: t("total"), cell: (r) => <Money v={r.total + r.adjustments} />, right: true, money: true, sort: (r) => r.total + r.adjustments },
          { head: t("bill.paid"), cell: (r) => <Money v={r.paid + r.creditUsed} />, right: true, money: true }, { head: t("bill.due"), cell: (r) => r.status === "issued" ? <Money v={r.due} strong /> : "—", right: true, money: true, sort: (r) => (r.status === "issued" ? r.due : -1) },
          { head: t("status"), cell: (r) => <StatusBadge status={r.payStatus} /> },
        ]} />
        {shown && shown.length > 0 && <TableFoot items={[[t("total"), <Money key="t" v={totals.total} strong />], [t("bill.paid"), <Money key="p" v={totals.paid} strong />], [t("bill.due"), <Money key="d" v={totals.due} strong />]]} />}
      </Card>
    </div>
  );
}
