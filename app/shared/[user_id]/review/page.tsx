import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import ReviewGatingClient from '@/components/gbp/ReviewGatingClient'
import { getGBPOptimizationData } from '@/utils/gbp-suite-storage'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ user_id: string }>
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function generateMetadata({ params }: PageProps) {
  const { user_id } = await params
  const cleanId = decodeURIComponent(user_id || '').trim()

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('business_name, full_name')
    .or(`id.eq.${cleanId},custom_domain.eq.${cleanId}`)
    .maybeSingle()

  const name = profile?.business_name || profile?.full_name || 'Customer Review'

  return {
    title: `Review ${name} | Share Your Experience`,
    description: `Leave your feedback and rate your experience with ${name}.`
  }
}

export default async function SharedCustomDomainReviewPage({ params }: PageProps) {
  const { user_id } = await params
  const cleanId = decodeURIComponent(user_id || '').trim()

  // Resolve business by ID or custom domain
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, full_name, logo_url, brand_color, google_place_id, google_review_url, custom_domain')
    .or(`id.eq.${cleanId},custom_domain.eq.${cleanId}`)
    .maybeSingle()

  if (!profile) {
    notFound()
  }

  const suiteData = await getGBPOptimizationData(profile.id)

  const businessName = profile.business_name || profile.full_name || 'Our Business'
  const placeId = profile.google_place_id || suiteData?.place_id || ''
  const googleReviewUrl = profile.google_review_url || suiteData?.google_review_url || (placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : '')

  return (
    <ReviewGatingClient
      businessId={profile.id}
      businessName={businessName}
      logoUrl={profile.logo_url}
      brandColor={profile.brand_color || '#2563EB'}
      placeId={placeId}
      googleReviewUrl={googleReviewUrl}
    />
  )
}
