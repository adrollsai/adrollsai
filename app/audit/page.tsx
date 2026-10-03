import { Metadata } from 'next'
import { getCampaignBySlug } from '@/utils/gbp-audit-storage'
import AuditOnboardingClient from '@/components/gbp/AuditOnboardingClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Free Google Business Profile Audit & Local Rank Heatmap | Nobogent',
  description: 'Instant 60-second AI Google Business Profile audit. Discover 49-point geo-grid keyword rankings, competitor gaps, and estimated lost revenue.',
}

export default async function AuditDefaultPage() {
  const campaign = await getCampaignBySlug('nobogent')

  const effectiveCampaign = campaign || {
    id: 'default-nobogent',
    slug: 'nobogent',
    agency_name: 'Nobogent Local Growth AI',
    hero_title: 'Free Google Business Profile Audit & Local Rank Heatmap',
    hero_subtitle: 'Discover why competitors are outranking you on Google Maps, find your lost revenue, and get an AI action plan in 60 seconds.',
    cta_text: 'Schedule A Free Strategy Call',
    cta_url: 'https://wa.me/919872669935?text=Hi%2C%20I%20just%20ran%20my%20Google%20Business%20Profile%20Audit%20on%20Nobogent%20and%20want%20to%20fix%20my%20rankings',
    support_phone: '+91 98726 69935',
    support_email: 'support@nobogent.com',
    brand_color: '#2563EB',
    target_industry: 'General',
    enabled_modes: ['instant_search', 'google_oauth'],
  }

  return <AuditOnboardingClient campaign={effectiveCampaign} />
}
