// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/layout.tsx

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// 1. Set Base URL (Critical for social images to load)
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://adrolls.in";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "AdRolls AI",
  description: "Automate your real estate marketing with AI.",
  
  // 2. Define Manifest for PWA
  manifest: "/manifest.webmanifest",

  // 3. Icons (Favicon & App Icons)
  // This ensures the browser tab shows the icon
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/icon-192x192.png", // Required for iOS
  },

  // 4. Open Graph (WhatsApp/FB/LinkedIn)
  // We point 'images' to the large icon so it looks like the favicon but high-res
  openGraph: {
    title: "AdRolls AI",
    description: "Automate your real estate marketing",
    url: baseUrl,
    siteName: "AdRolls AI",
    type: "website",
    images: [
      {
        url: "/icon-512x512.png", // WhatsApp prefers square images > 300x300 for logos
        width: 512,
        height: 512,
        alt: "AdRolls AI",
      },
    ],
  },

  // 5. Twitter Card
  // 'summary' shows a small square image (logo style) instead of a large banner
  twitter: {
    card: "summary", 
    title: "AdRolls AI",
    description: "Automate your real estate marketing",
    images: ["/icon-512x512.png"],
  },

  // 6. Apple Web App Config
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AdRolls AI",
    // This adds the splash screen for iPhones
    startupImage: [
      "/apple-splash.png",
    ],
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