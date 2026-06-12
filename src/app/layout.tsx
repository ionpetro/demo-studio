import type { Metadata } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbm",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Demo Studio",
  description: "Chat with an agent that records browser demo videos for you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${poppins.variable} ${mono.variable} font-sans antialiased`}>
        <TooltipProvider>{children}</TooltipProvider>
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
