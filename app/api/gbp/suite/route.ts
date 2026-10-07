import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getGBPOptimizationData, saveGBPOptimizationData, GBPOptimizationData } from '@/utils/gbp-suite-storage'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')

    // Determine target profile ID (with impersonation permission check)
    let targetUserId = user.id
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, agency_id, business_name, email')
      .eq('id', user.id)
      .single()

    const callerRole = callerProfile?.role?.toLowerCase() || 'admin'

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(callerRole)) {
      if (callerRole === 'super_admin' || callerProfile?.email === 'rchopra489@gmail.com') {
        targetUserId = impersonateId
      } else {
        // Agency can impersonate its own client accounts
        const { data: subAccount } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', impersonateId)
          .or(`agency_id.eq.${user.id},parent_id.eq.${user.id}`)
          .maybeSingle()

        if (subAccount) {
          targetUserId = impersonateId
        } else {
          return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
        }
      }
    } else if (callerProfile?.parent_id) {
      targetUserId = callerProfile.parent_id
    }

    // Fetch target business profile
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, business_name, full_name, address, contact_number, brand_color, logo_url, custom_domain, whitelabel_domain, business_info, google_business_token, google_business_refresh_token, google_business_location_id, google_place_id, google_review_url, role')
      .eq('id', targetUserId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'Target profile not found' }, { status: 404 })
    }

    let bi: any = {}
    if (targetProfile.business_info) {
      try {
        bi = typeof targetProfile.business_info === 'string' ? JSON.parse(targetProfile.business_info) : targetProfile.business_info
      } catch {}
    }

    // Load existing GBP suite data or compute default health analysis
    let suiteData = await getGBPOptimizationData(targetUserId)

    const businessName = targetProfile.business_name || targetProfile.full_name || 'My Business'
    const address = targetProfile.address || bi.address || ''
    const phone = targetProfile.contact_number || bi.phone || ''
    const placeId = targetProfile.google_place_id || bi.google_place_id || ''
    const customDomain = targetProfile.custom_domain || ''

    // If no existing suite data, initialize with baseline evaluation
    if (!suiteData) {
      const hasPhone = Boolean(phone && phone.trim().length >= 7)
      const hasAddress = Boolean(address && address.trim().length > 5)
      const hasPlaceId = Boolean(placeId)
      const hasDescription = Boolean(bi.bio && bi.bio.trim().length > 50)
      const isConnected = Boolean(targetProfile.google_business_location_id || targetProfile.google_business_token || placeId)

      const shortcomings: GBPOptimizationData['shortcomings'] = [
        {
          id: 'nap_name_address_phone',
          category: 'nap',
          title: 'NAP Consistency (Name, Address, Phone)',
          status: hasPhone && hasAddress ? 'pass' : hasPhone || hasAddress ? 'warning' : 'fail',
          impact: 'high',
          current_state: hasPhone && hasAddress ? `Valid phone (${phone}) and address (${address}) configured.` : 'Incomplete business address or phone number in profile.',
          recommendation: 'Ensure your business name, exact physical address, and phone number match everywhere online to build Google Maps trust.',
          action_type: 'manual_step'
        },
        {
          id: 'category_optimization',
          category: 'categories',
          title: 'Primary & Secondary Google Categories',
          status: 'warning',
          impact: 'high',
          current_state: 'Standard primary category set. Missing high-intent secondary categories.',
          recommendation: 'Add 3-5 specific secondary categories (e.g. Real Estate Consultant, Commercial Real Estate Agency) to appear in 40% more search queries.',
          action_type: 'ai_fix'
        },
        {
          id: 'business_description_seo',
          category: 'description',
          title: 'Local SEO Description (750 Chars)',
          status: hasDescription ? 'warning' : 'fail',
          impact: 'high',
          current_state: hasDescription ? 'Basic description present but lacks localized target keywords.' : 'Missing keyword-optimized Google Business Profile description.',
          recommendation: 'Use all 750 characters embedding your top local service keywords, city/neighborhood landmarks, and a clear call to action.',
          action_type: 'ai_fix'
        },
        {
          id: 'google_posts_freshness',
          category: 'posts',
          title: 'Weekly Google Business Profile Posts',
          status: 'fail',
          impact: 'medium',
          current_state: 'No recent Google Updates or Offers published in the last 7 days.',
          recommendation: 'Publish at least 1-2 Google Posts per week with photos and a "Book" or "Call" button to signal active business operations to Google ranking algorithm.',
          action_type: 'ai_fix'
        },
        {
          id: 'review_velocity_smart_gating',
          category: 'reviews',
          title: 'Review Generation & Smart 4+ Star Gating',
          status: 'warning',
          impact: 'high',
          current_state: 'Smart review gating link is ready to be shared with recent buyers.',
          recommendation: 'Automate review requests via WhatsApp & SMS. Filter ratings < 4 stars to private feedback to protect public Google rating.',
          action_type: 'manual_step'
        },
        {
          id: 'qa_faq_authority',
          category: 'qa',
          title: 'Google Maps Q&A Section',
          status: 'fail',
          impact: 'medium',
          current_state: 'No seeded FAQ questions in your Google Q&A section.',
          recommendation: 'Seed 5-10 common buyer questions with authoritative keyword-rich answers directly on your Google profile.',
          action_type: 'ai_fix'
        }
      ]

      const passedCount = shortcomings.filter(s => s.status === 'pass').length
      const warningCount = shortcomings.filter(s => s.status === 'warning').length
      const healthScore = Math.round((passedCount * 20) + (warningCount * 10) + (isConnected ? 25 : 10))

      suiteData = {
        business_name: businessName,
        place_id: placeId,
        address: address,
        phone: phone,
        website: customDomain ? `https://${customDomain}` : '',
        primary_category: bi.target_industry || 'Real Estate Agency',
        secondary_categories: ['Real Estate Consultant', 'Property Investment Agency'],
        description: bi.bio || '',
        rating: 4.8,
        reviews_count: 24,
        photos_count: 12,
        health_score: healthScore,
        score_grade: healthScore >= 80 ? 'A' : healthScore >= 60 ? 'B' : 'Needs Optimization',
        shortcomings
      }
    }

    // Determine public review URL for this business
    let publicReviewUrl = ''
    if (customDomain) {
      publicReviewUrl = `https://${customDomain}/review`
    } else {
      // Check parent agency whitelabel domain if applicable
      const parentDomain = callerProfile?.whitelabel_domain || callerProfile?.custom_domain
      const baseOrigin = parentDomain ? `https://${parentDomain}` : (process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com')
      publicReviewUrl = `${baseOrigin}/review/${targetUserId}`
    }

    const isConnected = Boolean(
      targetProfile.google_business_location_id ||
      targetProfile.google_business_token ||
      suiteData.place_id
    )

    return NextResponse.json({
      success: true,
      profile: {
        id: targetProfile.id,
        business_name: targetProfile.business_name || targetProfile.full_name,
        email: targetProfile.email,
        address: targetProfile.address,
        phone: targetProfile.contact_number,
        custom_domain: targetProfile.custom_domain,
        brand_color: targetProfile.brand_color || '#2563EB',
        logo_url: targetProfile.logo_url,
        is_impersonating: targetUserId !== user.id,
        google_connected: isConnected,
        google_place_id: suiteData.place_id || targetProfile.google_place_id,
        google_review_url: targetProfile.google_review_url || suiteData.google_review_url || (suiteData.place_id ? `https://search.google.com/local/writereview?placeid=${suiteData.place_id}` : ''),
        public_review_url: publicReviewUrl
      },
      data: suiteData
    })
  } catch (err: any) {
    console.error('[GBP SUITE GET ERROR]', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')

    let targetUserId = user.id
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, agency_id, email')
      .eq('id', user.id)
      .single()

    const callerRole = callerProfile?.role?.toLowerCase() || 'admin'

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(callerRole)) {
      if (callerRole === 'super_admin' || callerProfile?.email === 'rchopra489@gmail.com') {
        targetUserId = impersonateId
      } else {
        const { data: subAccount } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', impersonateId)
          .or(`agency_id.eq.${user.id},parent_id.eq.${user.id}`)
          .maybeSingle()

        if (subAccount) {
          targetUserId = impersonateId
        } else {
          return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
        }
      }
    }

    const body = await req.json()
    const {
      business_name,
      address,
      phone,
      place_id,
      google_review_url,
      primary_category,
      secondary_categories,
      description,
      shortcomings
    } = body

    // 1. Fetch current profile
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('business_info')
      .eq('id', targetUserId)
      .single()

    let bi: any = {}
    if (currentProfile?.business_info) {
      try {
        bi = typeof currentProfile.business_info === 'string' ? JSON.parse(currentProfile.business_info) : currentProfile.business_info
      } catch {}
    }

    // 2. Fetch existing suite data and merge
    const existingSuite = (await getGBPOptimizationData(targetUserId)) || ({} as GBPOptimizationData)

    const updatedSuiteData: GBPOptimizationData = {
      ...existingSuite,
      business_name: business_name || existingSuite.business_name || 'My Business',
      place_id: place_id !== undefined ? place_id : existingSuite.place_id,
      address: address !== undefined ? address : existingSuite.address,
      phone: phone !== undefined ? phone : existingSuite.phone,
      primary_category: primary_category || existingSuite.primary_category,
      secondary_categories: secondary_categories || existingSuite.secondary_categories,
      description: description !== undefined ? description : existingSuite.description,
      google_review_url: google_review_url || existingSuite.google_review_url,
      shortcomings: shortcomings || existingSuite.shortcomings
    }

    // Recalculate health score if shortcomings were updated
    if (updatedSuiteData.shortcomings) {
      const pass = updatedSuiteData.shortcomings.filter(s => s.status === 'pass').length
      const warn = updatedSuiteData.shortcomings.filter(s => s.status === 'warning').length
      const total = updatedSuiteData.shortcomings.length
      updatedSuiteData.health_score = Math.min(100, Math.round(((pass * 1.0 + warn * 0.5) / Math.max(1, total)) * 100))
      updatedSuiteData.score_grade = updatedSuiteData.health_score >= 80 ? 'A' : updatedSuiteData.health_score >= 60 ? 'B' : 'Needs Optimization'
    }

    await saveGBPOptimizationData(targetUserId, updatedSuiteData)

    // Update profiles columns
    const profileUpdates: any = {}
    if (business_name) profileUpdates.business_name = business_name
    if (address) profileUpdates.address = address
    if (phone) profileUpdates.contact_number = phone
    if (place_id) profileUpdates.google_place_id = place_id
    if (google_review_url) profileUpdates.google_review_url = google_review_url

    if (Object.keys(profileUpdates).length > 0) {
      await supabaseAdmin
        .from('profiles')
        .update(profileUpdates)
        .eq('id', targetUserId)
    }

    return NextResponse.json({
      success: true,
      message: 'GBP Suite settings saved successfully',
      data: updatedSuiteData
    })
  } catch (err: any) {
    console.error('[GBP SUITE POST ERROR]', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
