"use client";
import { useEffect } from "react";
import { Mark } from "@/components/icons";
import { useI18n } from "@/lib/i18n";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="center">
      <div className="card auth" style={{ textAlign: "center", justifyItems: "center" }} role="alert">
        <Mark size={44} />
        <h1>{t("err.title")}</h1>
        <p className="muted">{t("err.body")}</p>
        <button className="btn primary" onClick={reset}>{t("err.retry")}</button>
      </div>
    </div>
  );
}
