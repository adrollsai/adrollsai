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
import {
  CONNECTION_ALERT_DEDUPE_HOURS,
  CONNECTION_ALERT_TYPE,
  diagnoseConnection,
  type TokenProbe,
} from '@/lib/ads/token-health'
import { META_GRAPH_URL } from '@/lib/ads/graph-version'

/**
 * Ad-review watchdog.
 *
 * Meta accepts a campaign at creation and can still refuse to deliver it, reporting
 * the reason only in `issues_info` on the object. Nothing read that field, so a
 * blocked ad set looked perfectly healthy in our dashboard until the client opened
 * Ads Manager and pressed publish.
 *
 * It also answers the other half of the same question — *can this tenant publish at
 * all?* — because a dead token or a restricted ad account produces no objects to
 * inspect, and the owner has to be told which of the two it is.
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

/** Same de-duplication idea, on its own (longer) window, for connection problems. */
async function connectionAlertedRecently(userId: string, key: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - CONNECTION_ALERT_DEDUPE_HOURS * 3600_000).toISOString()
    const { data } = await supabaseAdmin
      .from('notifications')
      .select('id, message')
      .eq('user_id', userId)
      .gte('created_at', since)
      .like('message', `%${key}%`)
      .limit(1)
    return Boolean(data && data.length)
  } catch {
    return false
  }
}

/**
 * Can this tenant publish at all?
 *
 * Reads the ad account itself — the cheapest call that proves the token still works —
 * and returns Meta's answer plus the account status. A tenant that fails here is
 * skipped for the issues sweep: every object read would fail the same way, and the
 * owner needs the connection message, not a list of empty results.
 */
async function probeConnection(
  adAccountId: string,
  token: string
): Promise<{ health: ReturnType<typeof diagnoseConnection>; probe: TokenProbe }> {
  const params = new URLSearchParams({ fields: 'id,name,account_status,currency', access_token: token })
  try {
    const res = await fetch(`${META_GRAPH_URL}/${adAccountId}?${params}`, { cache: 'no-store' })
    const json: any = await res.json()
    const err = json?.error
    const probe: TokenProbe = err
      ? { ok: false, code: err.code, subcode: err.error_subcode, message: err.error_user_msg || err.message, httpStatus: res.status }
      : { ok: true, accountStatus: Number(json?.account_status), currency: json?.currency }
    return { health: diagnoseConnection(probe), probe }
  } catch (err: any) {
    const probe: TokenProbe = { ok: false, message: err?.message || 'network error' }
    return { health: diagnoseConnection(probe), probe }
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
  let connectionsBroken = 0
  let connectionAlerts = 0

  for (const tenant of tenants || []) {
    const account = String(tenant.ad_account_id)

    // 1. Can this tenant publish at all? A dead token or a restricted ad account is
    // why launches fail, and it has to be said in those words — not discovered by the
    // client pressing Launch.
    const { health } = await probeConnection(account, tenant.facebook_token)
    if (health.needsAction) {
      connectionsBroken++
      const already = await connectionAlertedRecently(tenant.id, health.key)
      if (!already) {
        try {
          const { sendPushNotification } = await import('@/utils/notification-helper')
          await sendPushNotification(
            tenant.id,
            health.title,
            `${health.body} [${health.key}]`,
            '/dashboard/profile',
            CONNECTION_ALERT_TYPE
          )
          connectionAlerts++
          results.push({ userId: tenant.id, account, issues: 0, notified: true, detail: `connection: ${health.verdict}` })
        } catch (notifyErr: any) {
          results.push({
            userId: tenant.id,
            account,
            issues: 0,
            notified: false,
            detail: `connection ${health.verdict}, notify failed: ${notifyErr?.message || 'unknown'}`,
          })
        }
      } else {
        results.push({ userId: tenant.id, account, issues: 0, notified: false, detail: `connection: ${health.verdict} (already alerted)` })
      }
      // Every object read would fail the same way, so stop here for this tenant.
      continue
    }

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
    connectionsBroken,
    connectionAlerts,
    tenantsWithIssues: blocked.length,
    totalIssues,
    notificationsSent: totalNotified + connectionAlerts,
    summary: [
      connectionsBroken ? `${connectionsBroken} account(s) need reconnecting` : null,
      blocked.length
        ? `${blocked.length} account(s) with blocked ads: ` +
          blocked
            .map((r) => `${(r.account || '').slice(-6)}: ${r.issues} issue(s)${r.notified ? ' (notified)' : ''}`)
            .join(', ')
        : 'no blocked ad objects',
    ]
      .filter(Boolean)
      .join(' · '),
    detail: results.filter((r) => r.issues > 0 || (r.detail || '').startsWith('connection')),
  })
}
