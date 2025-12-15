import type { Metadata } from "next";
import { Geist, Geist_Mono, VT323 } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import { PrivyProvider } from "@/components/PrivyProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import Image from "next/image";
import Link from "next/link";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const vt323 = VT323({
  weight: "400",
  variable: "--font-pixel",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Auton - Decentralized Tipping with x402",
  description: "Lightweight, decentralized tipping miniapp built on Solana Devnet using the x402 payment protocol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${vt323.variable} antialiased bg-zinc-950 text-zinc-100 min-h-screen`}
      >
        <ThemeProvider>
          <PrivyProvider>
            <WalletProvider>
              <header className="fixed top-0 left-0 right-0 z-50 py-4 px-4 lg:px-8 pointer-events-none">
                <div className=" mx-auto flex items-center justify-between pointer-events-auto">
                  <Link href="/" className="flex items-center gap-3 group">
                    <div className="relative transition-transform group-hover:scale-110">
                      <Image
                        src="/auton-logo.png"
                        alt="Auton Logo"
                        width={40}
                        height={40}
                        className="object-contain"
                      />
                    </div>
                    <span className="font-pixel text-2xl text-white tracking-widest uppercase">
                      Auton
                    </span>
                  </Link>
                  <nav className="flex items-center gap-4 bg-zinc-900/80 backdrop-blur-md px-6 py-2 rounded-full border border-zinc-800/50 shadow-xl">
                    <Link
                      href="/"
                      className="text-sm font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-wider"
                    >
                      Hub
                    </Link>
                  </nav>
                </div>
              </header>
              <main className=" min-h-screen">
                {children}
              </main>
            </WalletProvider>
          </PrivyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}