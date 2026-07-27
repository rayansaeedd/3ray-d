import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { PrintProgressBar } from "@/components/PrintProgressBar";
import { CursorThread } from "@/components/CursorThread";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Nabtah — Planters printed in Saudi Arabia",
  description:
    "Nabtah planters are printed, not molded — one continuous wall, designed and made in Saudi Arabia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper font-sans">
        <PrintProgressBar />
        <CursorThread />
        {children}
      </body>
    </html>
  );
}
