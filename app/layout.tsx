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

const IOS_STARTUP_IMAGES = [
  // iPhone 16 Pro Max, 15 Pro Max, 14 Pro Max (430x932 pt, @3x)
  { w: 1290, h: 2796, media: "screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone 16 Pro, 15 Pro, 14 Pro (393x852 pt, @3x)
  { w: 1179, h: 2556, media: "screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone 16 Plus, 15 Plus, 14 Plus, 13 Pro Max, 12 Pro Max (428x926 pt, @3x)
  { w: 1284, h: 2778, media: "screen and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone 16, 15, 14, 13, 13 Pro, 12, 12 Pro (390x844 pt, @3x)
  { w: 1170, h: 2532, media: "screen and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone 13 mini, 12 mini, 11 Pro, XS, X (375x812 pt, @3x)
  { w: 1125, h: 2436, media: "screen and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone 11 Pro Max, XS Max (414x896 pt, @3x)
  { w: 1242, h: 2688, media: "screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone 11, XR (414x896 pt, @2x)
  { w: 828, h: 1792, media: "screen and (device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  // iPhone 8 Plus, 7 Plus, 6s Plus (414x736 pt, @3x)
  { w: 1242, h: 2208, media: "screen and (device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
  // iPhone SE (2nd/3rd gen), 8, 7, 6s (375x667 pt, @2x)
  { w: 750, h: 1334, media: "screen and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  // 12.9" iPad Pro (1024x1366 pt, @2x)
  { w: 2048, h: 2732, media: "screen and (device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  // 11" iPad Pro, iPad Air (834x1194 pt, @2x)
  { w: 1668, h: 2388, media: "screen and (device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
  // 10.9" iPad, 10.2" iPad (810x1080 pt, @2x)
  { w: 1620, h: 2160, media: "screen and (device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
];

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#FFFFFF" },
  ],
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

  const getSplashUrl = (w: number, h: number) => {
    const sep = splashUrl.includes('?') ? '&' : '?';
    return `${splashUrl}${sep}w=${w}&h=${h}`;
  };

  return (
    <html lang="en" className="bg-white" style={{ backgroundColor: '#FFFFFF', colorScheme: 'light' }} suppressHydrationWarning>
      <head>
        <link rel="manifest" href={manifestUrl} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Nobogent" />
        <meta name="theme-color" content="#FFFFFF" />
        <meta name="color-scheme" content="light" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                background-color: #FFFFFF !important;
                color-scheme: light !important;
              }
            `,
          }}
        />
        {/* Apple Touch Startup Images for major iOS device resolutions */}
        <link rel="apple-touch-startup-image" href={getSplashUrl(1170, 2532)} />
        {IOS_STARTUP_IMAGES.map((img, idx) => (
          <link
            key={idx}
            rel="apple-touch-startup-image"
            href={getSplashUrl(img.w, img.h)}
            media={img.media}
          />
        ))}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                var isLocal = window.location.hostname === 'local.nobogent.com' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                if (isLocal && 'serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    for (var r of regs) { r.unregister(); }
                  });
                  if ('caches' in window) {
                    caches.keys().then(function(names) {
                      for (var name of names) { caches.delete(name); }
                    });
                  }
                }
                window.addEventListener('error', function(e) {
                  if (e && (e.message && e.message.indexOf('Loading chunk') !== -1 || (e.error && e.error.name === 'ChunkLoadError'))) {
                    if (!sessionStorage.getItem('chunk_retry')) {
                      sessionStorage.setItem('chunk_retry', '1');
                      window.location.reload();
                    }
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body className={`${inter.className} bg-white text-slate-900`} style={{ backgroundColor: '#FFFFFF' }} suppressHydrationWarning>
        <CapacitorBridge />
        <CallTrackingListener />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}