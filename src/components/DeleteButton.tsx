"use client";
import { useState } from "react";
import { ConfirmDialog, Message } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import { useRun } from "@/lib/useRun";

/** A delete that always asks first, says what will go with it, and shows the server's reason if it is refused. */
export function DeleteButton({ label, title, message, onDelete, onDone, disabledReason, small = true }: {
  label?: string; title: string; message: string; onDelete: () => Promise<unknown>; onDone?: () => void; disabledReason?: string; small?: boolean;
}) {
  const { t } = useI18n(); const { run, error, clear } = useRun(); const [ask, setAsk] = useState(false);
  return (
    <>
      <button type="button" className={`btn danger${small ? " sm" : ""}`} disabled={!!disabledReason} title={disabledReason} onClick={() => { clear(); setAsk(true); }}><Icon name="trash" size={15} />{label ?? t("delete")}</button>
      {error && <Message error={error} />}
      {ask && <ConfirmDialog danger title={title} message={message} confirmLabel={t("delete")} onClose={() => setAsk(false)} onConfirm={async () => { const r = await run(async () => { await onDelete(); return true; }, t("deleted")); if (r) onDone?.(); }} />}
    </>
  );
}
