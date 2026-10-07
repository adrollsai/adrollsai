import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { saveReviewFeedback, getReviewFeedbacks } from '@/utils/gbp-suite-storage'
import { sendPushNotification } from '@/utils/notification-helper'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

// Public POST endpoint to capture private review feedback (< 4 stars)
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      businessId,
      rating,
      customer_name,
      customer_phone,
      customer_email,
      feedback
    } = body

    if (!businessId || !feedback || !rating) {
      return NextResponse.json({ error: 'Missing required feedback fields' }, { status: 400 })
    }

    // Resolve target business profile
    let targetProfileId = businessId
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, contact_number, parent_id, agency_id')
      .or(`id.eq.${businessId},custom_domain.eq.${businessId}`)
      .maybeSingle()

    if (profile) {
      targetProfileId = profile.id
    }

    const savedFeedback = await saveReviewFeedback({
      user_id: targetProfileId,
      rating: Number(rating),
      customer_name: customer_name?.trim() || 'Anonymous Customer',
      customer_phone: customer_phone?.trim() || '',
      customer_email: customer_email?.trim() || '',
      feedback: feedback.trim(),
      source: 'review_smart_gate'
    })

    // If phone number provided, also attach to leads or create customer grievance lead
    if (customer_phone && customer_phone.trim().length >= 7) {
      try {
        const cleanPhone = customer_phone.trim()
        const { data: existingLead } = await supabaseAdmin
          .from('leads')
          .select('id, notes')
          .eq('user_id', targetProfileId)
          .eq('phone', cleanPhone)
          .maybeSingle()

        const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const feedbackNote = `[⚠️ Private Review Gate - ${rating}★ - ${dateStr}]: Customer left private feedback: "${feedback.trim()}"`

        if (existingLead) {
          await supabaseAdmin
            .from('leads')
            .update({
              notes: existingLead.notes ? `${feedbackNote}\n\n${existingLead.notes}` : feedbackNote
            })
            .eq('id', existingLead.id)

          await supabaseAdmin.from('lead_history').insert({
            lead_id: existingLead.id,
            action_type: 'REMARK',
            description: `⚠️ Customer left private ${rating}-star feedback via Smart Review Gate: "${feedback.trim()}"`
          })
        } else {
          const { data: newLead } = await supabaseAdmin
            .from('leads')
            .insert({
              user_id: targetProfileId,
              name: customer_name?.trim() || 'Review Feedback Customer',
              phone: cleanPhone,
              email: customer_email?.trim() || null,
              source: 'Smart Review Gate',
              pipeline_stage: 'Contacted',
              notes: feedbackNote
            })
            .select('id')
            .single()

          if (newLead) {
            await supabaseAdmin.from('lead_history').insert({
              lead_id: newLead.id,
              action_type: 'REMARK',
              description: `⚠️ New customer grievance from Smart Review Gate (${rating} Stars): "${feedback.trim()}"`
            })
          }
        }
      } catch (crmErr) {
        console.warn('[Review Feedback] CRM note sync error:', crmErr)
      }
    }

    // Trigger instant push alert to business owner so they can resolve customer complaint
    const businessTitle = profile?.business_name || 'your business'
    sendPushNotification(
      targetProfileId,
      `⚠️ Private Review Alert (${rating} Stars)`,
      `${customer_name || 'A customer'} left private feedback: "${feedback.slice(0, 80)}...". Tap to review and resolve.`,
      '/dashboard/gbp',
      'review_feedback'
    ).catch(e => console.warn('[Review Feedback] Push alert error:', e))

    return NextResponse.json({
      success: true,
      message: 'Thank you for your feedback. Our management team has been notified and will review your comments directly.',
      data: savedFeedback
    })
  } catch (err: any) {
    console.error('[REVIEW FEEDBACK ERROR]', err)
    return NextResponse.json({ error: err.message || 'Error recording feedback' }, { status: 500 })
  }
}

// Authenticated GET endpoint to retrieve feedback for GBP Suite
export async function GET(req: Request) {
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

        if (subAccount) targetUserId = impersonateId
        else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
      }
    }

    const feedbacks = await getReviewFeedbacks(targetUserId)

    return NextResponse.json({
      success: true,
      feedbacks
    })
  } catch (err: any) {
    console.error('[REVIEW FEEDBACK GET ERROR]', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
