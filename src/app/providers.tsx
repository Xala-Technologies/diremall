"use client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!client) return <p style={{ padding: 24 }}>NEXT_PUBLIC_CONVEX_URL is not set. Run <code>npx convex dev</code> first.</p>;
  return (
    <ConvexAuthProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </ConvexAuthProvider>
  );
}
