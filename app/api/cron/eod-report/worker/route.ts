import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendDailyEodReportEmail } from '@/utils/email-helper'
import { deductCredits } from '@/utils/credits'
import { getActivePlaybook } from '@/lib/automation/ceo'
import { creditBalance, resolveBillingOwner } from '@/lib/automation/billing'
import {
  buildEodReport,
  dayWindow,
  classifyInstant,
  summarizeCallHistory,
  sumCreditSpend,
  isAssetReady,
  isAssetFailed,
  eodChargeDescription,
  type EodCampaignFacts,
  type EodReport,
  type EodRoutineFacts,
} from '@/lib/automation/eod-report'

/**
 * End-of-day report worker: gather facts, build the report, send it.
 *
 * All wording lives in `lib/automation/eod-report.ts`, which is a pure function
 * over an `EodReportInput`. This file only reads rows, hands them over, and
 * dispatches. Two consequences worth stating:
 *
 *  - A missing table (or a stale schema) drops ONE section and logs a warning.
 *    It never throws: an EOD report that is missing its ads section is useful, an
 *    EOD report that crashes is not.
 *  - "Today" is the tenant's local day (`dayWindow(profile.timezone)`), not
 *    `now - 24h`, so an evening run at 00:30 IST does not sweep yesterday's rows
 *    into today's numbers.
 */

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300 // Max 5 minutes for processing single user

const DASHBOARD_URL = 'https://app.nobogent.com/dashboard'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch }
  }
)

/* ------------------------------------------------------------------ */
/* Row shapes used here (the generated types are stale)                */
/* ------------------------------------------------------------------ */

interface LeadRow { id?: string; created_at?: string | null; pipeline_stage?: string | null }
interface CallRow { description?: string | null }
interface MessageRow { direction?: string | null; created_at?: string | null }
interface AssetRow { id?: string; type?: string | null; status?: string | null; created_at?: string | null }
interface PageRow { id?: string; slug?: string | null; created_at?: string | null }
interface JobRow { id?: string; status?: string | null }
interface LedgerRow { amount?: number | string | null }
interface UsageRow { cost_inr?: number | string | null }
interface RoutineRow { id: string; name?: string | null; cadence?: string | null; enabled?: boolean | null; last_run_at?: string | null }
interface RunRow { status?: string | null; period_key?: string | null }

/**
 * Read a table, and treat "does not exist" / any failure as "no data".
 * An accounting or schema read must never be the reason a report fails.
 */
async function readOr<T>(fn: () => PromiseLike<{ data: unknown; error: any }>, label: string): Promise<T | null> {
  try {
    const { data, error } = await fn()
    if (error) {
      const message = String(error.message || error)
      if (/does not exist|schema cache|relation .* does not exist/i.test(message)) {
        console.warn(`[EOD Report Worker] ${label} table not present — omitting that section.`)
      } else {
        console.warn(`[EOD Report Worker] ${label} read failed — omitting that section: ${message}`)
      }
      return null
    }
    return (data ?? null) as T | null
  } catch (e: any) {
    console.warn(`[EOD Report Worker] ${label} read threw — omitting that section:`, e?.message || e)
    return null
  }
}

/** Playbook `daily_routine.jobs` → the three fields the report can describe. */
function extractRoutineJobs(
  daily: unknown
): Array<{ kind: string; at: string | null; everyDays: number | null }> {
  const raw = Array.isArray(daily)
    ? daily
    : daily && typeof daily === 'object'
      ? (daily as any).jobs
      : null
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 6)
    .map((job: any) => ({
      kind: String(job?.kind || job?.name || '').trim(),
      at: job?.at != null && String(job.at).trim() ? String(job.at).trim() : null,
      everyDays: job?.every_days ?? job?.everyDays ?? null,
    }))
    .filter((job) => !!job.kind)
}

/**
 * Meta campaign state, if the workspace has linked an ad account.
 * One fetch serves both the email and the WhatsApp text, so they cannot disagree.
 */
async function fetchMetaCampaigns(profile: any): Promise<EodCampaignFacts | null> {
  const token = profile?.facebook_token
  const adAccountId = profile?.ad_account_id
  if (!token || !adAccountId) return null

  try {
    const cleanAdAccountId = String(adAccountId).startsWith('act_') ? String(adAccountId) : `act_${adAccountId}`
    const url =
      `https://graph.facebook.com/v19.0/${cleanAdAccountId}/campaigns` +
      `?fields=id,name,status,effective_status,insights{spend,actions,results}&limit=25&access_token=${token}`
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[EOD Report Worker] Meta campaigns unavailable (${res.status}); omitting the ads section.`)
      return null
    }
    const data = await res.json()
    const campaigns: any[] = Array.isArray(data?.data) ? data.data : []
    if (!campaigns.length) return { total: 0, active: 0, spendToDate: 0, results: 0 }

    let active = 0
    let spend = 0
    let results = 0
    for (const campaign of campaigns) {
      const status = campaign.effective_status || campaign.status
      if (status === 'ACTIVE') active++
      const insight = campaign.insights?.data?.[0]
      const campaignSpend = Number(insight?.spend)
      if (Number.isFinite(campaignSpend)) spend += campaignSpend
      const resultValue =
        insight?.results?.[0]?.value ??
        insight?.actions?.[0]?.value ??
        null
      const parsedResults = Number(resultValue)
      if (Number.isFinite(parsedResults)) results += parsedResults
    }
    return {
      total: campaigns.length,
      active,
      spendToDate: Math.round(spend * 100) / 100,
      results,
    }
  } catch (e: any) {
    console.warn('[EOD Report Worker] Meta campaigns fetch threw; omitting the ads section:', e?.message || e)
    return null
  }
}

export async function POST(request: Request) {
  try {
    // 1. Security check (Supports direct Authorization, Upstash Forwarded Authorization, and Upstash Signatures)
    const authHeader = request.headers.get('authorization')
    const upstashForwardAuth = request.headers.get('upstash-forward-authorization')
    const upstashSignature = request.headers.get('upstash-signature')

    const isAuthorized = 
      !process.env.CRON_SECRET ||
      authHeader === `Bearer ${process.env.CRON_SECRET}` ||
      upstashForwardAuth === `Bearer ${process.env.CRON_SECRET}` ||
      !!upstashSignature

    if (!isAuthorized) {
      console.warn('[EOD Report Worker] Unauthorized worker execution attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id: profileId } = body

    if (!profileId) {
      return NextResponse.json({ error: 'Missing parameter: id' }, { status: 400 })
    }

    console.log(`[EOD Report Worker] Processing EOD report for profile ID: ${profileId}...`)

    // A. Fetch profile details
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .maybeSingle()

    if (profileErr) throw profileErr
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (profile.enable_eod_report === false) {
      return NextResponse.json({ message: 'EOD report is disabled for this profile' })
    }

    const businessName = profile.business_name || 'Your Workspace'
    const now = new Date()
    // The tenant's local day, not "now minus 24 hours".
    const window = dayWindow(now, profile.timezone)
    const startIso = window.start.toISOString()
    const endIso = window.end.toISOString()
    const previousStartIso = window.previousStart.toISOString()

    // Assets, usage and pages can belong to the paying owner as well as this profile.
    const billingOwnerId = await resolveBillingOwner(supabaseAdmin, profileId).catch(() => profileId)
    const tenantIds = Array.from(
      new Set([profile.id, profile.parent_id, profile.agency_id, billingOwnerId].filter(Boolean) as string[])
    )

    // B. CRM leads (today, the day before, and the pipeline as a whole)
    const leadRows =
      (await readOr<LeadRow[]>(
        () => supabaseAdmin.from('leads').select('id, created_at, pipeline_stage').eq('user_id', profile.id),
        'leads'
      )) || []

    let newLeadsToday = 0
    let newLeadsPreviousDay = 0
    const stageCounts: Record<string, number> = {}

    for (const lead of leadRows) {
      const bucket = classifyInstant(lead.created_at, window)
      if (bucket === 'today') newLeadsToday++
      else if (bucket === 'previous') newLeadsPreviousDay++
      const stage = String(lead.pipeline_stage || 'New Lead').trim() || 'New Lead'
      stageCounts[stage] = (stageCounts[stage] || 0) + 1
    }

    // C. AI voice calls. A log row means a call was ATTEMPTED; the JSON decides
    // whether it connected, so the report never claims a call that did not happen.
    const callRows = await readOr<CallRow[]>(
      () =>
        supabaseAdmin
          .from('lead_history')
          .select('id, created_at, description, leads!inner(user_id)')
          .eq('leads.user_id', profile.id)
          .eq('action_type', 'REMARK')
          .like('description', '🎙️ CALL_JSON:%')
          .gte('created_at', startIso)
          .lt('created_at', endIso),
      'call history'
    )
    const callTally = summarizeCallHistory(callRows)

    // D. WhatsApp messages (today, plus yesterday for context)
    const messageRows =
      (await readOr<MessageRow[]>(
        () =>
          supabaseAdmin
            .from('whatsapp_messages')
            .select('direction, created_at, whatsapp_chats!inner(user_id)')
            .eq('whatsapp_chats.user_id', profile.id)
            .gte('created_at', previousStartIso)
            .lt('created_at', endIso),
        'whatsapp messages'
      )) || []

    let waTotalToday = 0
    let waInboundToday = 0
    let waOutboundToday = 0
    let waPreviousDay = 0

    for (const message of messageRows) {
      const bucket = classifyInstant(message.created_at, window)
      if (bucket === 'today') {
        waTotalToday++
        if (message.direction === 'inbound') waInboundToday++
        else if (message.direction === 'outbound') waOutboundToday++
      } else if (bucket === 'previous') {
        waPreviousDay++
      }
    }

    // E. What the marketing department actually produced today.
    const assetRows = await readOr<AssetRow[]>(
      () =>
        supabaseAdmin
          .from('assets')
          .select('id, type, status, created_at')
          .in('user_id', tenantIds)
          .gte('created_at', startIso)
          .lt('created_at', endIso),
      'assets'
    )

    let creativesCreated: number | null = null
    let videosCreated: number | null = null
    let assetsReady: number | null = null
    let assetsFailed: number | null = null

    if (assetRows) {
      creativesCreated = 0
      videosCreated = 0
      assetsReady = 0
      assetsFailed = 0
      for (const asset of assetRows) {
        if (String(asset.type || '').toLowerCase() === 'video') videosCreated++
        else creativesCreated++
        if (isAssetReady(asset.status)) assetsReady++
        else if (isAssetFailed(asset.status)) assetsFailed++
      }
    }

    const pageRows = await readOr<PageRow[]>(
      () =>
        supabaseAdmin
          .from('landing_pages')
          .select('id, slug, created_at')
          .in('user_id', tenantIds)
          .gte('created_at', startIso)
          .lt('created_at', endIso),
      'landing pages'
    )
    // The website itself is reported as a site build, so it is not counted twice.
    const pagesPublished = pageRows ? pageRows.filter((page) => String(page.slug || '') !== 'index').length : null

    const siteJobs = await readOr<JobRow[]>(
      () =>
        supabaseAdmin
          .from('site_build_jobs')
          .select('id, status')
          .in('user_id', tenantIds)
          .eq('status', 'completed')
          .gte('updated_at', startIso)
          .lt('updated_at', endIso),
      'site builds'
    )
    const sitesBuilt = siteJobs ? siteJobs.length : null

    // F. Money: credits spent today from the ledger, balance from the paying owner.
    const ledgerRows = await readOr<LedgerRow[]>(
      () =>
        supabaseAdmin
          .from('credit_transactions')
          .select('amount, created_at')
          .eq('user_id', billingOwnerId)
          .gte('created_at', startIso)
          .lt('created_at', endIso),
      'credit ledger'
    )
    const creditsSpentToday = ledgerRows ? sumCreditSpend(ledgerRows) : null

    const usageRows = await readOr<UsageRow[]>(
      () =>
        supabaseAdmin
          .from('usage_events')
          .select('cost_inr')
          .in('user_id', tenantIds)
          .gte('created_at', startIso)
          .lt('created_at', endIso),
      'usage events'
    )
    const usageCostToday =
      usageRows && usageRows.length
        ? Math.round(usageRows.reduce((sum, row) => sum + (Number(row.cost_inr) || 0), 0) * 100) / 100
        : usageRows
          ? 0
          : null

    const balance = await creditBalance(supabaseAdmin, profileId).catch(() => null)
    const creditsLeft = balance != null ? balance : profile.credits != null ? Number(profile.credits) : null

    // G. Daily routine state (business_routines + today's routine_runs row).
    let routine: EodRoutineFacts | null = null
    const routineRows = await readOr<RoutineRow[]>(
      () =>
        supabaseAdmin
          .from('business_routines')
          .select('id, name, cadence, enabled, last_run_at')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: true }),
      'routines'
    )

    if (routineRows && routineRows.length) {
      const primary = routineRows.find((row) => row.enabled !== false) || routineRows[0]
      const runRows = await readOr<RunRow[]>(
        () =>
          supabaseAdmin
            .from('routine_runs')
            .select('status, period_key')
            .in('routine_id', routineRows.map((row) => row.id))
            .eq('period_key', window.periodKey)
            .order('updated_at', { ascending: false })
            .limit(1),
        'routine runs'
      )
      routine = {
        enabled: primary.enabled !== false,
        name: primary.name ?? null,
        cadence: primary.cadence ?? null,
        todayRunStatus: runRows && runRows.length ? runRows[0].status ?? null : null,
        lastRunAt: primary.last_run_at ?? null,
      }
    }

    // H. Playbook: positioning, industry and the agent's own daily plan.
    const playbook = await getActivePlaybook(supabaseAdmin, profile.id).catch(() => null)
    const positioning = playbook?.positioning || profile.mission_statement || null
    const industry = profile.industry ?? playbook?.industry ?? null
    const dailyRoutineJobs = extractRoutineJobs((playbook as any)?.daily_routine)

    // I. Meta campaigns (one fetch, both channels)
    const campaigns = await fetchMetaCampaigns(profile)

    // J. Build the report. Pure function: no clock, no database, no network.
    const report: EodReport = buildEodReport({
      now,
      timezone: profile.timezone,
      currency: profile.currency,
      businessName,
      industry,
      positioning,
      dashboardUrl: DASHBOARD_URL,
      leads: {
        total: leadRows.length,
        newToday: newLeadsToday,
        newPreviousDay: newLeadsPreviousDay,
        pipeline: Object.entries(stageCounts).map(([stage, count]) => ({ stage, count })),
      },
      whatsapp: {
        totalToday: waTotalToday,
        inboundToday: waInboundToday,
        outboundToday: waOutboundToday,
        previousDayTotal: waPreviousDay,
      },
      calls: callTally,
      production: {
        creatives: creativesCreated,
        videos: videosCreated,
        assetsReady,
        assetsFailed,
        pagesPublished,
        sitesBuilt,
      },
      credits: {
        spentToday: creditsSpentToday,
        balance: creditsLeft,
        usageCostToday,
      },
      routine,
      dailyRoutineJobs,
      campaigns,
    })

    console.log(
      `[EOD Report Worker] ${profileId} · ${report.periodKey} (${report.timezone}) · ` +
        `sentiment=${report.sentiment} · leads=${newLeadsToday} · wa=${waTotalToday} · ` +
        `calls=${callTally.connected}/${callTally.attempted} · produced=${report.metrics.find((m) => m.key === 'produced')?.value ?? 0}`
    )

    // ---------------------------------------------------------------
    // Dispatch 1: the email
    // ---------------------------------------------------------------
    let emailResult: { success: boolean } = { success: false }
    if (profile.email) {
      const { resolveNotificationRecipients } = await import('@/utils/email-helper')
      const { toEmail, bccEmail } = resolveNotificationRecipients(profile)
      emailResult = await sendDailyEodReportEmail(toEmail || profile.email, businessName, report.html, bccEmail)
      console.log(
        `[EOD Report Worker] EOD email status for ${toEmail || profile.email} (BCC: ${bccEmail || 'none'}): success=${emailResult.success}`
      )
    } else {
      console.log(`[EOD Report Worker] No email for profile ${profileId}, skipping email dispatch.`)
    }

    // ---------------------------------------------------------------
    // Dispatch 2: push + WhatsApp via the platform's own channels
    // ---------------------------------------------------------------
    try {
      const { sendAdminMultiChannelNotification } = await import('@/utils/notification-helper')
      await sendAdminMultiChannelNotification({
        ownerUserId: profileId,
        title: `End of day — ${report.dateLabel}`,
        body: report.whatsappText,
        url: '/dashboard',
        type: 'eod_report',
        skipEmail: true // Email is already sent by sendDailyEodReportEmail right above
      })
    } catch (notifErr: any) {
      console.error(`[EOD Report Worker] Failed to send multi-channel Push/WhatsApp notification:`, notifErr)
    }

    // ===================================================================
    // Dispatch 3: EOD REPORT VIA WHATSAPP FROM CLIENT'S OWN WABA
    // This is the second daily WhatsApp notification — sent at 7 PM IST
    // from the client's own WABA phone number to admin's personal number.
    // ===================================================================
    try {
      const clientWabaToken = profile.whatsapp_access_token || profile.facebook_token
      const clientWabaPhoneId = profile.whatsapp_phone_number_id
      const adminPhone = profile.whatsapp_personal_number || profile.contact_number

      if (clientWabaToken && clientWabaPhoneId && adminPhone) {
        let cleanAdminPhone = (adminPhone || '').replace(/\D/g, '')
        if (cleanAdminPhone.length === 10) {
          cleanAdminPhone = `91${cleanAdminPhone}`
        }

        console.log(`[EOD Report Worker] Sending EOD WhatsApp report from client WABA (${clientWabaPhoneId}) to admin ${cleanAdminPhone}...`)

        const eodWaMetaUrl = `https://graph.facebook.com/v20.0/${clientWabaPhoneId}/messages`
        const eodWaRes = await fetch(eodWaMetaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${clientWabaToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanAdminPhone,
            type: 'text',
            text: { body: report.whatsappText }
          })
        })

        if (eodWaRes.ok) {
          console.log(`[EOD Report Worker] ✅ EOD WhatsApp report delivered from client WABA to ${cleanAdminPhone}`)
        } else {
          const eodWaErr = await eodWaRes.json().catch(() => ({}))
          console.warn(`[EOD Report Worker] EOD WhatsApp report failed (${eodWaRes.status}):`, eodWaErr)

          // Fallback: Try sending via a template if free-form fails (24h window closed)
          try {
            // Template parameter 2 is a one-line summary built from the SAME
            // metrics the email renders, so the two never disagree.
            const summaryLine =
              report.metrics.map((metric) => `${metric.label}: ${metric.value}`).join(' | ') || report.headline

            const templatePayload = {
              messaging_product: 'whatsapp',
              to: cleanAdminPhone,
              type: 'template',
              template: {
                name: 'eod_report_notification',
                language: { code: 'en_US' },
                components: [
                  {
                    type: 'body',
                    parameters: [
                      { type: 'text', text: businessName },
                      { type: 'text', text: summaryLine.slice(0, 250) },
                      { type: 'text', text: DASHBOARD_URL }
                    ]
                  }
                ]
              }
            }

            const templateRes = await fetch(eodWaMetaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${clientWabaToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(templatePayload)
            })

            if (templateRes.ok) {
              console.log(`[EOD Report Worker] ✅ EOD WhatsApp template fallback delivered to ${cleanAdminPhone}`)
            } else {
              console.warn(`[EOD Report Worker] EOD WhatsApp template fallback also failed.`)
            }
          } catch (templateErr) {
            console.warn('[EOD Report Worker] Template fallback exception:', templateErr)
          }
        }
      } else {
        console.log(`[EOD Report Worker] Client WABA not configured for profile ${profileId}. Skipping EOD WhatsApp from own WABA.`)
      }
    } catch (eodWaErr: any) {
      console.error(`[EOD Report Worker] EOD WhatsApp from client WABA error:`, eodWaErr)
    }

    // ---------------------------------------------------------------
    // Billing: charge 1 credit only for a report that actually sent and carried
    // a fact worth reading — and at most once per tenant per local day, because
    // this worker is retried by Upstash.
    // ---------------------------------------------------------------
    if (emailResult.success) {
      const chargeDescription = eodChargeDescription(report.periodKey)
      try {
        const { data: existing } = await supabaseAdmin
          .from('credit_transactions')
          .select('id')
          .eq('user_id', billingOwnerId)
          .eq('description', chargeDescription)
          .limit(1)

        if (existing && existing.length) {
          console.log(`[EOD Report Worker] Already charged for ${report.periodKey}; not charging again.`)
        } else if (report.sentiment === 'quiet') {
          console.log(`[EOD Report Worker] Zero-activity day for ${profileId}; not charging for an empty report.`)
        } else {
          await deductCredits(supabaseAdmin, profileId, 1, 'ai_generation', chargeDescription)
        }
      } catch (creditErr) {
        console.error(`[EOD Report Worker] Failed to deduct credits for EOD report:`, creditErr)
      }
    }

    return NextResponse.json({
      success: emailResult.success,
      periodKey: report.periodKey,
      sentiment: report.sentiment,
    })
  } catch (error: any) {
    console.error('[EOD Report Worker] Execution failed:', error)
    return NextResponse.json({ error: error.message || 'Worker execution failed' }, { status: 500 })
  }
}
