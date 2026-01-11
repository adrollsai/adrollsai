import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const headersList = request.headers;
  // Robust host detection: handles Vercel proxies and ports
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(',')[0].trim().split(':')[0];

  console.log(`[Manifest API] Serving for host: ${host}`);

  // --- Default Manifest (AdRolls) ---
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
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };

  const SYSTEM_HOSTS = [
    'adrolls.in',
    'www.adrolls.in',
    'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];

  // Initialize with default
  let manifestData: any = defaultManifest;

  // --- Custom Domain Logic ---
  if (!SYSTEM_HOSTS.includes(host)) {
    try {
      const supabase = await createClient();
      // CHANGED: Fetch 'master_logo_url' to create a version hash
      const { data: org } = await supabase
        .from('organizations')
        .select('name, master_logo_url')
        .eq('custom_domain', host)
        .single();

      if (org) {
        // Create a short version hash from the logo URL to bust cache
        const logoVersion = org.master_logo_url ? encodeURIComponent(org.master_logo_url.split('/').pop() || 'v1') : 'v1';

        manifestData = {
          id: `/?org=${encodeURIComponent(org.name)}`,
          name: org.name || 'Partner App',
          short_name: org.name ? org.name.substring(0, 12) : 'Partner',
          description: `Welcome to ${org.name}`,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#FFFFFF',
          theme_color: '#FFFFFF',
          icons: [
            {
              // CHANGED: Appended version param
              src: `/api/org-icon?type=icon&v=${logoVersion}`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              // CHANGED: Appended version param
              src: `/api/org-icon?type=icon&v=${logoVersion}`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
          ],
        };
      }
    } catch (error) {
      console.error('[Manifest API] Error fetching organization:', error);
    }
  }

  return new NextResponse(JSON.stringify(manifestData), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}