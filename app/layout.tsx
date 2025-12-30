import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { createClient } from '@/utils/supabase/server';

const inter = Inter({ subsets: ["latin"] });
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://adrolls.in";

// Helper to check for System Hosts
function isSystemHost(host: string) {
  const DEFAULT_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];
  return DEFAULT_HOSTS.includes(host);
}

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];

  // 1. FIX: Added appleWebApp here for the main domain
  const defaultMetadata: Metadata = {
    metadataBase: new URL(baseUrl),
    title: "AdRolls AI",
    description: "Keep your ads rolling...",
    manifest: "/manifest.webmanifest", 
    icons: {
      icon: "/favicon.ico",
      shortcut: "/favicon.ico",
      apple: "/icon-192x192.png", // Ensure this image exists in /public
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "AdRolls AI",
    },
  };

  if (isSystemHost(host)) return defaultMetadata;

  try {
    const supabase = await createClient();
    const { data: org } = await supabase
      .from('organizations')
      .select('name, master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (org) {
      return {
        metadataBase: new URL(`https://${host}`),
        title: org.name,
        description: `Welcome to ${org.name}`,
        manifest: "/manifest.webmanifest",
        icons: {
          icon: "/api/org-icon?type=favicon",
          shortcut: "/api/org-icon?type=favicon",
          apple: "/api/org-icon?type=icon", 
        },
        openGraph: {
          title: org.name,
          description: `Welcome to ${org.name}`,
          url: `https://${host}`,
          siteName: org.name,
          images: [{ url: "/api/org-icon?type=icon", width: 512, height: 512, alt: org.name }],
        },
        // 2. FIX: This was already correct for custom domains
        appleWebApp: {
          capable: true,
          statusBarStyle: "default",
          title: org.name,
        },
      };
    }
  } catch (error) {
    console.error("Metadata error:", error);
  }

  return defaultMetadata;
}

export const viewport: Viewport = {
  themeColor: "#D0E8FF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}