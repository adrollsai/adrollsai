import React from 'react'
import LandingPageClient from '@/components/LandingPageClient'

export const metadata = {
   title: 'Nobogent - Your First AI Marketing Employee',
   description: 'Bypass cookie blockers, auto-design ad graphics, and launch Meta Ads using server-side Conversions API (CAPI) with Nobogent—the ultimate AI marketing engine for SMBs.',
   keywords: [
      'nobogent', 'nobogent.com', 'AI marketing', 'landing page generator', 
      'Meta ads automation', 'Conversions API Next.js', 'CAPI leads generation',
      'marketing suite for SMBs'
   ],
   alternates: {
      canonical: 'https://nobogent.com'
   },
   openGraph: {
      title: 'Nobogent - Your First AI Marketing Employee',
      description: 'Launch high-converting landing pages and CAPI-optimized Meta Ads on autopilot.',
      url: 'https://nobogent.com',
      siteName: 'Nobogent',
      images: [
         {
            url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1778143153926.png',
            width: 1200,
            height: 630,
            alt: 'Nobogent AI Marketing Suite'
         }
      ],
      locale: 'en_US',
      type: 'website'
   }
}

export default function LandingPage() {
   return <LandingPageClient />
}