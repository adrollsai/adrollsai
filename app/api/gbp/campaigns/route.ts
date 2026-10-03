import { NextResponse } from 'next/server'
import { getCampaignBySlug, saveCampaign, getAgencyAuditReports } from '@/utils/gbp-audit-storage'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const slug = searchParams.get('slug')
    const listReports = searchParams.get('reports') === 'true'

    // If specific campaign slug requested
    if (slug) {
      const campaign = await getCampaignBySlug(slug)
      const reports = listReports ? await getAgencyAuditReports(campaign?.user_id, slug) : []
      return NextResponse.json({ campaign, reports })
    }

    // Otherwise check authenticated user's campaign
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Try finding by user's id or email
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, business_name, logo_url, brand_color, contact_number, email, role')
      .eq('id', user.id)
      .single()

    const defaultSlug = (profile?.business_name || 'agency')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `agency-${user.id.slice(0, 6)}`

    let campaign = await getCampaignBySlug(defaultSlug)
    if (!campaign) {
      campaign = {
        id: crypto.randomUUID(),
        user_id: user.id,
        slug: defaultSlug,
        agency_name: profile?.business_name || 'My Agency',
        logo_url: profile?.logo_url || '',
        hero_title: `Free Google Business Profile Audit & Local Rank Heatmap`,
        hero_subtitle: `Discover why competitors outrank you on Google Maps and unlock massive local customer growth.`,
        cta_text: 'Book A Free Strategy Call',
        cta_url: '',
        support_phone: profile?.contact_number || '',
        support_email: profile?.email || user.email || '',
        brand_color: profile?.brand_color || '#2563EB',
        target_industry: 'General',
        enabled_modes: ['instant_search', 'google_oauth'],
      }
    }

    const reports = await getAgencyAuditReports(user.id, campaign.slug)

    return NextResponse.json({
      campaign,
      reports
    })
  } catch (err: any) {
    console.error('[GBP Campaigns API] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      slug,
      agency_name,
      logo_url,
      hero_title,
      hero_subtitle,
      cta_text,
      cta_url,
      support_phone,
      support_email,
      brand_color,
      target_industry,
      enabled_modes
    } = body

    if (!slug || !agency_name) {
      return NextResponse.json({ error: 'Slug and Agency Name are required' }, { status: 400 })
    }

    const saved = await saveCampaign({
      user_id: user.id,
      slug,
      agency_name,
      logo_url,
      hero_title,
      hero_subtitle,
      cta_text,
      cta_url,
      support_phone,
      support_email,
      brand_color,
      target_industry,
      enabled_modes
    })

    return NextResponse.json({
      success: true,
      campaign: saved
    })
  } catch (err: any) {
    console.error('[GBP Campaigns POST API] Error:', err)
    return NextResponse.json({ error: err.message || 'Failed to save campaign' }, { status: 500 })
  }
}
