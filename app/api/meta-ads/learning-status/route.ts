import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { META_GRAPH_URL } from '@/lib/ads/graph-version'
import { summariseCampaign, type LearningStageRow } from '@/lib/ads/learning-phase'

/**
 * Is this campaign's performance stable enough to act on?
 *
 * Meta reports a learning stage per ad set. Until it says SUCCESS, the cost per result
 * on screen is an average over an unfinished sample, and any edit restarts the clock.
 * This endpoint exposes that so the ads dashboard can label a number as provisional
 * instead of letting someone pause a winner on day one.
 *
 * GET /api/meta-ads/learning-status?campaignId=<id>[&impersonate=<profile>]
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const campaignId = url.searchParams.get('campaignId')
  const impersonateId = url.searchParams.get('impersonate')

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, parent_id, agency_id')
    .eq('id', user.id)
    .single()

  let targetUserId = user.id
  if (impersonateId && impersonateId !== user.id) {
    const allowed = ['super_admin', 'agency', 'admin']
    if (!allowed.includes(callerProfile?.role || '')) {
      return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
    }
    if (callerProfile?.role !== 'super_admin') {
      const inWorkspace =
        callerProfile?.agency_id === impersonateId || callerProfile?.parent_id === impersonateId
      if (!inWorkspace) return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
    }
    targetUserId = impersonateId
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('id', targetUserId)
    .single()

  const token = profile?.facebook_token
  const adAccountId = profile?.ad_account_id
  if (!token || !adAccountId) {
    return NextResponse.json({ error: 'Meta Ads account not connected.' }, { status: 400 })
  }
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId is required.' }, { status: 400 })
  }

  const params = new URLSearchParams({
    fields: 'id,name,effective_status,learning_stage_info',
    limit: '100',
    access_token: token,
  })

  try {
    const res = await fetch(`${META_GRAPH_URL}/${campaignId}/adsets?${params}`, { cache: 'no-store' })
    const json: any = await res.json()
    if (json?.error) {
      return NextResponse.json(
        { error: json.error.error_user_msg || json.error.message || 'Meta rejected the read.' },
        { status: 400 }
      )
    }
    const rows: LearningStageRow[] = (json?.data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      effective_status: row.effective_status,
      learning_stage_info: row.learning_stage_info || null,
    }))
    const summary = summariseCampaign(rows, campaignId)
    return NextResponse.json({ success: true, ...summary })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not reach Meta.' }, { status: 502 })
  }
}
