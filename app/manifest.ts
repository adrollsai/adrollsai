// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/manifest.ts

import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
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
  }
}