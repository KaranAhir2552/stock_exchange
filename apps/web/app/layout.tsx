import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Afterbell",
  description: "Fair tokenized-stock trading when the market is closed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <div className="mx-auto flex max-w-[1520px] flex-col gap-5 px-4 pt-6 pb-12 lg:px-10">
            <Navbar />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
