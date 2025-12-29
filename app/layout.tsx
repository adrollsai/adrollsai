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
    'adrolls.in',
    'www.adrolls.in',
    'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];
  // NOTE: We check if the host is in our allowed list. 
  // If you want to test on localhost, you must remove 'localhost' from being treated as a system host here, 
  // OR add 'localhost:3000' to your DB as a custom domain.
  return host.includes('localhost') || host.includes('127.0.0.1') || DEFAULT_HOSTS.includes(host);
}

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get('host') || '';

  // Default AdRolls Metadata
  const defaultMetadata: Metadata = {
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
    },
  };

  if (isSystemHost(host)) {
    return defaultMetadata;
  }

  // Dynamic Lookup
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
          icon: "/api/org-icon?type=favicon", // Points to route created in Step 3
          shortcut: "/api/org-icon?type=favicon",
          apple: "/api/org-icon?type=icon",
        },
        openGraph: {
          title: org.name,
          description: `Welcome to ${org.name}`,
          url: `https://${host}`,
          siteName: org.name,
          type: "website",
          images: [{ url: "/api/org-icon?type=icon", width: 512, height: 512, alt: org.name }],
        },
        twitter: {
          card: "summary",
          title: org.name,
          description: `Welcome to ${org.name}`,
          images: ["/api/org-icon?type=icon"],
        },
        appleWebApp: {
          capable: true,
          statusBarStyle: "default",
          title: org.name,
        },
      };
    }
  } catch (error) {
    console.error("Error fetching dynamic metadata:", error);
  }

  return defaultMetadata;
}

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
        {children}
      </body>
    </html>
  );
}