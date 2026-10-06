import React from 'react'
import ClientResultsPageClient from '@/components/ClientResultsPageClient'

export const metadata = {
  title: 'Client Results & Real Estate Case Studies | Nobogent AI',
  description: 'See how Red Rose City, Blue Square Infra, The Khushi Ram Realtors, and Bioque Estates generated 26,000+ verified inquiries, 1,000+ site visits, and 50+ direct "Connect with Expert" bookings with Nobogent.',
  keywords: [
    'nobogent results',
    'real estate case studies',
    'real estate meta ads results',
    'red rose city dera bassi plots',
    'blue square infra',
    'the khushi ram realtors',
    'bioque estates international',
    'real estate whatsapp lead qualification',
    'real estate site visits marketing'
  ],
  alternates: {
    canonical: 'https://nobogent.com/results'
  },
  openGraph: {
    title: 'Client Results: 26,000+ Real Estate Inquiries & 1,000+ Site Visits | Nobogent',
    description: 'Explore live CRM proof and verified performance benchmarks from leading real estate developers and advisors.',
    url: 'https://nobogent.com/results',
    siteName: 'Nobogent',
    images: [
      {
        url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1778143153926.png',
        width: 1200,
        height: 630,
        alt: 'Nobogent Client Results & Case Studies'
      }
    ],
    locale: 'en_US',
    type: 'website'
  }
}

export default function ResultsPage() {
  return <ClientResultsPageClient />
}
