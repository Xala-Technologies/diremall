import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";
import { Providers } from "./providers";

const latin = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-latin", display: "swap" });
const ethiopic = Noto_Sans_Ethiopic({ subsets: ["ethiopic"], variable: "--font-ethiopic", display: "swap" });

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_NAME || "Rentals";
export const metadata: Metadata = {
  title: { default: PLATFORM, template: `%s · ${PLATFORM}` },
  description: "Rent, bills and payments for rental and mall companies",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#eef4fb" }, { media: "(prefers-color-scheme: dark)", color: "#0a1628" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${latin.variable} ${ethiopic.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body><a className="skip" href="#main">Skip to content</a><Providers>{children}</Providers></body>
    </html>
  );
}
