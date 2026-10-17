"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Icon, Mark } from "@/components/icons";
import { Field, Message } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

type Me = NonNullable<ReturnType<typeof useQuery<typeof api.users.me>>>;

/**
 * What a signed-in person sees when they do not have a company open yet: they can enter a company code to ask to join, use an
 * invitation code, wait for a decision, read why they were declined, or choose between the companies they belong to.
 */
export function CompanyAccess({ me }: { me: Me }) {
  const { t } = useI18n(); const { signOut } = useAuthActions();
  const access = useQuery(api.users.myAccess, {});
  const join = useMutation(api.users.requestToJoin); const accept = useMutation(api.invites.accept); const choose = useMutation(api.users.switchCompany);
  const { run, error, busy } = useRun();
  const [code, setCode] = useState(""); const [note, setNote] = useState(""); const [invite, setInvite] = useState("");
  const st = access?.status;
  const waiting = st === "pending", declined = st === "rejected", off = st === "deactivated";
  return (
    <div className="center">
      <div className="card auth wait">
        <Mark /><h1>{me.name || me.email}</h1>
        {me.problem === "choose_company" ? <>
          <h2>{t("co.chooseTitle")}</h2><p className="muted">{t("co.chooseBody")}</p>
          <div className="stack co-list">{me.companies.filter((c) => c.status === "active").map((c) => <button key={c.orgId} className="btn" onClick={() => void run(() => choose({ orgId: c.orgId }))}><Icon name="buildings" size={16} />{c.name}</button>)}</div>
        </> : waiting ? <>
          <span className="wait-ic" aria-hidden="true"><Icon name="check" size={26} /></span><h2>{t("access.waitTitle")}</h2>
          <p className="muted" role="status">{access && "company" in access && access.company ? t("co.waitFor").replace("{c}", access.company) : t("access.waitBody")}</p>
        </> : declined ? <>
          <span className="wait-ic bad" aria-hidden="true"><Icon name="alert" size={26} /></span><h2>{t("access.declinedTitle")}</h2>
          <p className="muted" role="status">{t("access.declinedBody")}</p>{access && "reason" in access && access.reason && <blockquote className="reason">{access.reason}</blockquote>}
        </> : off ? <>
          <span className="wait-ic bad" aria-hidden="true"><Icon name="alert" size={26} /></span><h2>{t("access.offTitle")}</h2><p className="muted" role="status">{t("access.offBody")}</p>
        </> : <><h2>{t("co.joinTitle")}</h2><p className="muted">{t("co.joinBody")}</p></>}
        {(!waiting && me.problem !== "choose_company") && <div className="stack co-forms">
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); await run(() => join({ code, note: note || undefined }), t("saved")); setCode(""); }}>
            <Field label={t("co.code")} hint={t("co.codeHint")}><input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" spellCheck={false} placeholder="XXXXXXXX" /></Field>
            <Field label={t("access.note")} hint={t("optional")}><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("access.notePlaceholder")} /></Field>
            <button className="btn primary" disabled={busy || code.trim().length < 4}>{t("co.ask")}</button>
          </form>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); await run(() => accept({ code: invite }), t("saved")); setInvite(""); }}>
            <Field label={t("invite.code")} hint={t("co.inviteHint")}><input value={invite} onChange={(e) => setInvite(e.target.value)} autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" /></Field>
            <button className="btn" disabled={busy || invite.trim().length < 6}>{t("co.useInvite")}</button>
          </form>
        </div>}
        <Message error={error} />
        {me.platformAdmin && <Link className="btn primary" href="/platform">{t("plat.open")}</Link>}
        <button className="btn ghost" onClick={() => void signOut()}>{t("signOut")}</button>
      </div>
    </div>
  );
}
