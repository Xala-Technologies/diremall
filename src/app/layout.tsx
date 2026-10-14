import type { Metadata, Viewport } from "next";
import { Geist, Noto_Sans_Ethiopic } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const latin = Geist({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
const ethiopic = Noto_Sans_Ethiopic({ subsets: ["ethiopic"], variable: "--font-ethiopic", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dire Mall Rentals", template: "%s · Dire Mall Rentals" },
  description: "Rent, bills and payments for Dire Mall",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f6" }, { media: "(prefers-color-scheme: dark)", color: "#0e1215" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${latin.variable} ${ethiopic.variable}`}>
      <body><a className="skip" href="#main">Skip to content</a><Providers>{children}</Providers></body>
    </html>
  );
}
