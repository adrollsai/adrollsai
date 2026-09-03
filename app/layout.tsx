import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { createClient } from '@/utils/supabase/server';

const inter = Inter({ subsets: ["latin"] });
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://nobogent.com";

function isSystemHost(host: string) {
  const DEFAULT_HOSTS = [
    'nobogent.com', 'www.nobogent.com', 'app.nobogent.com',
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'localhost'
  ];
  return DEFAULT_HOSTS.includes(host);
}

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let profileData = null;

  // Resolve branding based on host first (Custom Domain)
  if (!isSystemHost(host)) {
    const { data } = await supabase.from('profiles').select('business_name, logo_url, role, agency_id').eq('custom_domain', host).single();
    profileData = data;
  } else if (user) {
    // If on platform domain, use logged in user context
    const { data: userProfile } = await supabase.from('profiles').select('business_name, logo_url, role, agency_id').eq('id', user.id).single();
    
    // If it's a client, we MUST show the Agency branding
    if (userProfile?.role === 'client' && userProfile.agency_id) {
      const { data: agencyProfile } = await supabase.from('profiles').select('business_name, logo_url').eq('id', userProfile.agency_id).single();
      profileData = agencyProfile;
    } else {
      profileData = userProfile;
    }
  }

  const defaultTitle = "Nobogent AI | Ultimate Marketing Automation for SMBs";
  const title = profileData?.business_name || defaultTitle;
  const logoVersion = profileData?.logo_url ? encodeURIComponent(profileData.logo_url.split('/').pop() || 'v1') : 'v1';
  const uidParam = user ? `&uid=${user.id}` : '';

  const iconUrl = profileData?.logo_url 
     ? `/api/org-icon?type=icon&v=${logoVersion}${uidParam}` 
     : "/icon-192x192.png?v=3";
     
  const faviconUrl = profileData?.logo_url 
     ? `/api/org-icon?type=favicon&v=${logoVersion}${uidParam}` 
     : "/favicon.ico?v=3";

  return {
    metadataBase: new URL(`https://${host}`),
    title: {
      default: title,
      template: `%s | ${defaultTitle}`
    },
    description: profileData?.business_name 
      ? `Welcome to ${title}. Manage your real estate leads and marketing automation effortlessly.` 
      : "Nobogent AI is the ultimate marketing automation platform for SMBs. Scale your Meta Ads, automate lead management, and grow your business with our agentic AI infrastructure.",
    // Manifest is injected manually into <head> below to allow dynamic params
    icons: {
      icon: faviconUrl,
      shortcut: faviconUrl,
      apple: iconUrl,
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: "default",
        title: title,
    },
    openGraph: {
      title: title,
      description: profileData?.business_name 
        ? `Scale your growth with ${title}. Professional real estate marketing automation.` 
        : "Nobogent AI - Automate your Meta Ads, lead management, and SMB growth with agentic AI infrastructure.",
      url: `https://${host}`,
      siteName: title,
      images: [{ url: iconUrl, width: 512, height: 512, alt: title }],
    },
  };
}

import { CapacitorBridge } from "@/components/CapacitorBridge";
import { CallTrackingListener } from "@/components/CallTrackingListener";

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};


import { Toaster } from "sonner";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  
  const headersList = await headers();
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let splashUrl = "/api/org-icon?type=splash"; 
  let manifestUrl = "/api/manifest";

  let brandingProfile = null;

  if (!isSystemHost(host)) {
     const { data } = await supabase.from('profiles').select('logo_url, role, agency_id').eq('custom_domain', host).single();
     brandingProfile = data;
  } else if (user) {
     const { data: userProfile } = await supabase.from('profiles').select('logo_url, role, agency_id').eq('id', user.id).single();
     
     // Resolve Agency Branding if user is a client
     if (userProfile?.role === 'client' && userProfile.agency_id) {
        const { data: agencyProfile } = await supabase.from('profiles').select('logo_url').eq('id', userProfile.agency_id).single();
        brandingProfile = agencyProfile;
     } else {
        brandingProfile = userProfile;
     }
  }

  if (brandingProfile?.logo_url) {
     const v = encodeURIComponent(brandingProfile.logo_url.split('/').pop() || 'v1');
     const uidParam = user ? `&uid=${user.id}` : '';
     
     splashUrl = `/api/org-icon?type=splash&v=${v}${uidParam}`;
     manifestUrl = `/api/manifest?v=${v}${uidParam}`; 
     
  } else if (user) {
     splashUrl = `/api/org-icon?type=splash&uid=${user.id}`;
     manifestUrl = `/api/manifest?uid=${user.id}`;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href={manifestUrl} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {/* Apple Touch Startup Images for major iOS device resolutions */}
        <link rel="apple-touch-startup-image" href={splashUrl} />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
        <link rel="apple-touch-startup-image" href={splashUrl} media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <CapacitorBridge />
        <CallTrackingListener />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}