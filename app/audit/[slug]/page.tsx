import { Metadata } from 'next'
import { getCampaignBySlug } from '@/utils/gbp-audit-storage'
import AuditOnboardingClient from '@/components/gbp/AuditOnboardingClient'

export const dynamic = 'force-dynamic'

interface AuditPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata(props: AuditPageProps): Promise<Metadata> {
  const { slug } = await props.params
  const campaign = await getCampaignBySlug(slug)

  const agencyName = campaign?.agency_name || 'Nobogent'

  return {
    title: `Free Google Business Profile Audit | ${agencyName}`,
    description: campaign?.hero_subtitle || 'Discover why competitors outrank you on Google Maps, find your missing revenue, and get an AI action plan in 60 seconds.',
    openGraph: {
      title: `Free Google Business Profile Audit & Geo-Grid Heatmap | ${agencyName}`,
      description: 'Get an instant AI local ranking audit and see where you rank across 49 coordinate checkpoints.',
    }
  }
}

export default async function AuditCampaignPage(props: AuditPageProps) {
  const { slug } = await props.params
  const campaign = await getCampaignBySlug(slug)

  const effectiveCampaign = campaign || {
    id: `dynamic-${slug}`,
    slug,
    agency_name: slug.toUpperCase(),
    hero_title: `Free Google Business Profile Audit & Local Rank Heatmap`,
    hero_subtitle: 'Discover why competitors are outranking you on Google Maps, find your lost revenue, and get an AI action plan in 60 seconds.',
    cta_text: 'Book A Free Strategy Call',
    brand_color: '#2563EB',
    target_industry: 'General',
    enabled_modes: ['instant_search', 'google_oauth'],
  }

  return <AuditOnboardingClient campaign={effectiveCampaign} />
}
