import { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'

// 1. FORCE DYNAMIC: Prevents Next.js from caching the manifest at build time
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const headersList = await headers();
  
  // 2. CRITICAL FIX: Check 'x-forwarded-host' first (preserved by Middleware)
  // If we just check 'host', we might see the internal Vercel URL, not the Custom Domain.
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  
  // 3. Clean the host (remove port number if present, e.g. "localhost:3000" -> "localhost")
  const host = rawHost.split(':')[0];

  // Default "System" Manifest (AdRolls)
  const defaultManifest: MetadataRoute.Manifest = {
    name: 'AdRolls AI',
    short_name: 'AdRolls',
    description: 'Keep your ads rolling...',
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

  // Define System Hosts (where we always show AdRolls branding)
  const SYSTEM_HOSTS = [
    'adrolls.in',
    'www.adrolls.in',
    'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];

  // If it is a known AdRolls domain, return the default manifest
  if (SYSTEM_HOSTS.includes(host)) {
    return defaultManifest;
  }

  // Dynamic Lookup for Custom Domains
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
        start_url: '/dashboard',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF', 
        icons: [
          {
            // Point to our dynamic proxy route
            src: '/api/org-icon?type=icon', 
            sizes: '512x512', 
            type: 'image/png',
          },
          {
            src: '/api/org-icon?type=icon',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      }
    }
  } catch (error) {
    console.error('Error generating dynamic manifest:', error);
  }

  // Fallback to default if anything fails or no org found
  return defaultManifest;
}