import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const headersList = request.headers;
  // Robust host detection handling proxies and ports
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(',')[0].trim().split(':')[0];

  // --- 1. Default Manifest (AdRolls) ---
  const defaultManifest = {
    id: '/?source=pwa',
    name: 'AdRolls AI',
    short_name: 'AdRolls',
    description: 'Automate your real estate marketing',
    start_url: '/dashboard',
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

  // If system host, return default immediately
  if (SYSTEM_HOSTS.includes(host)) {
    return NextResponse.json(defaultManifest);
  }

  // --- 2. Dynamic Lookup for Custom Domains ---
  try {
    const supabase = await createClient();

    const { data: org } = await supabase
      .from('organizations')
      .select('name, master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (org) {
      const dynamicManifest = {
        id: `/?org=${encodeURIComponent(org.name)}`,
        name: org.name || 'Partner App',
        short_name: org.name ? org.name.substring(0, 12) : 'Partner',
        description: `Welcome to ${org.name}`,
        start_url: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        icons: [
          {
            src: '/api/org-icon?type=icon',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/api/org-icon?type=icon',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
        ],
      };
      return NextResponse.json(dynamicManifest);
    }
  } catch (error) {
    console.error('Error generating dynamic manifest:', error);
  }

  // Fallback to default if DB lookup fails
  return NextResponse.json(defaultManifest);
}