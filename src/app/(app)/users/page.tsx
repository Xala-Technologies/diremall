"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, Message, Modal, PageHeader, StatusBadge, Table } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

const ROLES = ["propertyManager", "financeOfficer", "approver", "auditor", "accessAdmin", "superAdmin"] as const;
type Role = (typeof ROLES)[number];

export default function Users() {
  const { t } = useI18n(); const users = useQuery(api.users.list); const [edit, setEdit] = useState<NonNullable<typeof users>[number] | null>(null);
  return (
    <div className="stack">
      <PageHeader title={t("nav.users")} />
      <Card><Table rows={users} onRow={setEdit} cols={[
        { head: t("name"), cell: (u) => <strong>{u.name || "—"}</strong> }, { head: t("email"), cell: (u) => u.email }, { head: t("users.roles"), cell: (u) => (u.roles as string[]).map((r) => t(r)).join(", ") || "—" },
        { head: t("status"), cell: (u) => <StatusBadge status={u.active ? "active" : "draft"} /> }]} /></Card>
      {edit && <Edit user={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Edit({ user, onClose }: { user: { _id: Id<"users">; name: string; roles: string[]; buildingScope: "all" | Id<"buildings">[]; active: boolean }; onClose: () => void }) {
  const { t } = useI18n(); const buildings = useQuery(api.properties.listBuildings); const set = useMutation(api.users.setAccess); const { run, error, busy } = useRun();
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles)); const [active, setActive] = useState(user.active);
  const [all, setAll] = useState(user.buildingScope === "all"); const [scope, setScope] = useState<Set<string>>(new Set(Array.isArray(user.buildingScope) ? user.buildingScope : []));
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
        <button className="btn primary" disabled={busy} onClick={async () => { if (await run(() => set({ userId: user._id, roles: [...roles] as Role[], buildingScope: all ? "all" : ([...scope] as Id<"buildings">[]), active }))) onClose(); }}>{t("save")}</button>
      </div>
    </Modal>
  );
}
