"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Card, DateText, Message, Money, PageHeader, StatusBadge } from "@/components/ui";
import { parseStatementCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useRun } from "@/lib/useRun";

export default function Bank() {
  const { t } = useI18n(); const { can } = useMe();
  const unmatched = useQuery(api.bank.unmatched);
  const batches = [...new Set(unmatched?.map((e) => e.importBatch))];
  const [batch, setBatch] = useState("");
  const active = batch || batches[0] || "";
  const sugg = useQuery(api.bank.suggestions, active ? { batch: active } : "skip");
  const imp = useMutation(api.bank.importStatement); const match = useMutation(api.bank.confirmMatch);
  const { run, error, notice } = useRun();
  return (
    <div className="stack">
      <PageHeader title={t("nav.bank")}>
        {can("financeOfficer") && <label className="btn">{t("bank.import")}<input type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
          const entries = parseStatementCsv(await f.text());
          await run(() => imp({ batch: `${f.name}-${new Date().toISOString().slice(0, 10)}`, entries }), `${entries.length} ✓`);
        }} /></label>}
      </PageHeader>
      <p className="muted">{t("bank.note")} CSV: date, amount, reference.</p>
      <Message error={error} notice={notice} />
      {batches.length > 1 && <select value={active} onChange={(e) => setBatch(e.target.value)}>{batches.map((b) => <option key={b} value={b}>{b}</option>)}</select>}
      {sugg?.map(({ entry, candidates }) => (
        <Card key={entry._id}>
          <div className="row"><DateText ms={entry.postedAt} /><Money v={entry.amount} strong /><span className="muted">{entry.reference}</span></div>
          {candidates.length === 0 ? <p className="muted">—</p> : candidates.map((c) => (
            <div className="row" key={c.paymentId} style={{ marginTop: 8 }}>
              <span>{t("bank.suggest")}: <strong>{c.renterName}</strong> · {c.reference}</span><StatusBadge status={c.status} />
              <span className="muted">{t("bank.diff")}: <Money v={c.difference} /></span><span className="grow" />
              {can("financeOfficer") && <button className="btn sm primary" onClick={() => void run(() => match({ entryId: entry._id, paymentId: c.paymentId }), t("saved"))}>{t("bank.confirm")}</button>}
            </div>))}
        </Card>))}
    </div>
  );
}
