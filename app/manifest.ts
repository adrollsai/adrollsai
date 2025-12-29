// app/manifest.ts

import { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
 
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const headersList = await headers();
  const host = headersList.get('host') || '';

  // Default Manifest Configuration
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

  // Define System Hosts
  const DEFAULT_HOSTS = [
    'adrolls.in',
    'www.adrolls.in',
    'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];

  // If localhost or default host, return default manifest
  if (host.includes('localhost') || host.includes('127.0.0.1') || DEFAULT_HOSTS.includes(host)) {
    return defaultManifest;
  }

  try {
    const supabase = await createClient();

    // Look for organization with this custom domain
    const { data: org } = await supabase
      .from('organizations')
      .select('name, master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (org) {
      // Return Dynamic Manifest for the Organization
      return {
        name: org.name || 'Partner App',
        short_name: org.name ? org.name.substring(0, 12) : 'Partner',
        description: `Welcome to ${org.name}`,
        start_url: '/dashboard',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF', // You might want to fetch brand_color from DB if available
        icons: [
          {
            // Point to our dynamic proxy route
            src: '/api/org-icon?type=icon', 
            sizes: '512x512', // We assume the proxy serves a high-res image suitable for both
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

  // Fallback to default if anything fails
  return defaultManifest;
}