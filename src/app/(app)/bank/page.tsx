"use client";
import { useMutation, useQuery } from "convex/react";
import { Landmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FilterSelect } from "@/components/FilterSelect";
import { Card, DateText, Empty, Field, Kpi, Message, Modal, Money, PageHeader, ReasonDialog, SearchInput, Skeleton, StatusBadge, Table, Tabs } from "@/components/ui";
import { formatEtb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { readTable } from "@/lib/importFile";
import { parseStatement, type StatementRead } from "@/lib/statement";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

type Tab = "toMatch" | "matched" | "ignored" | "all";
const BANKS = ["Commercial Bank of Ethiopia", "Awash Bank", "Dashen Bank", "Bank of Abyssinia", "Telebirr", "CBE Birr", "Other"];

export default function Bank() {
  const { t } = useI18n(); const { can } = useMe(); const router = useRouter();
  const batches = useQuery(api.bank.batches);
  const [batch, setBatch] = useState(""); const [tab, setTab] = useState<Tab>("toMatch"); const [q, setQ] = useState("");
  const data = useQuery(api.bank.statement, { batch: batch || undefined });
  const reopen = useMutation(api.bank.reopen); const ignore = useMutation(api.bank.ignore);
  const { run, error } = useRun();
  const [importing, setImporting] = useState(false); const [matching, setMatching] = useState<Id<"bankStatementEntries"> | null>(null); const [ignoring, setIgnoring] = useState<Id<"bankStatementEntries"> | null>(null);

  const totals = data?.totals; const all = (totals?.toMatch.n ?? 0) + (totals?.matched.n ?? 0) + (totals?.ignored.n ?? 0);
  const needle = q.trim().toLowerCase();
  const rows = data?.lines.filter((l) => (tab === "all" || l.state === tab) && (!needle || `${l.reference} ${l.description ?? ""} ${l.payment?.renterName ?? ""} ${l.amount / 100}`.toLowerCase().includes(needle)));
  const matchingLine = data?.lines.find((l) => l._id === matching);

  return (
    <div className="stack">
      <PageHeader title={t("nav.bank")}
        filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchBank")} />
          {batches && batches.length > 0 && <FilterSelect label={t("bank.statement")} value={batch} onChange={setBatch} options={[{ value: "", label: t("bank.allStatements"), icon: <Landmark size={16} /> }, ...batches.map((b) => ({ value: b.batch, label: `${b.batch} (${b.toMatch}/${b.lines})`, icon: <Landmark size={16} /> }))]} />}</>}
        actions={can("financeOfficer") ? <button className="btn primary" onClick={() => setImporting(true)}>{t("bank.import")}</button> : undefined} />
      <p className="muted bank-note">{t("bank.note")}</p>
      <Message error={error} />

      {!data ? <Card><Skeleton lines={4} /></Card> : all === 0 ? (
        <Card><Empty title={t("empty.bank")} hint={t("bank.emptyHint")} action={can("financeOfficer") ? <button className="btn primary" onClick={() => setImporting(true)}>{t("bank.import")}</button> : undefined} /></Card>
      ) : (<>
        <div className="kpis kpis-4">
          <Kpi icon="alert" tone={totals!.toMatch.n ? "warn" : "good"} label={t("bank.kpi.toMatch")} value={<>{totals!.toMatch.n} <small className="muted-sm">{t("bank.lines")}</small></>} sub={<Money v={totals!.toMatch.amount} />} />
          <Kpi icon="check" tone="good" label={t("bank.kpi.matched")} value={<>{totals!.matched.n} <small className="muted-sm">{t("bank.lines")}</small></>} sub={<Money v={totals!.matched.amount} />} />
          <Kpi icon="inbox" tone="info" label={t("bank.kpi.ignored")} value={<>{totals!.ignored.n} <small className="muted-sm">{t("bank.lines")}</small></>} sub={<Money v={totals!.ignored.amount} />} />
          <Kpi icon="bank" label={t("bank.kpi.total")} value={<>{all} <small className="muted-sm">{t("bank.lines")}</small></>} sub={<Money v={totals!.toMatch.amount + totals!.matched.amount + totals!.ignored.amount} />} />
        </div>
        <div className="tab-row"><Tabs value={tab} onChange={(v) => setTab(v as Tab)} tabs={[["toMatch", `${t("bank.tab.toMatch")} (${totals!.toMatch.n})`], ["matched", `${t("bank.tab.matched")} (${totals!.matched.n})`], ["ignored", `${t("bank.tab.ignored")} (${totals!.ignored.n})`], ["all", `${t("all")} (${all})`]]} /></div>
        {data.capped && <p className="muted">{t("bank.capped")}</p>}
        <Card flush>
          <Table rows={rows} empty={tab === "toMatch" && !needle ? t("bank.empty.toMatch") : t("filter.noMatch2")} cols={[
            { head: t("date"), cell: (l) => <DateText ms={l.postedAt} />, sort: (l) => l.postedAt },
            { head: t("bank.col.narration"), cell: (l) => <div className="two-line"><span>{l.description || l.reference || "—"}</span>{l.description && l.reference && <small className="muted">{l.reference}</small>}</div>, text: true },
            { head: t("amount"), cell: (l) => <Money v={l.amount} strong />, right: true, money: true, sort: (l) => l.amount },
            { head: t("status"), cell: (l) => l.state === "matched" && l.payment ? (
              <div className="two-line"><StatusBadge status="matched" /><small className="muted">{l.payment.renterName} · {l.payment.reference}</small></div>
            ) : l.state === "ignored" ? (
              <div className="two-line"><StatusBadge status="ignored" /><small className="muted">{l.ignoreReason}</small></div>
            ) : l.state === "matched" ? <StatusBadge status="matched" /> : <StatusBadge status="toMatch" />, text: true },
            { head: "", cell: (l) => <div className="row">
              {l.state === "toMatch" && can("financeOfficer") && <><button className="btn sm primary" onClick={() => setMatching(l._id)}>{t("bank.match")}</button><button className="btn sm" onClick={() => router.push(`/payments?new=1&amount=${l.amount}&ref=${encodeURIComponent(l.reference)}&at=${l.postedAt}&narr=${encodeURIComponent(l.description ?? l.reference)}&line=${l._id}`)}>{t("bank.record")}</button><button className="btn sm" onClick={() => setIgnoring(l._id)}>{t("bank.ignore")}</button></>}
              {l.state === "matched" && l.payment?.status === "applied" && <button className="btn sm" onClick={() => router.push(`/payments/${l.payment!.paymentId}`)}>{t("pay.receipt")}</button>}
              {l.state === "matched" && can("approver") && <button className="btn sm" onClick={() => void run(() => reopen({ entryId: l._id }), t("saved"))}>{t("bank.reopen")}</button>}
              {l.state === "ignored" && can("financeOfficer") && <button className="btn sm" onClick={() => void run(() => reopen({ entryId: l._id }), t("saved"))}>{t("bank.reopen")}</button>}
            </div> },
          ]} />
        </Card>
      </>)}

      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(name) => { setBatch(name); setTab("toMatch"); }} />}
      {matching && matchingLine && <MatchDialog line={matchingLine} onClose={() => setMatching(null)} />}
      {ignoring && <ReasonDialog title={t("bank.ignore.title")} onClose={() => setIgnoring(null)} onSave={(reason) => run(() => ignore({ entryId: ignoring, reason }), t("saved"))} />}
    </div>
  );
}

/** Choose a file, check how it was read, then save. Nothing is stored until Import is pressed. */
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (batch: string) => void }) {
  const { t } = useI18n(); const imp = useMutation(api.bank.importStatement); const { run, error, busy } = useRun();
  const [read, setRead] = useState<StatementRead | null>(null); const [name, setName] = useState(""); const [bank, setBank] = useState(BANKS[0]!); const [fileErr, setFileErr] = useState<string | null>(null);
  const lines = read?.lines ?? [];
  return (
    <Modal title={t("bank.import.title")} onClose={onClose}>
      <div className="stack">
        <label className="btn"><span>{t("bank.import.choose")}</span><input type="file" hidden accept=".csv,.xlsx,text/csv" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
          setFileErr(null);
          try { const r = parseStatement(await readTable(f)); setRead(r); setName(`${f.name.replace(/\.[^.]+$/, "")}-${new Date().toISOString().slice(0, 10)}`); if (r.lines.length === 0) setFileErr(t("bank.import.none")); }
          catch { setRead(null); setFileErr(t("bank.import.unreadable")); }
        }} /></label>
        <Message error={fileErr} />
        {read && lines.length > 0 && <>
          <div className="import-summary">
            <div><b>{lines.length}</b><span>{t("bank.import.deposits")}</span></div>
            <div><b>{formatEtb(read.totalCredits)}</b><span>{t("total")}</span></div>
            {read.debits > 0 && <div><b>{read.debits}</b><span>{t("bank.import.debits")}</span></div>}
            {read.problems.length > 0 && <div className="bad"><b>{read.problems.length}</b><span>{t("bank.import.problems")}</span></div>}
          </div>
          {read.problems.length > 0 && <Message error={`${t("bank.import.rows")}: ${read.problems.slice(0, 8).map((p) => p.row).join(", ")}${read.problems.length > 8 ? "…" : ""}`} />}
          <p className="muted">{t("bank.import.dateNote")}</p>
          <div className="table-wrap" style={{ maxHeight: 220 }}><table><thead><tr><th>{t("date")}</th><th>{t("bank.col.narration")}</th><th className="r">{t("amount")}</th></tr></thead>
            <tbody>{lines.slice(0, 8).map((l) => <tr key={l.row}><td><DateText ms={l.postedAt} /></td><td className="txt">{l.description || l.reference}<br /><small className="muted">{l.description ? l.reference : ""}</small></td><td className="r"><Money v={l.amount} /></td></tr>)}</tbody></table></div>
          {lines.length > 8 && <p className="muted">{t("bank.import.more").replace("{n}", String(lines.length - 8))}</p>}
          <div className="form">
            <Field label={t("bank.import.bank")}><select value={bank} onChange={(e) => setBank(e.target.value)}>{BANKS.map((b) => <option key={b}>{b}</option>)}</select></Field>
            <Field label={t("bank.import.name")}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          <Message error={error} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
            <button className="btn primary" disabled={busy || !name.trim()} onClick={async () => {
              const r = await run(() => imp({ batch: name.trim(), bank, entries: lines.map((l) => ({ postedAt: l.postedAt, amount: l.amount, reference: l.reference, description: l.description || undefined })) }));
              if (r) { onDone(name.trim()); onClose(); }
            }}>{t("bank.import.go").replace("{n}", String(lines.length))}</button>
          </div>
        </>}
      </div>
    </Modal>
  );
}

/** Pick the payment this deposit belongs to. Only an equal amount can be linked; others are shown so the difference is clear. */
function MatchDialog({ line, onClose }: { line: { _id: Id<"bankStatementEntries">; postedAt: number; amount: number; reference: string; description?: string }; onClose: () => void }) {
  const { t } = useI18n(); const match = useMutation(api.bank.confirmMatch); const { run, error } = useRun();
  const [q, setQ] = useState("");
  const cands = useQuery(api.bank.candidates, { entryId: line._id, q: q.trim() || undefined });
  return (
    <Modal title={t("bank.match.title")} onClose={onClose}>
      <div className="stack">
        <div className="match-line"><DateText ms={line.postedAt} /><Money v={line.amount} strong /><span className="muted">{line.description || line.reference}{line.description && line.reference ? ` · ${line.reference}` : ""}</span></div>
        <SearchInput value={q} onChange={setQ} placeholder={t("bank.match.search")} />
        <Message error={error} />
        {!cands ? <Skeleton lines={3} /> : cands.length === 0 ? <Empty title={t("bank.match.none")} /> : (
          <ul className="cand-list">
            {cands.map((c) => {
              const exact = c.difference === 0;
              return (
                <li key={c.paymentId} className={exact && !c.taken ? "exact" : ""}>
                  <div className="cand-main"><strong>{c.renterName}</strong><span className="muted">{c.reference} · <DateText ms={c.receivedAt} /></span></div>
                  <div className="cand-amt"><Money v={c.amount} />{c.referenceMatches && <span className="tag">{t("bank.match.refMatch")}</span>}</div>
                  <StatusBadge status={c.status} />
                  {c.taken ? <span className="muted cand-note">{t("bank.match.taken")}</span>
                    : !exact ? <span className="muted cand-note">{t("bank.diff")}: {formatEtb(Math.abs(c.difference))}</span>
                    : <button className="btn sm primary" onClick={async () => { if ((await run(() => match({ entryId: line._id, paymentId: c.paymentId }), t("saved"))) !== undefined) onClose(); }}>{t("bank.confirm")}</button>}
                </li>);
            })}
          </ul>)}
        <p className="muted">{t("bank.match.footer")}</p>
      </div>
    </Modal>
  );
}
