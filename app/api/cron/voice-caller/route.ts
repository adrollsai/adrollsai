/* eslint-disable @typescript-eslint/no-explicit-any --
 * The generated supabase/database.types.ts is stale (it is missing tables and
 * columns this code legitimately uses), so typing these Supabase calls against
 * it would produce false errors. `any` is the same choice utils/credits.ts and
 * utils/voice-helper.ts make for the same reason.
 */import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { evaluateCadence, isWithinCallWindow, type CadenceConfig } from '@/lib/automation/calling-cadence'

/**
 * Calling dispatcher.
 *
 * Replaces the previous implementation, which:
 *   - had no effective auth (`mozilla`/`curl` user-agents bypassed the check, and
 *     any request with no secret was also allowed);
 *   - only dialled leads that already had `voice_call_scheduled_at` set, so a
 *     freshly ingested lead was never called by the engine itself;
 *   - could double-dial, because two crons (one every 5 min, one every 10 min)
 *     did a non-atomic read-then-clear on the same lead.
 *
 * Now: cadence is computed per tenant, calls are claimed atomically in Postgres
 * (claim_calls), and a lead keeps being chased while it stays in a "fresh"
 * pipeline stage and has not booked or opted out.
 */

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/** Never dial more than this per tenant per run (the cron runs every 5 min). */
const MAX_CALLS_PER_TENANT_PER_RUN = 8
/** Hard ceiling for one invocation. */
const MAX_CALLS_PER_RUN = 60

export async function GET(request: Request) {
  return handleDispatcher(request)
}

export async function POST(request: Request) {
  return handleDispatcher(request)
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    // Refuse to run unauthenticated in production. An unauthenticated endpoint
    // here spends real telephony money and rings real people.
    return process.env.NODE_ENV !== 'production'
  }
  const header = request.headers.get('authorization') || ''
  const url = new URL(request.url)
  const provided = header.replace(/^Bearer\s+/i, '') || url.searchParams.get('cronSecret') || ''
  return provided === expected
}

async function handleDispatcher(request: Request) {
  try {
    if (!isAuthorized(request)) {
      console.warn('[Voice Caller] Rejected unauthorized request')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()

    // ---- 1. Human-launched bulk campaigns keep their own pump -------------
    let campaignDispatches = 0
    const { data: runningCampaigns } = await supabaseAdmin
      .from('voice_campaigns')
      .select('id, user_id')
      .eq('status', 'running')

    if (runningCampaigns?.length) {
      const { dispatchNextCall } = await import('@/utils/voice-helper')
      for (const camp of runningCampaigns) {
        try {
          const res = await dispatchNextCall(supabaseAdmin, camp.user_id)
          if (res?.dispatched) campaignDispatches++
        } catch (e: any) {
          console.error(`[Voice Caller] campaign ${camp.id} dispatch failed:`, e?.message)
        }
      }
    }

    // ---- 2. Tenant automation policies ------------------------------------
    const { data: policies, error: polErr } = await supabaseAdmin
      .from('tenant_automations')
      .select('user_id, master_enabled, ai_calling, timezone, call_window_start, call_window_end, call_cadence, call_max_attempts, call_tail_days, call_max_age_days')

    if (polErr) throw polErr
    const policyByTenant = new Map<string, any>()
    for (const p of policies || []) policyByTenant.set(p.user_id, p)

    // ---- 3. Candidates (interleaved fairly across tenants) ----------------
    const { data: candidates, error: candErr } = await supabaseAdmin
      .rpc('call_cadence_candidates', { p_limit: 2000 })

    if (candErr) throw candErr
    if (!candidates?.length && campaignDispatches === 0) {
      return NextResponse.json({ success: true, dispatched: 0, campaignDispatches, message: 'No candidates' })
    }

    // ---- 4. Decide who is actually due, per tenant ------------------------
    const dueIds: string[] = []
    const perTenant = new Map<string, number>()
    const skippedTenants = new Set<string>()

    for (const row of candidates || []) {
      if (dueIds.length >= MAX_CALLS_PER_RUN) break
      const tenantId: string = row.user_id
      if (skippedTenants.has(tenantId)) continue

      const policy = policyByTenant.get(tenantId)
      if (!policy || !policy.master_enabled || !policy.ai_calling) {
        skippedTenants.add(tenantId)
        continue
      }

      const tz: string = policy.timezone || 'Asia/Kolkata'
      const config: CadenceConfig = {
        cadenceHours: Array.isArray(policy.call_cadence) && policy.call_cadence.length
          ? policy.call_cadence.map(Number).filter((n: number) => Number.isFinite(n))
          : undefined,
        tailDays: policy.call_tail_days ?? 30,
        maxAgeDays: policy.call_max_age_days ?? 365,
        windowStart: policy.call_window_start ?? 9,
        windowEnd: policy.call_window_end ?? 19,
        timezone: tz,
      }

      // Outside this tenant's calling window: skip the tenant entirely.
      if (!isWithinCallWindow(now, config.windowStart!, config.windowEnd!, tz)) {
        skippedTenants.add(tenantId)
        continue
      }

      const count = perTenant.get(tenantId) || 0
      if (count >= MAX_CALLS_PER_TENANT_PER_RUN) continue

      const decision = evaluateCadence(
        {
          createdAt: new Date(row.created_at),
          attemptCount: Number(row.voice_call_retry_count) || 0,
          lastAttemptAt: row.last_call_at ? new Date(row.last_call_at) : null,
          scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
          now,
        },
        config
      )

      if (decision.isDue) {
        dueIds.push(row.id)
        perTenant.set(tenantId, count + 1)
      }
    }

    if (!dueIds.length) {
      return NextResponse.json({
        success: true,
        dispatched: 0,
        campaignDispatches,
        candidates: candidates?.length || 0,
        message: 'No leads due in this window',
      })
    }

    // ---- 5. Atomic claim, so no other invocation can take the same lead ---
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .rpc('claim_calls', { p_ids: dueIds })

    if (claimErr) throw claimErr

    // ---- 6. Dial -----------------------------------------------------------
    const { triggerOutboundCall } = await import('@/utils/voice-helper')
    const byLead = new Map((candidates || []).map((c: any) => [c.id, c]))
    let dispatched = 0
    let failed = 0

    for (const row of claimed || []) {
      const candidate: any = byLead.get(row.id)
      try {
        await triggerOutboundCall(supabaseAdmin, row.id, row.user_id, true)
        dispatched++

        const attempts = (Number(candidate?.voice_call_retry_count) || 0) + 1
        await supabaseAdmin
          .from('leads')
          .update({
            voice_call_scheduled_at: null,
            voice_call_retry_count: attempts,
          })
          .eq('id', row.id)
      } catch (e: any) {
        failed++
        const msg = String(e?.message || e)
        console.error(`[Voice Caller] dial failed for ${row.id}:`, msg)

        // Back off instead of hammering every 5 minutes. Do not burn a cadence
        // slot on a transport failure.
        const retryAt = new Date(Date.now() + 30 * 60_000).toISOString()
        await supabaseAdmin
          .from('leads')
          .update({ voice_call_scheduled_at: retryAt })
          .eq('id', row.id)

        // A tenant with no telephony configured will fail for every lead —
        // stop early rather than looping through hundreds of failures.
        if (/inactive|NO_PHONE_NUMBER_ASSIGNED|no .*number/i.test(msg)) {
          console.warn('[Voice Caller] Telephony not configured for tenant, aborting run:', row.user_id)
          break
        }
      }
    }

    console.log(`[Voice Caller] candidates=${candidates?.length || 0} due=${dueIds.length} claimed=${claimed?.length || 0} dispatched=${dispatched} failed=${failed}`)

    return NextResponse.json({
      success: true,
      candidates: candidates?.length || 0,
      due: dueIds.length,
      claimed: claimed?.length || 0,
      dispatched,
      failed,
      campaignDispatches,
    })
  } catch (error: any) {
    console.error('[Voice Caller] Fatal:', error)
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 })
  }
}
