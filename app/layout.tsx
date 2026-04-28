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
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'localhost'
  ];
  return DEFAULT_HOSTS.includes(host);
}

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];

  const defaultMetadata: Metadata = {
    metadataBase: new URL(baseUrl),
    title: "AdRolls AI",
    description: "Keep your ads rolling...",
    manifest: "/api/manifest",
    icons: {
      icon: "/favicon.ico",
      shortcut: "/favicon.ico",
      apple: "/icon-192x192.png",
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: "default",
        title: "AdRolls AI",
    }
  };

  if (isSystemHost(host)) return defaultMetadata;

  try {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, logo_url')
      .eq('custom_domain', host)
      .single();

    if (profile) {
      const logoVersion = profile.logo_url ? encodeURIComponent(profile.logo_url.split('/').pop() || 'v1') : 'v1';
      const title = profile.business_name || "Partner App";
      
      return {
        metadataBase: new URL(`https://${host}`),
        title: title,
        description: `Welcome to ${title}`,
        manifest: "/api/manifest",
        icons: {
          icon: `/api/org-icon?type=favicon&v=${logoVersion}`,
          shortcut: `/api/org-icon?type=favicon&v=${logoVersion}`,
          apple: `/api/org-icon?type=icon&v=${logoVersion}`, 
        },
        appleWebApp: {
            capable: true,
            statusBarStyle: "default",
            title: title,
        },
        openGraph: {
          title: title,
          description: `Welcome to ${title}`,
          url: `https://${host}`,
          siteName: title,
          images: [{ url: `/api/org-icon?type=icon&v=${logoVersion}`, width: 512, height: 512, alt: title }],
        },
      };
    }
  } catch (error) {
    console.error("Metadata error:", error);
  }

  return defaultMetadata;
}

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  
  // Fetch Dynamic Splash Screen URL
  const headersList = await headers();
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];
  
  let splashUrl = "/icon-512x512.png"; // Default fallback
  
  if (!isSystemHost(host)) {
     try {
        const supabase = await createClient();
        const { data: profile } = await supabase.from('profiles').select('logo_url').eq('custom_domain', host).single();
        if (profile?.logo_url) {
            const v = encodeURIComponent(profile.logo_url.split('/').pop() || 'v1');
            splashUrl = `/api/org-icon?type=splash&v=${v}`;
        }
     } catch (e) {
         // Fallback applies naturally
     }
  }

  return (
    <html lang="en">
      <head>
        {/* iOS Splash Screen: Dynamically points to the Sharp image processor */}
        <link rel="apple-touch-startup-image" href={splashUrl} />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}