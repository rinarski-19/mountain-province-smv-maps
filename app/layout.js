import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  // Pull a wide weight range so the type system can lean on actual
  // 800/900 weights instead of synthesised bolds.
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata = {
  title: "Mountain Province Public Consultation Map",
  description:
    "Public consultation map for Mountain Province land valuation zones.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      {/*
        suppressHydrationWarning: browser extensions (ColorZilla, Grammarly,
        translation plugins, etc.) commonly inject attributes onto <body>
        before React hydrates, causing a benign mismatch warning. This flag
        scopes the suppression to the body element only — page content still
        gets full hydration checks.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
