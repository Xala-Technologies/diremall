"use client";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, BuildingSelect, Card, ConfirmDialog, DateText, Kpi, Message, Money, PageHeader, PeriodPicker, SearchInput, StatusBadge, Table, TableFoot, Tabs } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/icons";
import { downloadCsv } from "@/lib/csv";
import { usePeriod } from "@/lib/usePeriod";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";
import { formatEtb } from "@/lib/format";

export default function Billing() {
  const { t } = useI18n(); const { can } = useMe(); const router = useRouter();
  const [period, setPeriod] = usePeriod(); const [building, setBuilding] = useState("");
  const [picked, setPicked] = useState<Set<Id<"invoices">>>(new Set()); const [confirmIssue, setConfirmIssue] = useState<Id<"invoices">[] | null>(null);
  const buildings = useQuery(api.properties.listBuildings);
  const rows = useQuery(api.billing.list, { period });
  const generate = useMutation(api.billing.generate); const issue = useMutation(api.billing.issue);
  const { run, error, notice } = useRun(); const toast = useToast();
  const [tab, setTab] = useState(""); const [q, setQ] = useState("");
  const remind = useMutation(api.billing.sendReminders); const [confirmRemind, setConfirmRemind] = useState<Id<"invoices">[] | null>(null);
  const inBuilding = rows?.filter((r) => !building || r.buildingId === building);
  // overdue = issued, still owing, due date before today (the due date itself is not late)
  const startOfToday = (() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); })();
  type Row = NonNullable<typeof rows>[number];
  const daysLate = (r: Row) => (r.status === "issued" && r.due > 0 && r.dueAt < startOfToday ? Math.floor((startOfToday - r.dueAt) / 86400000) : 0);
  const stateOf = (r: Row) => (daysLate(r) > 0 ? "overdue" : r.payStatus);
  const count = (s: string) => (inBuilding ?? []).filter((r) => (s === "" ? true : s === "overdue" ? daysLate(r) > 0 : r.payStatus === s)).length;
  const issued = (inBuilding ?? []).filter((r) => r.status === "issued");
  const kpi = { billed: issued.reduce((s, r) => s + r.total + r.adjustments, 0), collected: issued.reduce((s, r) => s + r.paid + r.creditUsed, 0), outstanding: issued.reduce((s, r) => s + r.due, 0), overdue: issued.filter((r) => daysLate(r) > 0).reduce((s, r) => s + r.due, 0), overdueN: issued.filter((r) => daysLate(r) > 0).length };
  const needle = q.trim().toLowerCase();
  const shown = inBuilding?.filter((r) => (tab === "" || (tab === "overdue" ? daysLate(r) > 0 : r.payStatus === tab)) && (!needle || `${r.unitNumber} ${r.renterName} ${r.number}`.toLowerCase().includes(needle)));
  const drafts = (inBuilding ?? []).filter((r) => r.status === "draft");
  const totals = (shown ?? []).reduce((a, r) => ({ total: a.total + r.total + r.adjustments, paid: a.paid + r.paid + r.creditUsed, due: a.due + (r.status === "issued" ? r.due : 0) }), { total: 0, paid: 0, due: 0 });
  const toggle = (id: Id<"invoices">) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="stack">
      <PageHeader title={t("nav.billing")}
        filters={<>
          <SearchInput value={q} onChange={setQ} placeholder={t("filter.searchBills")} />
          <BuildingSelect buildings={buildings} value={building} onChange={setBuilding} />
          <PeriodPicker value={period} onChange={(p) => { setPeriod(p); setPicked(new Set()); }} />
        </>}
        actions={<>
          {can("financeOfficer") && <>
          <button className="btn primary" onClick={async () => { const r = await run(async () => {
              // large malls are billed in batches; keep going until the server says it is done
              let created = 0; const skipped: { agreementId: string; reason: string }[] = [];
              for (let i = 0; i < 40; i++) { const part = await generate({ period, buildingId: (building || undefined) as Id<"buildings"> | undefined }); created += part.created; skipped.push(...part.skipped); if (part.done) break; }
              return { created, skipped };
            }); if (r) setPicked(new Set()); r && toast(`${r.created} ${t("bill.created")}${r.skipped.length ? `, ${r.skipped.length} ${t("bill.skipped")} (${r.skipped.map((s) => s.reason).join(", ")})` : ""}`); }}>{t("bill.generate")}</button>
          {picked.size > 0 && <button className="btn primary" onClick={() => setConfirmIssue([...picked])}>{t("bill.issue")} ({picked.size})</button>}
          <button className="btn" disabled={drafts.length === 0} onClick={() => setConfirmIssue(drafts.map((d) => d._id))}>{t("bill.issueAll")}{drafts.length > 0 ? ` (${drafts.length})` : ""}</button>
          </>}
          {can("financeOfficer") && kpi.overdueN > 0 && <button className="btn" onClick={() => setConfirmRemind(issued.filter((r) => daysLate(r) > 0).map((r) => r._id))}>{t("bill.remindOverdue")} ({kpi.overdueN})</button>}
          <button className="btn" onClick={() => shown && downloadCsv(`bills-${period}.csv`, shown.map((r) => ({ number: r.number, unit: r.unitNumber, renter: r.renterName, status: r.status, total: (r.total + r.adjustments) / 100, paid: (r.paid + r.creditUsed) / 100, due: r.due / 100 })))}>{t("export")}</button>

        </>} />
      <Message error={error} notice={notice} />
      <div className="kpis kpis-4">
        <Kpi icon="bills" tone="info" label={t("bill.kpi.billed")} value={rows ? formatEtb(kpi.billed) : "–"} sub={`${issued.length} ${t("bill.issuedBills")}`} />
        <Kpi icon="check" tone="good" label={t("bill.kpi.collected")} value={rows ? formatEtb(kpi.collected) : "–"} sub={rows && kpi.billed > 0 ? `${Math.round((kpi.collected / kpi.billed) * 100)}% ${t("bill.ofBilled")}` : undefined} />
        <Kpi icon="alert" tone={kpi.outstanding ? "warn" : "good"} label={t("bill.kpi.outstanding")} value={rows ? formatEtb(kpi.outstanding) : "–"} sub={rows ? `${issued.filter((r) => r.due > 0).length} ${t("bill.openBills")}` : undefined} />
        <Kpi icon="history" tone={kpi.overdueN ? "bad" : "good"} label={t("bill.kpi.overdue")} value={rows ? formatEtb(kpi.overdue) : "–"} sub={rows ? `${kpi.overdueN} ${t("bill.pastDue")}` : undefined} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[["", `${t("all")} (${count("")})`], ["draft", `${t("draft")} (${count("draft")})`], ["outstanding", `${t("outstanding")} (${count("outstanding")})`], ["overdue", `${t("overdue")} (${count("overdue")})`], ["partial", `${t("partial")} (${count("partial")})`], ["paid", `${t("paidFull")} (${count("paid")})`]]} />
      {confirmRemind && <ConfirmDialog title={t("bill.remind")} message={t("bill.remindBody").replace("{n}", String(confirmRemind.length))} confirmLabel={t("bill.remindSend")} onClose={() => setConfirmRemind(null)} onConfirm={async () => {
        const r = await run(() => remind({ invoiceIds: confirmRemind }));
        if (r) toast(`${r.sent} ${t("bill.remindersQueued")}${r.skipped.length ? `, ${r.skipped.length} ${t("bill.skipped")}` : ""}`);
      }} />}
      {confirmIssue && <ConfirmDialog title={t("confirm.issueTitle")} message={t("confirm.issueBody").replace("{n}", String(confirmIssue.length))} confirmLabel={t("bill.issueN")} onClose={() => setConfirmIssue(null)} onConfirm={async () => { await run(async () => { for (let i = 0; i < confirmIssue.length; i += 150) await issue({ invoiceIds: confirmIssue.slice(i, i + 150) }); setPicked(new Set()); }, t("saved")); }} />}
      <Card flush>
        <Table rows={shown} empty={t("empty.bills")} onRow={(r) => router.push(`/billing/${r._id}`)} cols={[
          ...(can("financeOfficer") ? [{ head: "", cell: (r: NonNullable<typeof shown>[number]) => r.status === "draft" ? <input type="checkbox" aria-label={r.unitNumber} checked={picked.has(r._id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r._id)} /> : null }] : []),
          { head: t("bill.number"), cell: (r) => r.number || t("draft") }, { head: t("ag.unit"), cell: (r) => <strong>{r.unitNumber}</strong>, sort: (r) => r.unitNumber }, { head: t("ag.renter"), cell: (r) => r.renterName, sort: (r) => r.renterName },
          { head: t("bill.dueDate"), cell: (r) => <DateText ms={r.dueAt} />, sort: (r) => r.dueAt }, { head: t("total"), cell: (r) => <Money v={r.total + r.adjustments} />, right: true, money: true, sort: (r) => r.total + r.adjustments },
          { head: t("bill.paid"), cell: (r) => <Money v={r.paid + r.creditUsed} />, right: true, money: true, hide: true }, { head: t("bill.due"), cell: (r) => r.status === "issued" ? <Money v={r.due} strong /> : "—", right: true, money: true, sort: (r) => (r.status === "issued" ? r.due : -1) },
          { head: t("status"), cell: (r) => daysLate(r) > 0 ? <Badge tone="bad">{t("overdue")} · {daysLate(r)} {t("bill.days")}</Badge> : <StatusBadge status={r.payStatus} />, sort: (r) => daysLate(r) },
          ...(can("financeOfficer") ? [{ head: "", cell: (r: Row) => r.status === "issued" && r.due > 0 ? (
            <div className="row" onClick={(e) => e.stopPropagation()}>
              <button className="btn sm icon-only" title={t("bill.recordPayment")} aria-label={`${t("bill.recordPayment")} ${r.number}`} onClick={() => router.push(`/payments?new=1&renter=${r.renterId}&amount=${r.due}&narr=${encodeURIComponent(r.number)}`)}><Icon name="payments" size={17} /></button>
              <button className="btn sm icon-only" title={t("bill.remind")} aria-label={`${t("bill.remind")} ${r.number}`} onClick={() => setConfirmRemind([r._id])}><Icon name="bell" size={17} /></button>
            </div>) : null }] : []),
        ]} />
        {shown && shown.length > 0 && <TableFoot items={[[t("total"), <Money key="t" v={totals.total} strong />], [t("bill.paid"), <Money key="p" v={totals.paid} strong />], [t("bill.due"), <Money key="d" v={totals.due} strong />]]} />}
      </Card>
    </div>
  );
}
