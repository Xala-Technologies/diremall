"use client";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Mark } from "./icons";
import { useI18n } from "@/lib/i18n";

/** The seller's letterhead: mark, legal name, TIN and VAT numbers, address and contact. The same on bills, receipts and contracts. */
export function OrgHeader({ size = 44 }: { size?: number }) {
  const { t } = useI18n(); const org = useQuery(api.settings.org) as { name: string; tin?: string; vatNumber?: string; address?: string; city?: string; phone?: string; email?: string } | undefined;
  const line = [org?.address, org?.city].filter(Boolean).join(", ");
  const contact = [org?.phone, org?.email].filter(Boolean).join(" · ");
  const ids = [org?.tin && `TIN ${org.tin}`, org?.vatNumber && `${t("renter.vat")} ${org.vatNumber}`].filter(Boolean).join(" · ");
  return (
    <div className="org-head">
      <Mark size={size} />
      <div>
        <div className="org-name">{org?.name ?? ""}</div>
        {ids && <div className="org-line">{ids}</div>}
        {line && <div className="org-line">{line}</div>}
        {contact && <div className="org-line">{contact}</div>}
      </div>
    </div>
  );
}
