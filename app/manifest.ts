import { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // 1. RESTORED AWAIT: This fixes the "Property 'get' does not exist on type 'Promise'..." error
  const headersList = await headers();
  
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const host = rawHost.split(':')[0];

  // Default Manifest
  const defaultManifest: MetadataRoute.Manifest = {
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

  if (SYSTEM_HOSTS.includes(host)) {
    return defaultManifest;
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
            // 2. KEEP THIS FIX: Cast to 'any' to avoid strict type checking on "any maskable"
            purpose: 'any maskable' as any 
          },
          {
            src: '/api/org-icon?type=icon',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable' as any
          },
        ],
      }
    }
  } catch (error) {
    console.error('Error generating dynamic manifest:', error);
  }

  return defaultManifest;
}