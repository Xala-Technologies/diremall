"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Card, ConfirmDialog, Field, Message, PageHeader, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

/** The people who run the platform. They are added from accounts that already exist, and the team always keeps at least one person. */
export default function PlatformTeam() {
  const { t } = useI18n(); const team = useQuery(api.platform.team); const set = useMutation(api.platform.setTeamMember); const { run, error, busy } = useRun();
  const [email, setEmail] = useState(""); const [removing, setRemoving] = useState<{ email: string; name: string } | null>(null);
  return (
    <div className="stack">
      <PageHeader title={t("plat.nav.team")} sub={t("plat.teamSub")} />
      <Card title={t("plat.addTeam")}>
        <form className="row" onSubmit={async (e) => { e.preventDefault(); if (await run(() => set({ email, on: true }), t("saved"))) setEmail(""); }}>
          <Field label={t("email")}><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>
          <button className="btn primary" disabled={busy}>{t("plat.add")}</button>
        </form>
        <p className="muted">{t("plat.addTeamHint")}</p><Message error={error} />
      </Card>
      <Card flush><Table rows={team} cols={[
        { head: t("name"), cell: (m) => <strong>{m.name || "—"}</strong> }, { head: t("email"), cell: (m) => m.email },
        { head: "", cell: (m) => <button className="btn sm danger" onClick={() => setRemoving({ email: m.email, name: m.name })}>{t("plat.remove")}</button> }]} /></Card>
      {removing && <ConfirmDialog danger title={t("plat.removeTitle").replace("{n}", removing.name || removing.email)} message={t("plat.removeBody")} confirmLabel={t("plat.remove")} onClose={() => setRemoving(null)} onConfirm={async () => { await run(() => set({ email: removing.email, on: false }), t("saved")); }} />}
    </div>
  );
}
