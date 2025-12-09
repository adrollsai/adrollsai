// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/layout.tsx

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// 1. Set Base URL
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://adrolls.in";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "AdRolls AI",
  description: "Automate your real estate marketing with AI.",
  
  // 2. Manifest
  manifest: "/manifest.webmanifest",

  // 3. Icons
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/icon-192x192.png",
  },

  // 4. Open Graph
  openGraph: {
    title: "AdRolls AI",
    description: "Automate your real estate marketing",
    url: baseUrl,
    siteName: "AdRolls AI",
    type: "website",
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "AdRolls AI",
      },
    ],
  },

  // 5. Twitter
  twitter: {
    card: "summary", 
    title: "AdRolls AI",
    description: "Automate your real estate marketing",
    images: ["/icon-512x512.png"],
  },

  // 6. Apple Web App (Splash Screens)
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AdRolls AI",
    startupImage: [
      // iPhone 16 Plus / 15 Pro Max / 15 Plus / 14 Pro Max
      {
        url: "/iPhone_16_Plus__iPhone_15_Pro_Max__iPhone_15_Plus__iPhone_14_Pro_Max_portrait.png",
        media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      // iPhone 17 Pro / 17 / 16 Pro / 15 Pro / 15 / 14 Pro
      {
        url: "/iPhone_17_Pro__iPhone_17__iPhone_16_Pro_portrait.png",
        media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      // iPhone 14 Plus / 13 Pro Max / 12 Pro Max
      {
        url: "/iPhone_14_Plus__iPhone_13_Pro_Max__iPhone_12_Pro_Max_portrait.png",
        media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      // iPhone 14 / 13 Pro / 13 / 12 Pro / 12
      {
        url: "/iPhone_16e__iPhone_14__iPhone_13_Pro__iPhone_13__iPhone_12_Pro__iPhone_12_portrait.png",
        media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      // iPhone 13 mini / 12 mini / 11 Pro / XS / X
      {
        url: "/iPhone_13_mini__iPhone_12_mini__iPhone_11_Pro__iPhone_XS__iPhone_X_portrait.png",
        media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      // iPhone 11 Pro Max / XS Max
      {
        url: "/iPhone_11_Pro_Max__iPhone_XS_Max_portrait.png",
        media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      // iPhone 11 / XR
      {
        url: "/iPhone_11__iPhone_XR_portrait.png",
        media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      // iPhone 8 Plus / 7 Plus / 6s Plus
      {
        url: "/iPhone_8_Plus__iPhone_7_Plus__iPhone_6s_Plus__iPhone_6_Plus_portrait.png",
        media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
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