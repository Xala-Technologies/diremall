"use client";
import { useCallback, useState } from "react";
import { ConvexError } from "convex/values";
import { useI18n } from "./i18n";
import { useToast } from "@/components/toast";

/** Wrap a mutation call: tracks busy state and turns server error codes into readable messages. */
export function useRun() {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMessage?: string): Promise<T | undefined> => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r;
    } catch (e) {
      const code = e instanceof ConvexError ? String(e.data) : "generic";
      const msg = t(`err.${code}`);
      setError(msg === `err.${code}` ? `${t("err.generic")} (${code})` : msg);
      return undefined;
    } finally { setBusy(false); }
  }, [t, toast]);
  return { run, busy, error, notice, clear: () => { setError(null); setNotice(null); } };
}
