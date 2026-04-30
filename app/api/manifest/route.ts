// app/api/manifest/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get('uid');

  const headersList = request.headers;
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
  
  const isLocal = host === 'localhost';

  const SYSTEM_HOSTS = [
    'adrolls.in', 
    'www.adrolls.in', 
    'app.adrolls.in',
    'localhost'
  ];

  // Updated version string to bust your browser's stubborn cache
  const ADROLLS_LOGO_VERSION = 'v3_cachebuster'; 
  
  const defaultManifest = {
    id: '/?source=adrolls_pwa',
    name: 'AdRolls AI',
    short_name: 'AdRolls',
    description: 'AI-Powered Real Estate Marketing',
    start_url: '/dashboard', 
    scope: '/',
    display: 'standalone',
    background_color: '#FFFFFF', // Changed to white to match your splash background
    theme_color: '#2563EB',
    icons: [
      { 
        src: `/api/org-icon?type=icon&v=${ADROLLS_LOGO_VERSION}`, 
        sizes: '512x512', 
        type: 'image/png',
        purpose: 'any maskable' 
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

  if (isPrimaryDomain) {
    return new NextResponse(JSON.stringify(defaultManifest), {
      headers: {
        'Content-Type': 'application/manifest+json',
        // If on localhost, never cache. If in production, cache for 1 hour.
        'Cache-Control': isLocal ? 'no-store' : 'public, max-age=3600', 
      },
    });
  }

  let manifestData = defaultManifest;

  try {
    const supabase = await createClient();
    
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
        start_url: '/', 
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