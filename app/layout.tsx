import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { createClient } from '@/utils/supabase/server';

const inter = Inter({ subsets: ["latin"] });
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://adrolls.in";

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

  // FIX 1: Use RELATIVE path. This works for all domains automatically.
  const manifestUrl = "/api/manifest";

  // --- DEFAULT METADATA ---
  const defaultMetadata: Metadata = {
    metadataBase: new URL(baseUrl),
    title: "AdRolls AI",
    description: "Keep your ads rolling...",
    manifest: manifestUrl,
    icons: {
      icon: "/favicon.ico",
      shortcut: "/favicon.ico",
      apple: "/icon-192x192.png",
    },
    // FIX 2: Ensure default Apple config is complete
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "AdRolls AI",
    },
  };

  if (isSystemHost(host)) return defaultMetadata;

  // --- CUSTOM DOMAIN METADATA ---
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
        manifest: manifestUrl, // Relative path
        
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

        // FIX 3: Robust iOS Configuration for Custom Domains
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