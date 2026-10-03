import { createClient } from '@supabase/supabase-js'

const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase URL or Key is missing')
  }
  return createClient(url, key)
}

export interface GBPAuditCampaign {
  id: string
  user_id?: string
  slug: string
  agency_name: string
  logo_url?: string
  hero_title?: string
  hero_subtitle?: string
  cta_text?: string
  cta_url?: string
  support_phone?: string
  support_email?: string
  brand_color?: string
  target_industry?: string
  enabled_modes?: string[]
  created_at?: string
  updated_at?: string
}

export interface GBPAuditReport {
  id: string
  campaign_id?: string
  agency_user_id?: string
  campaign_slug?: string
  business_name: string
  place_id?: string
  address?: string
  phone?: string
  website?: string
  primary_category?: string
  secondary_categories?: string[]
  latitude?: number
  longitude?: number
  rating?: number
  reviews_count?: number
  lead_name?: string
  lead_email?: string
  lead_phone?: string
  overall_score: number
  score_grade: string
  estimated_monthly_loss: number
  currency: string
  executive_summary: string
  checklist_items: Array<{
    id: string
    title: string
    status: 'pass' | 'warning' | 'fail'
    score: number
    description: string
    recommendation: string
    details?: string
  }>
  competitors: Array<{
    name: string
    rating: number
    reviewsCount: number
    rank: number
    distanceKm: number
    photoUrl?: string
    address?: string
    advantage?: string
  }>
  action_plan: {
    highPriority: Array<{ title: string; description: string; impact: string }>
    mediumPriority: Array<{ title: string; description: string; impact: string }>
    lowPriority: Array<{ title: string; description: string; impact: string }>
    aiSuggestedDescription?: string
    recommendedCategories?: string[]
    suggestedPost?: {
      title: string
      content: string
      callToAction: string
    }
    reviewReplyTemplates?: {
      positive: string
      neutralOrNegative: string
    }
  }
  target_keywords: Array<{
    keyword: string
    searchVolume?: number
    averageRank: number
    top3Count: number
    rankStatus: 'dominating' | 'competitive' | 'lost'
  }>
  heatmaps: Record<string, {
    keyword: string
    center: { lat: number; lng: number }
    radiusKm: number
    gridSize: number
    averageRank: number
    top3SharePercent: number
    pins: Array<{
      id: string
      lat: number
      lng: number
      rank: number
      distanceKm: number
      competitorAhead?: string
    }>
  }>
  google_access_token?: string
  google_refresh_token?: string
  google_account_id?: string
  google_location_id?: string
  share_token: string
  status?: string
  created_at?: string
}

// In-memory fallback cache for fast recovery or development
const reportCache = new Map<string, GBPAuditReport>()
const campaignCache = new Map<string, GBPAuditCampaign>()

export async function getCampaignBySlug(slug: string): Promise<GBPAuditCampaign | null> {
  const cleanSlug = slug.trim().toLowerCase()
  if (campaignCache.has(cleanSlug)) {
    return campaignCache.get(cleanSlug)!
  }

  const supabase = getSupabaseAdmin()

  // 1. Try first-class gbp_audit_campaigns table
  try {
    const { data, error } = await supabase
      .from('gbp_audit_campaigns')
      .select('*')
      .eq('slug', cleanSlug)
      .maybeSingle()

    if (!error && data) {
      campaignCache.set(cleanSlug, data)
      return data as GBPAuditCampaign
    }
  } catch {
    // Continue to fallback
  }

  // 2. Check profile whitelabel / agency settings
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, business_name, logo_url, brand_color, contact_number, email')
      .or(`whitelabel_domain.eq.${cleanSlug},id.eq.${cleanSlug}`)
      .maybeSingle()

    if (profile) {
      const derived: GBPAuditCampaign = {
        id: profile.id,
        user_id: profile.id,
        slug: cleanSlug,
        agency_name: profile.business_name || 'Nobogent Agency Partner',
        logo_url: profile.logo_url || '',
        hero_title: `Free Google Business Profile Audit by ${profile.business_name || 'Nobogent'}`,
        hero_subtitle: 'Discover why competitors outrank you on Google Maps and how to unlock massive local customer growth.',
        cta_text: 'Schedule Growth Consultation',
        cta_url: '',
        support_phone: profile.contact_number || '',
        support_email: profile.email || '',
        brand_color: profile.brand_color || '#2563EB',
        target_industry: 'General',
        enabled_modes: ['instant_search', 'google_oauth'],
      }
      campaignCache.set(cleanSlug, derived)
      return derived
    }
  } catch {
    // Continue
  }

  // 3. Fallback to landing_pages storage adapter
  try {
    const { data: lp } = await supabase
      .from('landing_pages')
      .select('*')
      .eq('product_name', 'gbp_audit_campaign')
      .eq('slug', cleanSlug)
      .maybeSingle()

    if (lp && lp.html_content) {
      const parsed = JSON.parse(lp.html_content) as GBPAuditCampaign
      campaignCache.set(cleanSlug, parsed)
      return parsed
    }
  } catch {
    // Continue
  }

  // Default campaign for Nobogent
  if (cleanSlug === 'nobogent' || cleanSlug === 'default') {
    const defaultCamp: GBPAuditCampaign = {
      id: 'default-nobogent',
      slug: 'nobogent',
      agency_name: 'Nobogent Local Growth AI',
      hero_title: 'Free Google Business Profile Audit & Local Rank Heatmap',
      hero_subtitle: 'Discover why competitors are outranking you on Google Maps, find your missing revenue, and get an AI-powered action plan in 60 seconds.',
      cta_text: 'Schedule A Free Strategy Call',
      cta_url: 'https://wa.me/919872669935?text=Hi%2C%20I%20just%20ran%20my%20Google%20Business%20Profile%20Audit%20on%20Nobogent%20and%20want%20to%20fix%20my%20rankings',
      support_phone: '+91 98726 69935',
      support_email: 'support@nobogent.com',
      brand_color: '#2563EB',
      target_industry: 'General',
      enabled_modes: ['instant_search', 'google_oauth'],
    }
    campaignCache.set(cleanSlug, defaultCamp)
    return defaultCamp
  }

  return null
}

export async function saveCampaign(campaign: Partial<GBPAuditCampaign> & { slug: string; agency_name: string }): Promise<GBPAuditCampaign> {
  const supabase = getSupabaseAdmin()
  const cleanSlug = campaign.slug.trim().toLowerCase()

  const payload: GBPAuditCampaign = {
    id: campaign.id || crypto.randomUUID(),
    user_id: campaign.user_id,
    slug: cleanSlug,
    agency_name: campaign.agency_name,
    logo_url: campaign.logo_url || '',
    hero_title: campaign.hero_title || 'Get Your Free Google Business Profile & Local Ranking Audit',
    hero_subtitle: campaign.hero_subtitle || 'Discover why competitors are outranking you on Google Maps, find your lost revenue, and get an AI-powered roadmap in 60 seconds.',
    cta_text: campaign.cta_text || 'Book A Free Strategy Call',
    cta_url: campaign.cta_url || '',
    support_phone: campaign.support_phone || '',
    support_email: campaign.support_email || '',
    brand_color: campaign.brand_color || '#2563EB',
    target_industry: campaign.target_industry || 'General',
    enabled_modes: campaign.enabled_modes || ['instant_search', 'google_oauth'],
    updated_at: new Date().toISOString()
  }

  // 1. Try first-class gbp_audit_campaigns table
  try {
    const { data, error } = await supabase
      .from('gbp_audit_campaigns')
      .upsert(payload, { onConflict: 'slug' })
      .select()
      .single()

    if (!error && data) {
      campaignCache.set(cleanSlug, data)
      return data as GBPAuditCampaign
    }
  } catch {
    // Fallback below
  }

  // 2. Fallback to landing_pages
  try {
    const { data: existing } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('product_name', 'gbp_audit_campaign')
      .eq('slug', cleanSlug)
      .maybeSingle()

    if (existing) {
      await supabase.from('landing_pages').update({
        title: campaign.agency_name,
        html_content: JSON.stringify(payload),
        updated_at: new Date().toISOString()
      }).eq('id', existing.id)
    } else {
      await supabase.from('landing_pages').insert({
        slug: cleanSlug,
        title: campaign.agency_name,
        product_name: 'gbp_audit_campaign',
        user_id: campaign.user_id,
        html_content: JSON.stringify(payload),
        updated_at: new Date().toISOString()
      })
    }
  } catch (err) {
    console.warn('[GBP Storage] Fallback save campaign error:', err)
  }

  campaignCache.set(cleanSlug, payload)
  return payload
}

export async function getAuditReport(tokenOrId: string): Promise<GBPAuditReport | null> {
  const key = tokenOrId.trim()
  if (reportCache.has(key)) {
    return reportCache.get(key)!
  }

  const supabase = getSupabaseAdmin()

  // 1. Try first-class gbp_audit_reports table
  try {
    const { data, error } = await supabase
      .from('gbp_audit_reports')
      .select('*')
      .or(`share_token.eq.${key},id.eq.${key}`)
      .maybeSingle()

    if (!error && data) {
      reportCache.set(data.share_token, data)
      reportCache.set(data.id, data)
      return data as GBPAuditReport
    }
  } catch {
    // Continue
  }

  // 2. Fallback to landing_pages
  try {
    const { data: lp } = await supabase
      .from('landing_pages')
      .select('*')
      .eq('product_name', 'gbp_audit_report')
      .eq('slug', key)
      .maybeSingle()

    if (lp && lp.html_content) {
      const parsed = JSON.parse(lp.html_content) as GBPAuditReport
      reportCache.set(parsed.share_token, parsed)
      reportCache.set(parsed.id, parsed)
      return parsed
    }
  } catch {
    // Continue
  }

  return null
}

export async function saveAuditReport(report: GBPAuditReport): Promise<GBPAuditReport> {
  const supabase = getSupabaseAdmin()
  const payload = {
    ...report,
    updated_at: new Date().toISOString()
  }

  // 1. Try first-class gbp_audit_reports table
  try {
    const { data, error } = await supabase
      .from('gbp_audit_reports')
      .upsert(payload, { onConflict: 'share_token' })
      .select()
      .single()

    if (!error && data) {
      reportCache.set(data.share_token, data)
      reportCache.set(data.id, data)
      return data as GBPAuditReport
    }
  } catch {
    // Continue
  }

  // 2. Fallback to landing_pages
  try {
    const { data: existing } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('product_name', 'gbp_audit_report')
      .eq('slug', payload.share_token)
      .maybeSingle()

    if (existing) {
      await supabase.from('landing_pages').update({
        title: payload.business_name,
        html_content: JSON.stringify(payload),
        updated_at: new Date().toISOString()
      }).eq('id', existing.id)
    } else {
      await supabase.from('landing_pages').insert({
        slug: payload.share_token,
        title: payload.business_name,
        product_name: 'gbp_audit_report',
        user_id: payload.agency_user_id || undefined,
        html_content: JSON.stringify(payload),
        updated_at: new Date().toISOString()
      })
    }
  } catch (err) {
    console.warn('[GBP Storage] Fallback save report error:', err)
  }

  reportCache.set(payload.share_token, payload)
  reportCache.set(payload.id, payload)
  return payload
}

export async function getAgencyAuditReports(agencyUserId?: string, campaignSlug?: string): Promise<GBPAuditReport[]> {
  const supabase = getSupabaseAdmin()

  // 1. Try gbp_audit_reports table
  try {
    let query = supabase.from('gbp_audit_reports').select('*').order('created_at', { ascending: false })
    if (agencyUserId) query = query.eq('agency_user_id', agencyUserId)
    if (campaignSlug) query = query.eq('campaign_slug', campaignSlug)

    const { data, error } = await query.limit(50)
    if (!error && data && data.length > 0) {
      return data as GBPAuditReport[]
    }
  } catch {
    // Fallback
  }

  // 2. Fallback to landing_pages
  try {
    let query = supabase.from('landing_pages').select('*').eq('product_name', 'gbp_audit_report').order('created_at', { ascending: false })
    if (agencyUserId) query = query.eq('user_id', agencyUserId)

    const { data } = await query.limit(50)
    if (data && data.length > 0) {
      return data.map(item => {
        try {
          return JSON.parse(item.html_content) as GBPAuditReport
        } catch {
          return null
        }
      }).filter(Boolean) as GBPAuditReport[]
    }
  } catch {
    // Continue
  }

  // 3. Fallback to cached items
  const cached = Array.from(reportCache.values())
  if (campaignSlug) {
    return cached.filter(r => r.campaign_slug === campaignSlug)
  }
  return cached
}
