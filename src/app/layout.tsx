import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Studio",
  description: "Chat with an agent that records browser demo videos for you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
