"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { FilterSelect } from "@/components/FilterSelect";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Badge, Card, ConfirmDialog, DateText, Empty, Field, Message, Modal, PageHeader, ReasonDialog, SearchInput, StatusBadge, Table } from "@/components/ui";
import { useMe } from "@/lib/useMe";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

const ROLES = ["propertyManager", "financeOfficer", "approver", "auditor", "accessAdmin", "superAdmin"] as const;
type Role = (typeof ROLES)[number];

/** The roles, each with what it lets a person do, so nobody is given access by guessing from a name. */
function RolePicker({ roles, setRoles }: { roles: Set<string>; setRoles: (s: Set<string>) => void }) {
  const { t } = useI18n(); const { can } = useMe();
  const flip = (v: string) => { const n = new Set(roles); if (n.has(v)) n.delete(v); else n.add(v); setRoles(n); };
  return (
    <fieldset className="role-picker"><legend>{t("users.roles")}</legend>
      {ROLES.filter((r) => r !== "superAdmin" || can("superAdmin")).map((r) => (
        <label key={r} className={`role-opt${roles.has(r) ? " is-on" : ""}`}>
          <input type="checkbox" checked={roles.has(r)} onChange={() => flip(r)} />
          <span><b>{t(r)}</b><small>{t(`role.desc.${r}`)}</small></span>
        </label>))}
    </fieldset>
  );
}

/** Someone asked for access. The administrator picks their roles and buildings, or declines with a reason. */
function Approve({ person, onClose }: { person: { _id: Id<"users">; name: string; email: string; note: string }; onClose: () => void }) {
  const { t } = useI18n(); const approve = useMutation(api.users.approveRequest); const buildings = useQuery(api.properties.listBuildings, {}); const { run, error, busy } = useRun();
  const [roles, setRoles] = useState<Set<string>>(new Set(["propertyManager"])); const [all, setAll] = useState(true); const [scope, setScope] = useState<Set<string>>(new Set());
  const flip = <T,>(s: Set<T>, v: T) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  return (
    <Modal title={`${t("access.approveTitle")}: ${person.name || person.email}`} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => approve({ userId: person._id, roles: [...roles] as Role[], buildingScope: all ? "all" : ([...scope] as Id<"buildings">[]) }), t("access.approved"))) onClose();
      }}>
        <p className="muted">{person.email}{person.note ? ` · “${person.note}”` : ""}</p>
        <RolePicker roles={roles} setRoles={setRoles} />
        <fieldset><legend>{t("users.scope")}</legend>
          <label className="row"><input type="checkbox" checked={all} onChange={() => setAll(!all)} />{t("allBuildings")}</label>
          {!all && buildings?.map((b) => <label key={b._id} className="row"><input type="checkbox" checked={scope.has(b._id)} onChange={() => setScope(flip(scope, b._id))} />{b.name}</label>)}</fieldset>
        <Message error={error} />
        <div><button className="btn primary" disabled={busy || roles.size === 0 || (!all && scope.size === 0)}>{t("access.approve")}</button></div>
      </form>
    </Modal>);
}

function Requests() {
  const { t } = useI18n(); const r = useQuery(api.users.requests); const reject = useMutation(api.users.rejectRequest); const reopen = useMutation(api.users.reopenRequest); const del = useMutation(api.users.deleteRequest);
  const { run, error } = useRun(); const [approving, setApproving] = useState<(typeof pending)[number] | null>(null); const [declining, setDeclining] = useState<(typeof pending)[number] | null>(null); const [removing, setRemoving] = useState<(typeof pending)[number] | null>(null);
  const pending = r?.pending ?? [], declined = r?.declined ?? [];
  if (!r || (pending.length === 0 && declined.length === 0)) return null;
  return (
    <>
      <Card title={`${t("access.requests")} (${pending.length})`}>
        <Message error={error} />
        {pending.length === 0 ? <p className="muted">{t("access.noneWaiting")}</p> : (
          <ul className="req-list">
            {pending.map((p) => (
              <li key={p._id}>
                <div className="req-main"><b>{p.name || p.email}</b><span className="muted">{p.email} · {t("access.requestedOn")} <DateText ms={p.requestedAt} /></span>{p.note && <blockquote className="reason">{p.note}</blockquote>}</div>
                <div className="row"><button className="btn primary sm" onClick={() => setApproving(p)}>{t("access.approve")}</button><button className="btn sm" onClick={() => setDeclining(p)}>{t("access.decline")}</button></div>
              </li>))}
          </ul>)}
      </Card>
      {declined.length > 0 && <Card title={`${t("access.declined")} (${declined.length})`}>
        <ul className="req-list">
          {declined.map((p) => (
            <li key={p._id}>
              <div className="req-main"><b>{p.name || p.email}</b><span className="muted">{p.email}</span><span className="muted">{t("access.reason")}: {p.reason}</span></div>
              <div className="row"><button className="btn sm" onClick={() => void run(() => reopen({ userId: p._id }), t("saved"))}>{t("access.reopen")}</button><button className="btn sm danger" onClick={() => setRemoving(p)}>{t("delete")}</button></div>
            </li>))}
        </ul></Card>}
      {approving && <Approve person={approving} onClose={() => setApproving(null)} />}
      {declining && <ReasonDialog title={`${t("access.decline")}: ${declining.name || declining.email}`} onClose={() => setDeclining(null)} onSave={async (reason) => { await run(() => reject({ userId: declining._id, reason }), t("saved")); setDeclining(null); }} />}
      {removing && <ConfirmDialog danger title={t("access.removeTitle")} message={t("access.removeBody")} confirmLabel={t("delete")} onClose={() => setRemoving(null)} onConfirm={async () => { await run(() => del({ userId: removing._id }), t("deleted")); }} />}
    </>
  );
}

export default function Users() {
  const { t } = useI18n(); const all = useQuery(api.users.list); const pending = useQuery(api.invites.list); const revoke = useMutation(api.invites.revoke); const { run, error: invErr } = useRun(); const [inviting, setInviting] = useState(false);
  const [q, setQ] = useState(""); const [role, setRole] = useState("");
  const needle = q.trim().toLowerCase();
  const users = all?.filter((u) => (!role || (u.roles as string[]).includes(role)) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)));
  const [edit, setEdit] = useState<NonNullable<typeof users>[number] | null>(null);
  return (
    <div className="stack">
      <PageHeader title={t("nav.users")} actions={<button className="btn primary" onClick={() => setInviting(true)}>{t("invite.person")}</button>} filters={<><SearchInput value={q} onChange={setQ} placeholder={t("filter.searchUsers")} /><FilterSelect label={t("users.roles")} placeholder={t("users.roles")} value={role} onChange={setRole} options={[{ value: "", label: t("filter.allRoles"), icon: <ShieldCheck size={16} /> }, ...ROLES.map((r) => ({ value: r as string, label: t(r), icon: <ShieldCheck size={16} /> }))]} /></>} />
      <Requests />
      <Card flush><Table rows={users} onRow={setEdit} cols={[
        { head: t("name"), cell: (u) => <strong>{u.name || "—"}</strong> }, { head: t("email"), cell: (u) => u.email }, { head: t("users.roles"), cell: (u) => (u.roles as string[]).map((r) => t(r)).join(", ") || "—" },
        { head: t("status"), cell: (u) => <StatusBadge status={u.active ? "active" : "inactive"} /> }]} /></Card>
      {pending && pending.length > 0 && <Card title={t("invite.pending")}><Message error={invErr} /><Table rows={pending} cols={[
        { head: t("email"), cell: (i) => i.email }, { head: t("users.roles"), cell: (i) => (i.roles as string[]).map((r) => t(r)).join(", ") },
        { head: t("invite.expires"), cell: (i) => new Date(i.expiresAt).toISOString().slice(0, 10) },
        { head: "", cell: (i) => <button className="btn sm danger" onClick={() => void run(() => revoke({ id: i._id }), t("saved"))}>{t("invite.revoke")}</button> }]} /></Card>}
      {inviting && <Invite onClose={() => setInviting(false)} />}
      {edit && <Edit user={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Invite({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(); const create = useMutation(api.invites.create); const buildings = useQuery(api.properties.listBuildings, {}); const { run, error, busy } = useRun();
  const [email, setEmail] = useState(""); const [roles, setRoles] = useState<Set<string>>(new Set(["propertyManager"])); const [all, setAll] = useState(true); const [scope, setScope] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ code: string; email: string } | null>(null);
  const flip = <T,>(s: Set<T>, v: T) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };
  if (done) return (
    <Modal title={t("invite.ready")} onClose={onClose}>
      <div className="stack">
        <p>{t("invite.readyHint")}</p>
        <p className="muted">{done.email}</p>
        <ul className="recovery"><li><code>{done.code}</code></li></ul>
        <div className="row"><button className="btn" onClick={() => void navigator.clipboard?.writeText(done.code)}>{t("mfa.copy")}</button><button className="btn primary" onClick={onClose}>{t("mfa.done")}</button></div>
      </div>
    </Modal>);
  return (
    <Modal title={t("invite.person")} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => create({ email, roles: [...roles] as Role[], buildingScope: all ? "all" : ([...scope] as Id<"buildings">[]) }));
        if (r) setDone({ code: r.code, email: r.email });
      }}>
        <Field label={t("email")}><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <RolePicker roles={roles} setRoles={setRoles} />
        <fieldset><legend>{t("users.scope")}</legend>
          <label className="row"><input type="checkbox" checked={all} onChange={() => setAll(!all)} />{t("allBuildings")}</label>
          {!all && buildings?.map((b) => <label key={b._id} className="row"><input type="checkbox" checked={scope.has(b._id)} onChange={() => setScope(flip(scope, b._id))} />{b.name}</label>)}</fieldset>
        <Message error={error} />
        <div><button className="btn primary" disabled={busy || roles.size === 0}>{t("invite.create")}</button></div>
      </form>
    </Modal>);
}

function Edit({ user, onClose }: { user: { _id: Id<"users">; name: string; roles: string[]; buildingScope: "all" | Id<"buildings">[]; active: boolean }; onClose: () => void }) {
  const { t } = useI18n(); const resetMfa = useMutation(api.mfa.reset); const buildings = useQuery(api.properties.listBuildings, {}); const set = useMutation(api.users.setAccess); const { run, error, busy } = useRun();
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles)); const [active, setActive] = useState(user.active); const [confirm, setConfirm] = useState(false);
  const [all, setAll] = useState(user.buildingScope === "all"); const [scope, setScope] = useState<Set<string>>(new Set(Array.isArray(user.buildingScope) ? user.buildingScope : []));
  const save = async () => { if (await run(() => set({ userId: user._id, roles: [...roles] as Role[], buildingScope: all ? "all" : ([...scope] as Id<"buildings">[]), active }), t("saved"))) onClose(); };
  const flip = <T,>(s: Set<T>, v: T) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };
  return (
    <Modal title={user.name || t("users.roles")} onClose={onClose}>
      <div className="stack">
        <RolePicker roles={roles} setRoles={setRoles} />
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
