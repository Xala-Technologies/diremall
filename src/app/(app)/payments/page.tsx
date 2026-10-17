"use client";
import { useMutation, useQuery } from "convex/react";
import { Banknote, ArrowLeftRight, CalendarRange, Landmark, Smartphone, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FilterSelect } from "@/components/FilterSelect";
import { Icon } from "@/components/icons";
import { Card, DateField, DateText, Field, Kpi, Message, Modal, Money, MoneyInput, PageHeader, ReasonDialog, SearchInput, StatusBadge, Table, Tabs , SelectField } from "@/components/ui";
import { formatEtb, periodText, currencyCode } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { useOpenFile } from "@/lib/useOpenFile";
import { useRun } from "@/lib/useRun";
import { useUpload } from "@/lib/useUpload";
import { FILE_ACCEPT, failures, fileProblem, positive, req } from "@/lib/validate";

type Status = "" | "recorded" | "confirmed" | "applied" | "voided";
type Method = "bankDeposit" | "transfer" | "telebirr" | "cbeBirr" | "cash";
const METHODS: Method[] = ["bankDeposit", "transfer", "telebirr", "cbeBirr", "cash"];
const today = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/** [from, to) in UTC for the period filter. */
function rangeOf(key: string): { from?: number; to?: number } {
  const n = new Date(); const y = n.getUTCFullYear(), m = n.getUTCMonth();
  if (key === "thisMonth") return { from: Date.UTC(y, m, 1), to: Date.UTC(y, m + 1, 1) };
  if (key === "lastMonth") return { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) };
  if (key === "last3") return { from: Date.UTC(y, m - 2, 1), to: Date.UTC(y, m + 1, 1) };
  if (key === "thisYear") return { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) };
  return {};
}
const METHOD_ICON = { bankDeposit: <Landmark size={16} />, transfer: <ArrowLeftRight size={16} />, telebirr: <Smartphone size={16} />, cbeBirr: <Smartphone size={16} />, cash: <Banknote size={16} /> } as const;

export default function Payments() {
  const { t } = useI18n(); const { can, me } = useMe();
  const [tab, setTab] = useState<Status>(""); const [q, setQ] = useState(""); const [method, setMethod] = useState(""); const [range, setRange] = useState("");
  const [adding, setAdding] = useState(false); const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [voiding, setVoiding] = useState<Id<"payments"> | null>(null); const [applying, setApplying] = useState<Id<"payments"> | null>(null); const [open, setOpen] = useState<Id<"payments"> | null>(null);
  const { from, to } = rangeOf(range);
  const all = useQuery(api.payments.list, { status: tab || undefined });
  const summary = useQuery(api.payments.summary, { from, to });
  const confirm = useMutation(api.payments.confirm); const voidP = useMutation(api.payments.voidPayment); const reverseP = useMutation(api.payments.reverse); const [reversing, setReversing] = useState<Id<"payments"> | null>(null);
  const { run, error, notice } = useRun();
  const needle = q.trim().toLowerCase();
  const rows = all?.filter((p) => (!method || p.method === method) && (from === undefined || (p.receivedAt >= from && p.receivedAt < to!)) && (!needle || `${p.renterName} ${p.reference} ${p.payerName ?? ""}`.toLowerCase().includes(needle)));

  // "Record payment" from a bank statement line arrives as /payments?new=1&amount=…&ref=…&at=…&narr=…&line=…
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("new")) {
      setPrefill({ amount: Number(sp.get("amount")) || null, reference: sp.get("ref") ?? "", at: Number(sp.get("at")) || null, narration: sp.get("narr") ?? "", lineId: (sp.get("line") ?? undefined) as Id<"bankStatementEntries"> | undefined, renterId: sp.get("renter") ?? undefined });
      setAdding(true); window.history.replaceState(null, "", "/payments");
    }
  }, []);

  const actions = (p: NonNullable<typeof all>[number]) => (
    <div className="row" onClick={(e) => e.stopPropagation()}>
      {p.status === "recorded" && can("approver") && <button className="btn sm primary" disabled={p.recordedBy === me?._id} title={p.recordedBy === me?._id ? t("err.same_person_cannot_approve") : ""} onClick={() => void run(() => confirm({ paymentId: p._id }), t("saved"))}>{t("pay.confirm")}</button>}
      {p.status === "confirmed" && can("financeOfficer") && <button className="btn sm primary" onClick={() => setApplying(p._id)}>{t("pay.apply")}</button>}
      {(p.status === "recorded" || p.status === "confirmed") && can("approver") && <button className="btn sm danger" onClick={() => setVoiding(p._id)}>{t("pay.void")}</button>}
      {p.status === "applied" && can("approver") && <button className="btn sm danger" onClick={() => setReversing(p._id)}>{t("pay.reverse")}</button>}
    </div>);

  return (
    <div className="stack">
      <PageHeader title={t("nav.payments")}
        filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchPayments")} />
          <FilterSelect label={t("period")} placeholder={t("period")} value={range} onChange={setRange} options={[["", "range.all"], ["thisMonth", "range.thisMonth"], ["lastMonth", "range.lastMonth"], ["last3", "range.last3"], ["thisYear", "range.thisYear"]].map(([v, k]) => ({ value: v!, label: t(k!), icon: <CalendarRange size={16} /> }))} />
          <FilterSelect label={t("pay.method")} placeholder={t("pay.method")} value={method} onChange={setMethod} options={[{ value: "", label: t("filter.allMethods"), icon: <Wallet size={16} /> }, ...METHODS.map((m) => ({ value: m as string, label: t(m), icon: METHOD_ICON[m] }))]} /></>}
        actions={can("financeOfficer") ? <button className="btn primary" onClick={() => { setPrefill(null); setAdding(true); }}>{t("pay.record")}</button> : undefined} />
      <Message error={error} notice={notice} />

      <div className="kpis kpis-4">
        <Kpi icon="alert" tone={summary?.recorded.n ? "warn" : "good"} label={t("pay.kpi.recorded")} value={<>{summary?.recorded.n ?? "–"} <small className="muted-sm">{t("pay.payments")}</small></>} sub={summary ? <Money v={summary.recorded.amount} /> : undefined} />
        <Kpi icon="check" tone="info" label={t("pay.kpi.confirmed")} value={<>{summary?.confirmed.n ?? "–"} <small className="muted-sm">{t("pay.payments")}</small></>} sub={summary ? <Money v={summary.confirmed.amount} /> : undefined} />
        <Kpi icon="payments" tone="good" label={t("pay.kpi.applied")} value={<>{summary?.applied.n ?? "–"} <small className="muted-sm">{t("pay.payments")}</small></>} sub={summary ? <Money v={summary.applied.amount} /> : undefined} />
        <Kpi icon="bank" label={t("pay.kpi.received")} value={summary ? <>{formatEtb(summary.recorded.amount + summary.confirmed.amount + summary.applied.amount)}</> : "–"} sub={summary && summary.voided.n ? `${summary.voided.n} ${t("voided")}` : undefined} />
      </div>
      <div className="tab-row"><Tabs value={tab} onChange={(v) => setTab(v as Status)} tabs={[["", t("total")], ["recorded", t("recorded")], ["confirmed", t("confirmed")], ["applied", t("applied")], ["voided", t("voided")]]} /></div>

      <Card flush><Table rows={rows} empty={t("empty.payments")} onRow={(p) => setOpen(p._id)} cols={[
        { head: t("pay.received"), cell: (p) => <DateText ms={p.receivedAt} />, sort: (p) => p.receivedAt },
        { head: t("ag.renter"), cell: (p) => <div className="two-line"><span>{p.renterName}</span>{p.payerName && <small className="muted">{t("pay.paidBy")} {p.payerName}</small>}</div>, sort: (p) => p.renterName },
        { head: t("amount"), cell: (p) => <Money v={p.amount} strong />, right: true, money: true, sort: (p) => p.amount },
        { head: t("pay.method"), cell: (p) => t(p.method), sort: (p) => p.method },
        { head: t("pay.reference"), cell: (p) => <span className="num">{p.reference}</span>, hide: true },
        { head: t("status"), cell: (p) => <StatusBadge status={p.status} />, sort: (p) => p.status },
        { head: "", cell: (p) => actions(p) },
      ]} /></Card>

      {adding && <RecordForm prefill={prefill} onClose={() => { setAdding(false); setPrefill(null); }} />}
      {applying && <ApplyDialog paymentId={applying} onClose={() => setApplying(null)} />}
      {open && <PaymentDetail paymentId={open} onClose={() => setOpen(null)} onApply={() => { setApplying(open); setOpen(null); }} onVoid={() => { setVoiding(open); setOpen(null); }} />}
      {reversing && <ReasonDialog title={t("pay.reverse")} onClose={() => setReversing(null)} onSave={(reason) => run(() => reverseP({ paymentId: reversing, reason }), t("saved"))} />}
      {voiding && <ReasonDialog title={t("pay.void")} onClose={() => setVoiding(null)} onSave={(reason) => run(() => voidP({ paymentId: voiding, reason }), t("saved"))} />}
    </div>
  );
}

type Prefill = { amount: number | null; reference: string; at: number | null; narration: string; lineId?: Id<"bankStatementEntries">; renterId?: string };

/** Record money that has arrived. The renter's open bills are shown so the amount can be checked against what is owed. */
function RecordForm({ prefill, onClose }: { prefill: Prefill | null; onClose: () => void }) {
  const { t } = useI18n(); const record = useMutation(api.payments.record); const matchLine = useMutation(api.bank.confirmMatch); const upload = useUpload(); const { run, error, busy } = useRun();
  const renters = useQuery(api.renters.list, {});
  // a bank line names the payer in its narration: pre-pick the renter whose name appears in it
  const guess = prefill?.narration ? renters?.find((r) => prefill.narration.toLowerCase().includes(r.name.toLowerCase()))?._id : undefined;
  const [renterId, setRenterId] = useState(prefill?.renterId ?? ""); const [amount, setAmount] = useState<number | null>(prefill?.amount ?? null);
  const [method, setMethod] = useState<Method>(prefill ? "transfer" : "transfer"); const [reference, setReference] = useState(prefill?.reference ?? "");
  const [at, setAt] = useState<number | null>(prefill?.at ?? today()); const [file, setFile] = useState<File | null>(null);
  const [payer, setPayer] = useState(""); const [notes, setNotes] = useState(prefill?.narration ?? "");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const chosen = renterId || guess || "";
  const bills = useQuery(api.payments.openBills, chosen ? { renterId: chosen as Id<"renters"> } : "skip");
  const dupes = useQuery(api.payments.possibleDuplicates, chosen && amount != null && amount > 0 && at != null ? { renterId: chosen as Id<"renters">, amount, receivedAt: at } : "skip");
  const [different, setDifferent] = useState(false);
  const totalDue = bills?.reduce((s, b) => s + b.due, 0) ?? 0;
  const clear = (k: string) => errs[k] && setErrs({ ...errs, [k]: "" });
  return (
    <Modal title={t("pay.record")} onClose={onClose}>
      <form className="form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const found = failures({ renter: chosen ? null : t("v.pick"), amount: positive(amount, t), reference: req(reference, t), at: at == null ? t("v.date") : null, file: fileProblem(file, t), dup: dupes && dupes.length > 0 && !different ? t("pay.dup.confirm") : null });
        setErrs(found); if (Object.keys(found).length) return;
        const id = await run(async () => record({ renterId: chosen as Id<"renters">, amount: amount!, method, reference: reference.trim(), receivedAt: at!, evidenceFileId: file ? await upload(file) : undefined, payerName: payer, notes, notDuplicate: different || undefined }), t("saved"));
        if (!id) return;
        // started from a bank line: link it now, so the statement and the payment agree straight away
        if (prefill?.lineId) { try { await matchLine({ entryId: prefill.lineId, paymentId: id }); } catch { /* the line can be matched from Bank matching */ } }
        onClose();
      }}>
        {prefill?.lineId && <p className="muted wide">{t("pay.fromBank")}: {prefill.narration}</p>}
        {prefill?.renterId && !prefill.lineId && prefill.narration && <p className="muted wide">{t("bill.number")}: {prefill.narration}</p>}
        <SelectField label={t("ag.renter")} error={errs.renter} value={chosen} onChange={(v) => { setRenterId(v); clear("renter"); }} options={(renters ?? []).map((r) => ({ value: r._id, label: r.name }))} />
        <Field label={`${t("amount")} (${currencyCode()})`} error={errs.amount}><MoneyInput key={String(amount)} value={amount} onChange={(v) => { setAmount(v); clear("amount"); }} /></Field>
        {chosen && bills && (
          <div className="wide open-bills">
            <div className="open-bills-h"><b>{t("pay.openBills")}</b>{bills.length > 0 && <><span className="muted">{t("pay.totalDue")}: {formatEtb(totalDue)}</span><button type="button" className="btn ghost sm" onClick={() => setAmount(totalDue)}>{t("pay.useTotal")}</button></>}</div>
            {bills.length === 0 ? <p className="muted">{t("pay.noOpenBills")}</p> : (
              <ul>{bills.map((b) => <li key={b.invoiceId}><span>{b.number}</span><span className="muted">{b.unitNumber} · {periodText(b.period, t)}</span><span className="muted">{t("bill.dueDate")} <DateText ms={b.dueAt} /></span><Money v={b.due} /></li>)}</ul>)}
          </div>)}
        {dupes && dupes.length > 0 && (
          <div className="wide dup-warn" role="alert">
            <b><Icon name="alert" size={16} /> {t("pay.dup.title")}</b>
            <ul>{dupes.map((d) => <li key={d.paymentId}>{t(d.method)} · <span className="num">{d.reference}</span> · <DateText ms={d.receivedAt} /> · <StatusBadge status={d.status} /></li>)}</ul>
            <p className="muted">{t("pay.dup.hint")}</p>
            <label className="row"><input type="checkbox" checked={different} onChange={(e) => { setDifferent(e.target.checked); clear("dup"); }} />{t("pay.dup.different")}</label>
            {errs.dup && <small className="field-error">{errs.dup}</small>}
          </div>)}
        <SelectField label={t("pay.method")} value={method} onChange={(v) => setMethod(v as Method)} options={METHODS.map((m) => ({ value: m, label: t(m) }))} />
        <Field label={t("pay.reference")} error={errs.reference}><input value={reference} onChange={(e) => { setReference(e.target.value); clear("reference"); }} /></Field>
        <Field label={t("pay.received")} error={errs.at}><DateField value={at} onChange={setAt} /></Field>
        <Field label={t("pay.payer")} hint={t("pay.payerHint")}><input value={payer} onChange={(e) => setPayer(e.target.value)} /></Field>
        <div className="wide"><Field label={t("pay.notes")} hint={t("optional")}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        <div className="wide"><Field label={t("pay.evidence")} error={errs.file} hint={t("pay.evidenceHint")}><input type="file" accept={FILE_ACCEPT} onChange={(e) => { const f = e.target.files?.[0] ?? null; const p = fileProblem(f, t); setErrs({ ...errs, file: p ?? "" }); setFile(p ? null : f); }} /></Field></div>
        <div className="wide"><Message error={error} /><button className="btn primary" disabled={busy}>{t("save")}</button></div>
      </form>
    </Modal>
  );
}

/** Decide which bills a confirmed payment settles. Defaults to oldest first; anything left over stays as credit on the renter's account. */
function ApplyDialog({ paymentId, onClose }: { paymentId: Id<"payments">; onClose: () => void }) {
  const { t } = useI18n(); const d = useQuery(api.payments.get, { paymentId });
  const bills = useQuery(api.payments.openBills, d ? { renterId: d.payment.renterId } : "skip");
  const apply = useMutation(api.payments.apply); const { run, error, busy } = useRun();
  const [amounts, setAmounts] = useState<Record<string, number | null> | null>(null);
  const auto = () => { let left = d!.payment.amount; const m: Record<string, number | null> = {}; for (const b of bills!) { const a = Math.min(b.due, left); m[b.invoiceId] = a > 0 ? a : null; left -= a; } return m; };
  useEffect(() => { if (d && bills && amounts === null) setAmounts(auto()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [d, bills]);
  if (!d || !bills || !amounts) return <Modal title={t("pay.apply.title")} onClose={onClose}><p className="muted">{t("loading")}</p></Modal>;
  const p = d.payment;
  const allocated = bills.reduce((s, b) => s + (amounts[b.invoiceId] ?? 0), 0);
  const left = p.amount - allocated;
  const tooMuch = bills.find((b) => (amounts[b.invoiceId] ?? 0) > b.due);
  const problem = left < 0 ? t("pay.apply.over") : tooMuch ? t("pay.apply.exceeds") : null;
  return (
    <Modal title={t("pay.apply.title")} onClose={onClose}>
      <div className="stack">
        <div className="match-line"><strong>{d.renter?.name}</strong><Money v={p.amount} strong /><span className="muted">{t(p.method)} · {p.reference} · <DateText ms={p.receivedAt} /></span></div>
        <p className="muted">{bills.length ? t("pay.apply.hint") : t("pay.noOpenBills")}</p>
        {bills.length > 0 && <>
          <div className="alloc">
            <div className="alloc-h"><span>{t("bill.number")}</span><span className="r">{t("bill.due")}</span><span className="r">{t("pay.apply.pay")}</span></div>
            {bills.map((b) => (
              <div key={b.invoiceId} className="alloc-row">
                <span><b>{b.number}</b><small className="muted"> {b.unitNumber} · {periodText(b.period, t)} · {t("bill.dueDate")} <DateText ms={b.dueAt} /></small></span>
                <span className="r num">{formatEtb(b.due)}</span>
                <span className="r"><MoneyInput key={`${b.invoiceId}-${amounts[b.invoiceId] ?? ""}`} value={amounts[b.invoiceId] ?? null} onChange={(v) => setAmounts({ ...amounts, [b.invoiceId]: v })} /></span>
              </div>))}
          </div>
          <div className="alloc-sum">
            <div><span>{t("pay.apply.allocated")}</span><b className="num">{formatEtb(allocated)}</b></div>
            <div className={left < 0 ? "bad" : ""}><span>{left >= 0 ? t("pay.apply.credit") : t("pay.apply.over")}</span><b className="num">{formatEtb(Math.abs(left))}</b></div>
          </div>
          <div className="row"><button type="button" className="btn ghost sm" onClick={() => setAmounts(auto())}>{t("pay.apply.auto")}</button><button type="button" className="btn ghost sm" onClick={() => setAmounts(Object.fromEntries(bills.map((b) => [b.invoiceId, null])))}>{t("clear")}</button></div>
        </>}
        <Message error={problem ?? error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>{t("cancel")}</button>
          <button className="btn primary" disabled={busy || !!problem} onClick={async () => {
            const allocations = bills.filter((b) => (amounts[b.invoiceId] ?? 0) > 0).map((b) => ({ invoiceId: b.invoiceId, amount: amounts[b.invoiceId]! }));
            if ((await run(() => apply({ paymentId, allocations }), t("saved"))) !== undefined) onClose();
          }}>{t("pay.apply.go")}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Everything about one payment: who recorded, confirmed and applied it and when, what it paid, the evidence and the bank line. */
function PaymentDetail({ paymentId, onClose, onApply, onVoid }: { paymentId: Id<"payments">; onClose: () => void; onApply: () => void; onVoid: () => void }) {
  const { t } = useI18n(); const { can, me } = useMe(); const router = useRouter(); const openFile = useOpenFile();
  const d = useQuery(api.payments.get, { paymentId }); const confirm = useMutation(api.payments.confirm); const { run, error } = useRun();
  if (!d) return <Modal title={t("pay.detail")} onClose={onClose}><p className="muted">{t("loading")}</p></Modal>;
  const p = d.payment; const tl = d.timeline;
  // older payments have no time for some steps; show what is known rather than a dash
  const step = (label: string, who?: string, at?: number, extra?: string) => who ? <li><b>{label}</b> {who}{(at || extra) && <small className="muted">{at ? <DateText ms={at} /> : null}{at && extra ? " · " : ""}{extra}</small>}</li> : null;
  return (
    <Modal title={`${t("pay.detail")} ${p.receiptNumber ?? ""}`.trim()} onClose={onClose}>
      <div className="stack">
        <div className="match-line"><strong>{d.renter?.name}</strong><Money v={p.amount} strong /><StatusBadge status={p.status} /></div>
        <dl className="dl">
          <div><dt>{t("pay.received")}</dt><dd><DateText ms={p.receivedAt} /></dd></div>
          <div><dt>{t("pay.method")}</dt><dd>{t(p.method)}</dd></div>
          <div><dt>{t("pay.reference")}</dt><dd className="num">{p.reference}</dd></div>
          {p.payerName && <div><dt>{t("pay.payer")}</dt><dd>{p.payerName}</dd></div>}
          {p.notes && <div><dt>{t("pay.notes")}</dt><dd>{p.notes}</dd></div>}
          {d.hasEvidence && <div><dt>{t("pay.evidence")}</dt><dd><button type="button" className="linklike" onClick={() => void openFile("evidence", paymentId)}>{t("ag.view")}</button></dd></div>}
          {d.bankLine && <div><dt>{t("pay.bankLine")}</dt><dd>{d.bankLine.description || d.bankLine.reference}<br /><small className="muted">{d.bankLine.batch} · <DateText ms={d.bankLine.postedAt} /></small></dd></div>}
        </dl>
        <div><h3 className="section-h">{t("pay.timeline")}</h3>
          <ol className="trail">
            {step(t("pay.t.recorded"), tl.recordedByName, tl.recordedAt)}
            {step(t("pay.t.confirmed"), tl.confirmedByName, tl.confirmedAt)}
            {step(t("pay.t.applied"), tl.appliedByName, tl.appliedAt)}
            {p.status === "applied" && !tl.appliedByName && <li><b>{t("applied")}</b>{p.receiptNumber && <small className="muted">{p.receiptNumber}</small>}</li>}
            {step(t("pay.t.voided"), tl.voidedByName, tl.voidedAt, tl.voidReason)}
          </ol></div>
        {d.lines.length > 0 && <div><h3 className="section-h">{t("pay.allocations")}</h3>
          <ul className="open-bills-list">{d.lines.map((l, i) => <li key={i}><span>{l.invoiceNumber}</span><span className="muted">{l.unitNumber} · {periodText(l.period, t)}</span><Money v={l.amount} /></li>)}
            {d.credit > 0 && <li><span>{t("pay.credit")}</span><span /><Money v={d.credit} /></li>}</ul></div>}
        <Message error={error} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {p.status === "applied" && <button className="btn" onClick={() => router.push(`/payments/${paymentId}`)}>{t("pay.receipt")}</button>}
          {p.status === "recorded" && can("approver") && <button className="btn primary" disabled={p.recordedBy === me?._id} title={p.recordedBy === me?._id ? t("err.same_person_cannot_approve") : ""} onClick={async () => { if ((await run(() => confirm({ paymentId }), t("saved"))) !== undefined) onClose(); }}>{t("pay.confirm")}</button>}
          {p.status === "confirmed" && can("financeOfficer") && <button className="btn primary" onClick={onApply}>{t("pay.apply")}</button>}
          {(p.status === "recorded" || p.status === "confirmed") && can("approver") && <button className="btn danger" onClick={onVoid}>{t("pay.void")}</button>}
        </div>
      </div>
    </Modal>
  );
}
