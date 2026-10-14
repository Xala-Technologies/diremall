import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";
import { Providers } from "./providers";

const latin = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-latin", display: "swap" });
const ethiopic = Noto_Sans_Ethiopic({ subsets: ["ethiopic"], variable: "--font-ethiopic", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dire Mall Rentals", template: "%s · Dire Mall Rentals" },
  description: "Rent, bills and payments for Dire Mall",
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
