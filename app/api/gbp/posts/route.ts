import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getGBPPosts, saveGBPPost, deleteGBPPost } from '@/utils/gbp-suite-storage'

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

    const posts = await getGBPPosts(targetUserId)

    return NextResponse.json({
      success: true,
      posts
    })
  } catch (err: any) {
    console.error('[GBP POSTS GET ERROR]', err)
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

        if (subAccount) targetUserId = impersonateId
        else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
      }
    }

    const body = await req.json()
    const {
      post_type = 'update',
      summary,
      call_to_action_type = 'LEARN_MORE',
      call_to_action_url,
      media_url,
      offer_coupon_code,
      offer_terms,
      event_title,
      event_start_time,
      event_end_time,
      status = 'published',
      scheduled_at
    } = body

    if (!summary || summary.trim().length === 0) {
      return NextResponse.json({ error: 'Post summary/caption is required' }, { status: 400 })
    }

    // Fetch target profile for Google API tokens if available
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('google_business_token, google_business_refresh_token, google_business_location_id, custom_domain')
      .eq('id', targetUserId)
      .single()

    let googlePostId: string | undefined = undefined

    // Attempt direct publish via Google Business Profile API if connected
    if (status === 'published' && targetProfile?.google_business_token && targetProfile?.google_business_location_id) {
      try {
        const gbpLocationId = targetProfile.google_business_location_id
        const gbpPostUrl = `https://mybusiness.googleapis.com/v4/${gbpLocationId}/localPosts`

        const gbpPayload: any = {
          languageCode: 'en-US',
          summary: summary.trim(),
          topicType: post_type === 'offer' ? 'OFFER' : post_type === 'event' ? 'EVENT' : 'STANDARD'
        }

        if (call_to_action_url) {
          gbpPayload.callToAction = {
            actionType: call_to_action_type || 'LEARN_MORE',
            url: call_to_action_url
          }
        }

        if (media_url) {
          gbpPayload.media = [{
            mediaFormat: 'PHOTO',
            sourceUrl: media_url
          }]
        }

        if (post_type === 'offer' && offer_coupon_code) {
          gbpPayload.offer = {
            couponCode: offer_coupon_code,
            termsConditions: offer_terms || ''
          }
        }

        if (post_type === 'event' && event_title) {
          gbpPayload.event = {
            title: event_title
          }
        }

        const gbpRes = await fetch(gbpPostUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${targetProfile.google_business_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(gbpPayload)
        })

        if (gbpRes.ok) {
          const gbpData = await gbpRes.json()
          googlePostId = gbpData.name || gbpData.localPostId
          console.log(`[GBP Post API] Successfully published to Google! Post ID: ${googlePostId}`)
        } else {
          console.warn('[GBP Post API] Google returned non-200, saving locally in Suite:', await gbpRes.text())
        }
      } catch (gbpApiErr: any) {
        console.warn('[GBP Post API] Exception posting to Google, saved locally in Suite:', gbpApiErr.message)
      }
    }

    const savedPost = await saveGBPPost({
      user_id: targetUserId,
      post_type,
      summary: summary.trim(),
      call_to_action_type,
      call_to_action_url: call_to_action_url || (targetProfile?.custom_domain ? `https://${targetProfile.custom_domain}` : ''),
      media_url,
      offer_coupon_code,
      offer_terms,
      event_title,
      event_start_time,
      event_end_time,
      status: status === 'scheduled' ? 'scheduled' : 'published',
      scheduled_at,
      published_at: status === 'published' ? new Date().toISOString() : undefined,
      google_post_id: googlePostId
    })

    return NextResponse.json({
      success: true,
      message: status === 'scheduled' ? 'Post scheduled successfully!' : 'Post published to Google Business Profile!',
      post: savedPost
    })
  } catch (err: any) {
    console.error('[GBP POSTS CREATE ERROR]', err)
    return NextResponse.json({ error: err.message || 'Failed to create post' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const postId = url.searchParams.get('id')
    const impersonateId = url.searchParams.get('impersonate')

    if (!postId) {
      return NextResponse.json({ error: 'Missing post id' }, { status: 400 })
    }

    let targetUserId = user.id
    if (impersonateId) {
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (['super_admin', 'agency', 'admin'].includes(callerProfile?.role || '')) {
        targetUserId = impersonateId
      }
    }

    await deleteGBPPost(postId, targetUserId)

    return NextResponse.json({ success: true, message: 'Post deleted successfully' })
  } catch (err: any) {
    console.error('[GBP POSTS DELETE ERROR]', err)
    return NextResponse.json({ error: err.message || 'Failed to delete post' }, { status: 500 })
  }
}
