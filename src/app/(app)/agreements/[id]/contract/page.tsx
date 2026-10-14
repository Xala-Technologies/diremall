"use client";
import { useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Icon, Mark } from "@/components/icons";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { monthlyRent } from "../../../../../../convex/lib/billing";
import { formatDate, formatEtb } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

/** A lease document built from the agreement's recorded terms. A template: counsel must review the wording. */
export default function Contract() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n(); const router = useRouter();
  const d = useQuery(api.agreements.get, { agreementId: id as Id<"agreements"> });
  const buildings = useQuery(api.properties.listBuildings);
  if (!d || !buildings) return <Card><Skeleton lines={8} /></Card>;
  const { agreement: a, unit, renter } = d;
  const first = d.terms.slice().sort((x, y) => x.effectiveFrom - y.effectiveFrom)[0];
  const building = buildings.find((b) => b._id === unit.buildingId)?.name ?? "";
  const dual = (ms: number) => `${formatDate(ms, "gregorian", lang)} (${formatDate(ms, "ethiopian", lang)})`;
  const rent = first ? monthlyRent(first.rent.kind === "fixed" ? { kind: "fixed", amount: first.rent.amount } : { kind: "perM2", areaM2: unit.areaM2, ratePerM2: first.rent.ratePerM2 }) : 0;
  const basis = first?.rent.kind === "perM2" ? `${unit.areaM2} m² × ${formatEtb(first.rent.ratePerM2)} per m²` : "fixed monthly rent";
  return (
    <div className="stack">
      <PageHeader title={t("contract.title")}>
        <button className="btn ghost" onClick={() => router.back()}>{t("back")}</button>
        <button className="btn primary no-print" onClick={() => window.print()}><Icon name="print" />{t("print")}</button>
      </PageHeader>
      <div className="draft-mark no-print">{t("contract.draft")}</div>
      <article className="paper">
        <header className="paper-h"><div className="brand" style={{ padding: 0 }}><Mark size={40} /><span className="brand-text">Dire Mall<small>Dire Dawa</small></span></div><div className="paper-title">{t("contract.title")}</div></header>
        <p>This lease is made on {dual(Date.now())} between <b>Dire Mall</b> (the Lessor) and <b>{renter?.name}</b>{renter?.tin ? `, TIN ${renter.tin}` : ""}{renter?.businessLicenseNo ? `, business licence ${renter.businessLicenseNo}` : ""}{renter?.legalRepresentative ? `, represented by ${renter.legalRepresentative}` : ""} (the Lessee).</p>
        <ol>
          <li><h3>Premises</h3>Unit <b>{unit.number}</b> in {building}, {unit.areaM2} m², used as {unit.category} space.</li>
          <li><h3>Term</h3>From <b>{dual(a.startsAt)}</b> to <b>{dual(a.endsAt)}</b>.</li>
          <li><h3>Rent</h3>{formatEtb(rent)} per month ({basis}), payable by day {first?.dueDay} of each month.{first?.escalation ? ` The rent increases by ${first.escalation.percent}% every ${first.escalation.everyMonths} months.` : ""}</li>
          <li><h3>Deposit</h3>{formatEtb(first?.depositAmount ?? 0)}, held separately from rent and returned at the end of the lease after approved deductions.</li>
          <li><h3>Utilities and service charges</h3>Water and electricity are charged from the unit's sub-meter readings. Shared costs such as generator, security and cleaning are divided by floor area.</li>
          <li><h3>Payments</h3>Rent is paid by bank deposit, transfer, Telebirr, CBE Birr or cash, and a receipt is issued for each payment applied.</li>
          <li><h3>Handover</h3>The parties record keys, condition and meter readings at move-in and move-out.</li>
          <li><h3>Ending the lease</h3>Either party may end the lease only as the law and this agreement allow. The Lessor stops billing from the date the lease ends.</li>
          <li><h3>Governing law</h3>This lease is governed by the Property Rental Operations and Control Proclamation No. 1320/2024.</li>
        </ol>
        <footer className="paper-f"><div><span className="muted">Lessor</span><div className="sign" /><b>Dire Mall</b></div><div><span className="muted">Lessee</span><div className="sign" /><b>{renter?.name}</b></div></footer>
      </article>
    </div>
  );
}
