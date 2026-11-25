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

/**
 * Per-tenant dial rate for one 5-minute run.
 *
 * 8 was far too low in practice: a 235-lead campaign needed about two and a half hours of ticks
 * before the last person was dialled, with no visible progress and no way to speed it up. 25 per tick
 * is roughly 300 calls an hour — a rate a live calling team can supervise — and it is env-tunable so
 * a tenant whose provider allows more can go faster without a deploy. The daily cap in the automation
 * policy still applies on top of this: autonomy must not be able to ring 200 people in a morning.
 */
function envCap(name: string, fallback: number): number {
  const raw = Number(String(process.env[name] ?? '').replace(/[^\d]/g, ''))
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

const MAX_CALLS_PER_TENANT_PER_RUN = envCap('VOICE_MAX_CALLS_PER_TENANT_PER_RUN', 25)
/** Hard ceiling for one invocation (the function's maxDuration still bounds it). */
const MAX_CALLS_PER_RUN = envCap('VOICE_MAX_CALLS_PER_RUN', 150)

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

    // The RPC returns only leads whose stage is one of the tenant's "fresh" stages. A lead the agent has NEVER
    // contacted belongs in the queue whatever stage it sits in — the rule is "fresh section, or not called yet" — so
    // untouched leads are fetched separately and merged, deduplicated by id.
    let untouched: any[] = []
    try {
      const enabledTenantIds = [...policyByTenant.entries()]
        .filter(([, policy]) => (policy as any)?.master_enabled && (policy as any)?.ai_calling)
        .map(([tenantId]) => tenantId)
      if (enabledTenantIds.length) {
        const { data } = await supabaseAdmin
          .from('leads')
          .select('id, user_id, phone, name, created_at, voice_call_retry_count, voice_call_status, pipeline_stage, custom_fields, booked_time, processing_lock_until')
          .in('user_id', enabledTenantIds)
          .is('voice_call_status', null)
          .or('voice_call_retry_count.is.null,voice_call_retry_count.eq.0')
          .is('booked_time', null)
          .order('created_at', { ascending: false })
          .limit(500)
        untouched = data ?? []
      }
    } catch (untouchedErr: any) {
      // The extra half of the queue must never break the run; the RPC candidates still dispatch.
      console.warn('[CRON/VOICE-CALLER] Untouched-lead fetch failed:', untouchedErr?.message)
    }

    const mergedCandidates = [
      ...(candidates ?? []),
      ...untouched.filter((row) => !(candidates ?? []).some((c: any) => c.id === row.id)),
    ]

    // Order by the queue's own priority: a lead that arrived in the last day and has never been touched goes before
    // the backlog and long before retries. The RPC orders oldest-first, which is the opposite of what converts.
    const { prioritiseCallQueue, toQueueRow } = await import('@/lib/automation/call-queue')
    const orderedCandidates = mergedCandidates
      .map((row: any) => {
        const policy = policyByTenant.get(row.user_id) as any
        const [decision] = prioritiseCallQueue([toQueueRow(row)], {
          freshHours: 24,
          maxAttempts: Number(policy?.call_max_attempts) || 3,
          maxAgeDays: Number(policy?.call_max_age_days) || 365,
          freshStages: null, // stage filtering already happened upstream; this is ordering
        })
        return { row, decision }
      })
      .filter((entry: any) => entry.decision?.inQueue)
      .sort((a: any, b: any) => a.decision.priority - b.decision.priority)
      .map((entry: any) => entry.row)

    if (!orderedCandidates.length && campaignDispatches === 0) {
      return NextResponse.json({ success: true, dispatched: 0, campaignDispatches, message: 'No candidates' })
    }

    // ---- 4. Decide who is actually due, per tenant ------------------------
    const dueIds: string[] = []
    const perTenant = new Map<string, number>()
    const skippedTenants = new Set<string>()

    for (const row of orderedCandidates) {
      if (dueIds.length >= MAX_CALLS_PER_RUN) break
      const tenantId: string = row.user_id
      if (skippedTenants.has(tenantId)) continue

      const policy = policyByTenant.get(tenantId)
      if (!policy || !policy.master_enabled || !policy.ai_calling) {
        // Say which of the three it was. "No row" is a provisioning gap, not a choice:
        // the RPC inner-joins `tenant_automations`, so such a tenant never even reaches
        // this loop and nothing anywhere reports why they never get called.
        const why = !policy
          ? 'no tenant_automations row (provisioning gap — create one)'
          : !policy.master_enabled
            ? 'master_enabled=false'
            : 'ai_calling=false'
        console.log(`[Voice Caller] skipping tenant ${tenantId}: ${why}`)
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
    /** Tenants whose telephony is not configured: stop after the first failure, not the 25th. */
    const misconfiguredTenants = new Set<string>()
    const failuresByTenant = new Map<string, number>()
    const MAX_FAILURES_PER_TENANT = 3

    /**
     * `triggerOutboundCall` REPORTS failure, it does not throw it.
     *
     * The previous loop did `await triggerOutboundCall(...); dispatched++` inside a try/catch,
     * so every refusal — SUBSCRIPTION_EXPIRED, no phone number, insufficient credits, a
     * provider HTTP error — was counted as a successful dispatch. The 30-minute backoff below
     * was unreachable, `voice_call_retry_count` was incremented anyway (so a misconfigured
     * tenant burned all 18 cadence attempts in about 90 minutes and the lead then vanished
     * from the queue for good), and the "abort on unconfigured telephony" guard could never
     * fire because that error never arrived as an exception.
     *
     * The operator saw `{dispatched: 25, failed: 0}` from a run in which nothing was dialled.
     */
    const isPermanentDialFailure = (msg: string) =>
      /inactive|NO_PHONE_NUMBER_ASSIGNED|no .*number|SUBSCRIPTION_EXPIRED|Insufficient calling credits|TELEPHONY_URL_INVALID|NON_INDIAN_NUMBER|not owned/i.test(msg)

    for (const row of claimed || []) {
      if (misconfiguredTenants.has(row.user_id)) continue

      // Guardrail: daily call cap, so autonomy cannot ring 200 people in a day.
      // `break` here used to stop the dial loop for EVERY tenant because one of them
      // hit its own cap; the cap is per tenant, so the skip must be per tenant too.
      try {
        const { canSpend } = await import('@/lib/automation/ceo')
        const cap = await canSpend(supabaseAdmin, row.user_id, 'call', 0, 1)
        if (!cap.allowed) {
          console.log(
            '[Voice Caller] daily call cap reached for ' + row.user_id +
            ' (' + (cap.reason || 'cap') + ' ' + cap.used + '/' + cap.cap + ')'
          )
          misconfiguredTenants.add(row.user_id)
          continue
        }
      } catch (gErr: any) {
        console.warn('[Voice Caller] guardrail check failed:', gErr?.message)
      }

      const candidate: any = byLead.get(row.id)
      try {
        const result: any = await triggerOutboundCall(supabaseAdmin, row.id, row.user_id, true)
        const ok = result?.success === true || result?.scheduled === true

        if (!ok) {
          failed++
          const msg = String(result?.error || 'dial returned no success flag')
          const n = (failuresByTenant.get(row.user_id) || 0) + 1
          failuresByTenant.set(row.user_id, n)
          console.warn(`[Voice Caller] dial NOT placed for ${row.id} (${row.user_id}): ${msg}`)

          if (isPermanentDialFailure(msg)) {
            // One misconfigured tenant must not consume the whole run's budget.
            misconfiguredTenants.add(row.user_id)
            console.warn(`[Voice Caller] telephony/config problem for tenant ${row.user_id}; skipping it for the rest of this run.`)
            continue
          }
          if (n >= MAX_FAILURES_PER_TENANT) {
            console.warn(`[Voice Caller] ${n} consecutive failures for tenant ${row.user_id}; skipping it for the rest of this run.`)
            misconfiguredTenants.add(row.user_id)
          }

          // Transient: back off instead of hammering every 5 minutes. Do NOT burn a
          // cadence slot on a transport failure — which is now actually reachable.
          const retryAt = new Date(Date.now() + 30 * 60_000).toISOString()
          await supabaseAdmin
            .from('leads')
            .update({ voice_call_scheduled_at: retryAt })
            .eq('id', row.id)
          continue
        }

        dispatched++

        // Ledger for the call cap.
        try {
          const { recordSpend } = await import('@/lib/automation/ceo')
          await recordSpend(supabaseAdmin, row.user_id, 'call', 0, 1)
        } catch {}

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
        console.error(`[Voice Caller] dial threw for ${row.id}:`, msg)

        const retryAt = new Date(Date.now() + 30 * 60_000).toISOString()
        await supabaseAdmin
          .from('leads')
          .update({ voice_call_scheduled_at: retryAt })
          .eq('id', row.id)

        if (isPermanentDialFailure(msg)) {
          misconfiguredTenants.add(row.user_id)
          break
        }
      }
    }

    console.log(`[Voice Caller] candidates=${candidates?.length || 0} due=${dueIds.length} claimed=${claimed?.length || 0} dispatched=${dispatched} failed=${failed} skippedTenants=${misconfiguredTenants.size}`)

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
