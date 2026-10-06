import React from 'react'
import ClientResultsPageClient from '@/components/ClientResultsPageClient'
import { metadata as resultsMetadata } from '@/app/results/page'

export const metadata = {
  ...resultsMetadata,
  alternates: {
    canonical: 'https://nobogent.com/client-results'
  }
}

export default function ClientResultsPage() {
  return <ClientResultsPageClient />
}
