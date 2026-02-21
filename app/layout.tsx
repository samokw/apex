import type { Metadata } from "next";
import { Syne, JetBrains_Mono, Instrument_Serif, Libre_Franklin } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const libreFranklin = Libre_Franklin({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Apex — AI Accessibility Remediation",
  description:
    "Scan, fix, and certify web accessibility issues with AI-powered remediation. WCAG compliance for startups, powered by XRPL micropayments.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${syne.variable} ${jetbrains.variable} ${instrumentSerif.variable} ${libreFranklin.variable} antialiased bg-[#050505] text-[#f5f5f5] min-h-screen`}
        style={{ fontFamily: "var(--font-syne), sans-serif" }}
      >
        <Providers>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-100 focus:bg-[#0f0f0f] focus:text-[#00f0ff] focus:px-4 focus:py-2 focus:rounded-lg focus:ring-2 focus:ring-[#00f0ff] focus:outline-none"
          >
            Skip to main content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
