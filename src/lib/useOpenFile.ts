"use client";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { useToast } from "@/components/toast";
import { useI18n } from "./i18n";

export type FileKind = "signed" | "evidence" | "renterDoc" | "plan";

/**
 * Opens a stored document in a new tab. The server checks the person's role and building first and hands back a link
 * that works for two minutes; no permanent file address ever reaches the browser.
 */
export function useOpenFile() {
  const ticket = useMutation(api.files.ticket); const toast = useToast(); const { t } = useI18n();
  const site = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site");
  return async (kind: FileKind, id: string) => {
    // open the tab straight away (browsers block pop-ups that wait on the network), then point it at the document
    const w = window.open("", "_blank");
    if (w) w.opener = null;
    try {
      const { token } = await ticket({ kind, id });
      const url = `${site}/files/${token}`;
      if (w) w.location.href = url; else window.location.href = url;
    } catch (e) {
      w?.close();
      const code = e instanceof ConvexError ? String(e.data) : "generic";
      toast(t(`err.${code}`) === `err.${code}` ? t("err.generic") : t(`err.${code}`));
    }
  };
}
