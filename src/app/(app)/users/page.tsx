"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, ConfirmDialog, Message, Modal, PageHeader, SearchInput, StatusBadge, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

const ROLES = ["propertyManager", "financeOfficer", "approver", "auditor", "accessAdmin", "superAdmin"] as const;
type Role = (typeof ROLES)[number];

export default function Users() {
  const { t } = useI18n(); const all = useQuery(api.users.list);
  const [q, setQ] = useState(""); const [role, setRole] = useState("");
  const needle = q.trim().toLowerCase();
  const users = all?.filter((u) => (!role || (u.roles as string[]).includes(role)) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)));
  const [edit, setEdit] = useState<NonNullable<typeof users>[number] | null>(null);
  return (
    <div className="stack">
      <PageHeader title={t("nav.users")} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchUsers")} /><FilterSelect label={t("users.roles")} placeholder={t("users.roles")} value={role} onChange={setRole} options={[{ value: "", label: t("filter.allRoles"), icon: <ShieldCheck size={16} /> }, ...ROLES.map((r) => ({ value: r as string, label: t(r), icon: <ShieldCheck size={16} /> }))]} /></>} />
      <Card flush><Table rows={users} onRow={setEdit} cols={[
        { head: t("name"), cell: (u) => <strong>{u.name || "—"}</strong> }, { head: t("email"), cell: (u) => u.email }, { head: t("users.roles"), cell: (u) => (u.roles as string[]).map((r) => t(r)).join(", ") || "—" },
        { head: t("status"), cell: (u) => <StatusBadge status={u.active ? "active" : "inactive"} /> }]} /></Card>
      {edit && <Edit user={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Edit({ user, onClose }: { user: { _id: Id<"users">; name: string; roles: string[]; buildingScope: "all" | Id<"buildings">[]; active: boolean }; onClose: () => void }) {
  const { t } = useI18n(); const resetMfa = useMutation(api.mfa.reset); const buildings = useQuery(api.properties.listBuildings); const set = useMutation(api.users.setAccess); const { run, error, busy } = useRun();
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles)); const [active, setActive] = useState(user.active); const [confirm, setConfirm] = useState(false);
  const [all, setAll] = useState(user.buildingScope === "all"); const [scope, setScope] = useState<Set<string>>(new Set(Array.isArray(user.buildingScope) ? user.buildingScope : []));
  const save = async () => { if (await run(() => set({ userId: user._id, roles: [...roles] as Role[], buildingScope: all ? "all" : ([...scope] as Id<"buildings">[]), active }), t("saved"))) onClose(); };
  const flip = <T,>(s: Set<T>, v: T) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };
  return (
    <Modal title={user.name || t("users.roles")} onClose={onClose}>
      <div className="stack">
        <fieldset><legend>{t("users.roles")}</legend>{ROLES.map((r) => <label key={r} className="row"><input type="checkbox" checked={roles.has(r)} onChange={() => setRoles(flip(roles, r))} />{t(r)}</label>)}</fieldset>
        <fieldset><legend>{t("users.scope")}</legend>
          <label className="row"><input type="checkbox" checked={all} onChange={() => setAll(!all)} />{t("allBuildings")}</label>
          {!all && buildings?.map((b) => <label key={b._id} className="row"><input type="checkbox" checked={scope.has(b._id)} onChange={() => setScope(flip(scope, b._id))} />{b.name}</label>)}</fieldset>
        <label className="row"><input type="checkbox" checked={active} onChange={() => setActive(!active)} />{t("users.active")}</label>
        <Message error={error} />
        <button className="btn ghost" disabled={busy} onClick={() => void run(() => resetMfa({ userId: user._id }), t("mfa.resetDone"))}>{t("mfa.reset")}</button>
        <button className="btn primary" disabled={busy} onClick={() => { if (user.active && !active) setConfirm(true); else void save(); }}>{t("save")}</button>
        {confirm && <ConfirmDialog title={t("confirm.deactivateTitle")} message={t("confirm.deactivateBody")} confirmLabel={t("save")} danger onClose={() => setConfirm(false)} onConfirm={save} />}
      </div>
    </Modal>
  );
}
