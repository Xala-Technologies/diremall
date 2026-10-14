"use client";
import Link from "next/link";
import { Mark } from "@/components/icons";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="center">
      <div className="card auth" style={{ textAlign: "center", justifyItems: "center" }}>
        <Mark size={44} />
        <h1>{t("nf.title")}</h1>
        <p className="muted">{t("nf.body")}</p>
        <Link className="btn primary" href="/">{t("nf.home")}</Link>
      </div>
    </div>
  );
}
