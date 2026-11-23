import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  ALERT_DEDUPE_HOURS,
  ALERT_TYPE,
  alertBody,
  alertTitle,
  alertUrl,
  collectBlockingIssues,
  issueSignature,
  type BlockingIssue,
  type MetaObjectWithIssues,
} from '@/lib/ads/ad-review-monitor'
import { META_GRAPH_URL } from '@/lib/ads/graph-version'

/**
 * Ad-review watchdog.
 *
 * Meta accepts a campaign at creation and can still refuse to deliver it, reporting
 * the reason only in `issues_info` on the object. Nothing read that field, so a
 * blocked ad set looked perfectly healthy in our dashboard until the client opened
 * Ads Manager and pressed publish.
 *
 * This sweeps every connected ad account, collects the objects Meta has flagged, and
 * raises one notification per tenant — de-duplicated for ALERT_DEDUPE_HOURS so a
 * persisting problem is not re-sent on every run.
 *
 * Schedule: every 6 hours (see vercel.json).
 */

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EDGES: Array<'campaigns' | 'adsets' | 'ads'> = ['campaigns', 'adsets', 'ads']
const MAX_TENANTS = 40

async function fetchIssues(
  edge: 'campaigns' | 'adsets' | 'ads',
  adAccountId: string,
  token: string
): Promise<MetaObjectWithIssues[]> {
  const params = new URLSearchParams({
    fields: 'id,name,effective_status,issues_info',
    filtering: JSON.stringify([
      { field: 'effective_status', operator: 'IN', value: ['WITH_ISSUES', 'DISAPPROVED'] },
    ]),
    limit: '50',
    access_token: token,
  })
  try {
    const res = await fetch(`${META_GRAPH_URL}/${adAccountId}/${edge}?${params}`, { cache: 'no-store' })
    const json: any = await res.json()
    if (json?.error) {
      console.warn(`[meta-ad-issues] ${edge} read failed for ${adAccountId}:`, json.error?.message)
      return []
    }
    return (json?.data || []).map((row: any) => ({ ...row, edge }))
  } catch (err: any) {
    console.warn(`[meta-ad-issues] ${edge} read threw for ${adAccountId}:`, err?.message)
    return []
  }
}

async function recentlyAlerted(userId: string, signature: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - ALERT_DEDUPE_HOURS * 3600_000).toISOString()
    const { data } = await supabaseAdmin
      .from('notifications')
      .select('id, message')
      .eq('user_id', userId)
      .gte('created_at', since)
      .like('message', `%${signature.slice(0, 60)}%`)
      .limit(1)
    return Boolean(data && data.length)
  } catch {
    // No notifications table / query failure must not stop the sweep.
    return false
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: tenants, error } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, full_name, email, facebook_token, ad_account_id')
    .not('facebook_token', 'is', null)
    .not('ad_account_id', 'is', null)
    .limit(MAX_TENANTS)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const results: Array<{
    userId: string
    account: string
    issues: number
    notified: boolean
    detail?: string
  }> = []

  let totalIssues = 0
  let totalNotified = 0

  for (const tenant of tenants || []) {
    const account = String(tenant.ad_account_id)
    const issues: BlockingIssue[] = []

    for (const edge of EDGES) {
      const rows = await fetchIssues(edge, account, tenant.facebook_token)
      issues.push(...collectBlockingIssues(rows))
    }

    if (!issues.length) {
      results.push({ userId: tenant.id, account, issues: 0, notified: false })
      continue
    }

    totalIssues += issues.length
    const signature = issueSignature(issues)

    if (await recentlyAlerted(tenant.id, signature)) {
      results.push({ userId: tenant.id, account, issues: issues.length, notified: false, detail: 'already alerted' })
      continue
    }

    try {
      const { sendPushNotification } = await import('@/utils/notification-helper')
      await sendPushNotification(
        tenant.id,
        alertTitle(issues),
        // The signature is embedded so the next run can tell whether anything changed.
        `${alertBody(issues)} [${signature.slice(0, 60)}]`,
        alertUrl(),
        ALERT_TYPE
      )
      totalNotified++
      results.push({ userId: tenant.id, account, issues: issues.length, notified: true })
    } catch (notifyErr: any) {
      results.push({
        userId: tenant.id,
        account,
        issues: issues.length,
        notified: false,
        detail: `notify failed: ${notifyErr?.message || 'unknown'}`,
      })
    }
  }

  const blocked = results.filter((r) => r.issues > 0)

  return NextResponse.json({
    success: true,
    scanned: results.length,
    tenantsWithIssues: blocked.length,
    totalIssues,
    notificationsSent: totalNotified,
    summary: blocked.length
      ? blocked
          .map((r) => `${(r.account || '').slice(-6)}: ${r.issues} issue(s)${r.notified ? ' (notified)' : ''}`)
          .join(', ')
      : 'no blocked ad objects',
    detail: blocked,
  })
}
