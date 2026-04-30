// app/api/manifest/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get('uid');

  const headersList = request.headers;
  // Get the host accurately, handling proxies and local development
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(',')[0].trim().split(':')[0].toLowerCase();

  // 1. Define Primary AdRolls Hosts
  const SYSTEM_HOSTS = [
    'adrolls.in', 
    'www.adrolls.in', 
    'app.adrolls.in',
    'localhost'
  ];

  // 2. Official AdRolls Branding Configuration
  // We point to the org-icon API which now uses the https://i.ibb.co/jvxK1B96/logo.png link
  const ADROLLS_LOGO_VERSION = 'v2_centered'; 
  
  const defaultManifest = {
    id: '/?source=adrolls_pwa',
    name: 'AdRolls AI',
    short_name: 'AdRolls',
    description: 'AI-Powered Real Estate Marketing',
    start_url: '/dashboard', // SaaS users start at the dashboard
    scope: '/',
    display: 'standalone',
    background_color: '#F8FAFC',
    theme_color: '#2563EB',
    icons: [
      { 
        src: `/api/org-icon?type=icon&v=${ADROLLS_LOGO_VERSION}`, 
        sizes: '512x512', 
        type: 'image/png',
        purpose: 'any maskable' // Fixes splash screen centering on mobile
      },
      { 
        src: `/api/org-icon?type=icon&v=${ADROLLS_LOGO_VERSION}`, 
        sizes: '192x192', 
        type: 'image/png',
        purpose: 'any maskable'
      },
    ],
  };

  const isPrimaryDomain = SYSTEM_HOSTS.includes(host);

  // 3. LOGIC: If on primary AdRolls domains, return the official manifest immediately
  if (isPrimaryDomain) {
    return new NextResponse(JSON.stringify(defaultManifest), {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'public, max-age=3600', 
      },
    });
  }

  // 4. Custom Domain Logic (Only reached for external domains)
  let manifestData = defaultManifest;

  try {
    const supabase = await createClient();
    
    // Fetch user-specific branding based on the custom domain
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, logo_url')
      .eq('custom_domain', host)
      .single();

    if (profile) {
      const businessName = profile.business_name || 'Marketing Portal';
      const logoVersion = profile.logo_url 
        ? encodeURIComponent(profile.logo_url.split('/').pop() || 'v1') 
        : 'v1';
      
      manifestData = {
        id: `/?org=${encodeURIComponent(host)}`,
        name: businessName,
        short_name: businessName.substring(0, 12), 
        description: `Official portal for ${businessName}`,
        start_url: '/', // Custom domains start at the root landing page
        scope: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#000000',
        icons: [
          { 
            src: `/api/org-icon?type=icon&v=${logoVersion}`, 
            sizes: '512x512', 
            type: 'image/png', 
            purpose: 'any maskable' 
          },
          { 
            src: `/api/org-icon?type=icon&v=${logoVersion}`, 
            sizes: '192x192', 
            type: 'image/png', 
            purpose: 'any maskable' 
          },
        ],
      };
    }
  } catch (error) {
    console.error('[Manifest API] Error fetching profile:', error);
  }

  return new NextResponse(JSON.stringify(manifestData), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}