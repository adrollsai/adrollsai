// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/layout.tsx

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// 1. Set the Base URL so social platforms know where images are hosted
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL 
  ? process.env.NEXT_PUBLIC_SITE_URL 
  : "https://adrolls.in"; // Fallback to your domain

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "AdRolls AI",
  description: "Automate your real estate marketing with AI. Launch ads, manage leads, and create content in seconds.",
  manifest: "/manifest.webmanifest",
  // 2. Add Open Graph Config (For WhatsApp, LinkedIn, FB)
  openGraph: {
    title: "AdRolls AI - Real Estate Marketing Automator",
    description: "Automate your real estate marketing with AI. Launch ads, manage leads, and create content in seconds.",
    url: baseUrl,
    siteName: "AdRolls AI",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.jpg", // This looks in your public folder
        width: 1200,
        height: 630,
        alt: "AdRolls AI Dashboard Preview",
      },
    ],
  },
  // 3. Add Twitter Config (For X/Twitter cards)
  twitter: {
    card: "summary_large_image",
    title: "AdRolls AI",
    description: "Automate your real estate marketing with AI.",
    images: ["/og-image.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AdRolls AI",
  },
};

export const viewport: Viewport = {
  themeColor: "#D0E8FF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}