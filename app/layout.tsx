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

  if (!isSystemHost(host)) {
    const { data } = await supabase.from('profiles').select('business_name, logo_url').eq('custom_domain', host).single();
    profileData = data;
  } else if (user) {
    const { data } = await supabase.from('profiles').select('business_name, logo_url').eq('id', user.id).single();
    profileData = data;
  }

  const defaultTitle = "AdRolls AI | Ultimate Marketing Automation for SMBs";
  const title = profileData?.business_name || defaultTitle;
  const logoVersion = profileData?.logo_url ? encodeURIComponent(profileData.logo_url.split('/').pop() || 'v1') : 'v1';
  const uidParam = user ? `&uid=${user.id}` : '';

  const iconUrl = profileData?.logo_url 
     ? `/api/org-icon?type=icon&v=${logoVersion}${uidParam}` 
     : "/icon-192x192.png";
     
  const faviconUrl = profileData?.logo_url 
     ? `/api/org-icon?type=favicon&v=${logoVersion}${uidParam}` 
     : "/favicon.ico";

  return {
    metadataBase: new URL(`https://${host}`),
    title: {
      default: title,
      template: `%s | ${defaultTitle}`
    },
    description: profileData?.business_name 
      ? `Welcome to ${title}. Manage your real estate leads and marketing automation effortlessly.` 
      : "AdRolls AI is the ultimate marketing automation platform for SMBs. Scale your Meta Ads, automate lead management, and grow your business with our agentic AI infrastructure.",
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
        : "AdRolls AI - Automate your Meta Ads, lead management, and SMB growth with agentic AI infrastructure.",
      url: `https://${host}`,
      siteName: title,
      images: [{ url: iconUrl, width: 512, height: 512, alt: title }],
    },
  };
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
  
  const headersList = await headers();
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let splashUrl = "/api/org-icon?type=splash"; 
  let manifestUrl = "/api/manifest";

  let profileData = null;

 // THE FIX: Fetch profile data if custom domain OR if user is logged in!
  if (!isSystemHost(host)) {
     const { data } = await supabase.from('profiles').select('logo_url').eq('custom_domain', host).single();
     profileData = data;
  } else if (user) {
     const { data } = await supabase.from('profiles').select('logo_url').eq('id', user.id).single();
     profileData = data;
  }

  if (profileData?.logo_url) {
     const v = encodeURIComponent(profileData.logo_url.split('/').pop() || 'v1');
     const uidParam = user ? `&uid=${user.id}` : '';
     
     splashUrl = `/api/org-icon?type=splash&v=${v}${uidParam}`;
     // FIXED: Just use the uidParam we already safely created!
     manifestUrl = `/api/manifest?v=${v}${uidParam}`; 
     
  } else if (user) {
     // Even if no custom logo is uploaded, pass UID so it processes the default icon perfectly
     splashUrl = `/api/org-icon?type=splash&uid=${user.id}`;
     manifestUrl = `/api/manifest?uid=${user.id}`;
  }

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href={manifestUrl} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {/* iOS Splash Screen: Dynamically points to the Sharp image processor */}
        <link rel="apple-touch-startup-image" href={splashUrl} />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}