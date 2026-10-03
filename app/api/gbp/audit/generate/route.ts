import { NextResponse } from 'next/server'
import { runGBPAudit } from '@/utils/gbp-audit-engine'
import { saveAuditReport, getCampaignBySlug } from '@/utils/gbp-audit-storage'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      businessName,
      placeId,
      address,
      phone,
      website,
      primaryCategory,
      secondaryCategories,
      latitude,
      longitude,
      rating,
      reviewsCount,
      photosCount,
      targetKeywords,
      leadName,
      leadEmail,
      leadPhone,
      campaignSlug,
      currency
    } = body

    if (!businessName) {
      return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
    }

    // Resolve campaign to find agency_user_id
    const campaign = campaignSlug ? await getCampaignBySlug(campaignSlug) : null
    const agencyUserId = campaign?.user_id

    // Run the audit calculation and Gemini AI diagnosis
    const report = await runGBPAudit({
      businessName,
      placeId,
      address: address || 'Local Business Area',
      phone,
      website,
      primaryCategory: primaryCategory || 'Real Estate Agency',
      secondaryCategories: secondaryCategories || [],
      latitude: latitude ? parseFloat(latitude) : 30.7046,
      longitude: longitude ? parseFloat(longitude) : 76.7179,
      rating: rating ? parseFloat(rating) : 4.1,
      reviewsCount: reviewsCount ? parseInt(reviewsCount, 10) : 14,
      photosCount: photosCount ? parseInt(photosCount, 10) : 6,
      targetKeywords: Array.isArray(targetKeywords) && targetKeywords.length > 0 ? targetKeywords : undefined,
      leadName,
      leadEmail,
      leadPhone,
      agencyUserId,
      campaignSlug: campaignSlug || 'nobogent',
      currency: currency || (campaign?.target_industry === 'US' ? 'USD' : 'INR')
    })

    // Save report in persistent storage
    const saved = await saveAuditReport(report)

    // Automatically sync lead into Nobogent CRM if lead contact info was provided
    if (leadName || leadEmail || leadPhone) {
      try {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )

        await supabase.from('leads').insert({
          user_id: agencyUserId || undefined,
          full_name: leadName || businessName,
          email: leadEmail || '',
          phone: leadPhone || phone || '',
          status: 'new',
          source: `GBP Audit: ${campaignSlug || 'nobogent'}`,
          notes: `Generated Google Business Profile Audit: Score ${report.overall_score}/100 (${report.score_grade}). Estimated Monthly Lost Revenue: ${report.currency} ${report.estimated_monthly_loss}. Report URL: /audit/report/${report.share_token}`
        })
      } catch (crmErr) {
        console.warn('[GBP Audit] Error inserting CRM lead:', crmErr)
      }
    }

    return NextResponse.json({
      success: true,
      reportId: saved.id,
      shareToken: saved.share_token,
      reportUrl: `/audit/report/${saved.share_token}`
    })
  } catch (err: any) {
    console.error('[GBP Audit Generate API] Error generating audit:', err)
    return NextResponse.json({ error: err.message || 'Failed to generate audit' }, { status: 500 })
  }
}
