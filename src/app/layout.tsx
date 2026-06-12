import type { Metadata } from "next";
import { Syne, Spline_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-display", weight: ["700", "800"] });
const splineSans = Spline_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600"] });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Demo Studio",
  description: "Chat with an agent that records browser demo videos for you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${splineSans.variable} ${splineMono.variable}`}>
        {children}
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
