// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/layout.tsx

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// 1. Import the new component
import ApplePwaSplash from "@/components/ApplePwaSplash";

const inter = Inter({ subsets: ["latin"] });

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://adrolls.in";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "AdRolls AI",
  description: "keep your ads rolling...",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/icon-192x192.png",
  },
  openGraph: {
    title: "AdRolls AI",
    description: "Automate your real estate marketing",
    url: baseUrl,
    siteName: "AdRolls AI",
    type: "website",
    images: [{ url: "/icon-512x512.png", width: 512, height: 512, alt: "AdRolls AI" }],
  },
  twitter: {
    card: "summary", 
    title: "AdRolls AI",
    description: "Automate your real estate marketing",
    images: ["/icon-512x512.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AdRolls AI",
    // 2. REMOVE the 'startupImage' array from here
  },
};

export const viewport: Viewport = {
  themeColor: "#D0E8FF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* 3. Render the splash screens here. Next.js will hoist them to <head> */}
        <ApplePwaSplash />
        {children}
      </body>
    </html>
  );
}