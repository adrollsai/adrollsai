import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get('uid');

  const headersList = request.headers;
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(',')[0].trim().split(':')[0];

  const defaultManifest = {
    id: '/?source=pwa_default',
    name: 'AdRolls AI',
    short_name: 'AdRolls',
    description: 'Automate your real estate marketing',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#F8F9FF',
    theme_color: '#D0E8FF',
    icons: [
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
  };

  const SYSTEM_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'localhost'
  ];

  let manifestData: any = defaultManifest;

  try {
    const supabase = await createClient();
    let profileData = null;

    // THE FIX: Check UID first so logged-in users get custom manifests!
    if (!SYSTEM_HOSTS.includes(host)) {
      const { data } = await supabase.from('profiles').select('business_name, logo_url').eq('custom_domain', host).single();
      profileData = data;
    } else if (uid) {
      const { data } = await supabase.from('profiles').select('business_name, logo_url').eq('id', uid).single();
      profileData = data;
    }

    if (profileData) {
      const logoVersion = profileData.logo_url ? encodeURIComponent(profileData.logo_url.split('/').pop() || 'v1') : 'v1';
      const businessName = profileData.business_name || 'AdRolls App';
      const uidParam = uid ? `&uid=${uid}` : '';

      manifestData = {
        id: `/?org=${encodeURIComponent(businessName)}`,
        name: businessName,
        short_name: businessName.substring(0, 12),
        description: `Welcome to ${businessName}`,
        start_url: '/dashboard',
        scope: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        icons: [
          { src: `/api/org-icon?type=icon&v=${logoVersion}${uidParam}`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: `/api/org-icon?type=icon&v=${logoVersion}${uidParam}`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
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