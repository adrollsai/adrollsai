import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { outboundRecipient } from '@/lib/automation/test-mode';
import { calculateLeadScore, parseCustomFields } from '@/utils/lead-scoring'
import type { ProcessResult } from '@/lib/automation/journey'
import { chooseWeeklyTemplate, weeklyCheckinPreview, type WeeklyTemplateChoice } from '@/lib/automation/weekly-broadcast'

/**
 * Which check-in template this account should send.
 *
 * Memoised per account for the run: a 16,000-lead book must not make 16,000 calls to Meta to ask the
 * same question. An account whose templates cannot be listed falls back to the generic template only if
 * we cannot establish approval at all — never to a guess.
 */
const weeklyTemplateCache = new Map<string, WeeklyTemplateChoice>()

async function weeklyTemplateFor(profile: any): Promise<WeeklyTemplateChoice> {
    const accountId = String(profile?.id ?? 'unknown')
    const cached = weeklyTemplateCache.get(accountId)
    if (cached) return cached

    let approved: string[] = []
    let listed = false
    try {
        const { listWhatsAppTemplates } = await import('@/lib/whatsapp/templates')
        const templates = await listWhatsAppTemplates(supabaseAdmin, accountId)
        listed = true
        approved = (templates || [])
            .filter((template: any) => String(template?.status || '').toUpperCase() === 'APPROVED')
            .map((template: any) => String(template?.name || ''))
    } catch (error: any) {
        console.warn(`[Weekly Followup] ${accountId}: could not list templates — ${error?.message || error}`)
    }

    const choice = listed
        ? chooseWeeklyTemplate({ industry: profile?.industry ?? null, approved })
        : {
              template: null,
              source: 'none' as const,
              reason:
                  'the approved templates could not be read, so no check-in is sent — sending a template ' +
                  'we cannot confirm is approved is how a broadcast fails silently for every lead',
          }

    weeklyTemplateCache.set(accountId, choice)
    console.log(`[Weekly Followup] ${accountId}: ${choice.source} — ${choice.reason}`)
    return choice
}

// Force dynamic execution to bypass Next.js static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch }
  }
)

export async function GET(request: Request) {
    return handleWhatsappWeeklyFollowups(request)
}

export async function POST(request: Request) {
    return handleWhatsappWeeklyFollowups(request)
}

async function handleWhatsappWeeklyFollowups(request: Request) {
    const diagnostics: any[] = []
    try {
        const url = new URL(request.url)
        const authHeader = request.headers.get('Authorization')
        const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

        console.log('[WhatsApp Weekly Followup Cron] Running weekly followups scanner for qualified leads...')

        if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
            console.warn('[WhatsApp Weekly Followup Cron] Unauthorized access attempt.')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // ------------------------------------------------------------------
        // P7 LEAD JOURNEY PASS — every day, before the weekly drip below.
        //
        // The journey's own steps (first reply / T+1h / T+1d) are due once each
        // and are claimed inside the engine, so this cron firing twice in a
        // minute still sends once. Opt-out and handoff are re-read before every
        // send, so a lead who said "stop" is never messaged again — and a step
        // that policy refuses is recorded as blocked with its reason rather than
        // disappearing.
        //
        // Deliberately the SAME cron and the same table as nothing else: there is
        // no second queue to keep in sync.
        // ------------------------------------------------------------------
        let journeyResult: ProcessResult | null = null
        try {
            const { sendDueJourneySteps } = await import('@/lib/automation/journey-store')
            journeyResult = await sendDueJourneySteps(supabaseAdmin, { limit: 50 })
            if (journeyResult.checked > 0) {
                console.log(
                    `[Lead Journey] due=${journeyResult.checked} sent=${journeyResult.sent} ` +
                    `blocked=${journeyResult.blocked} cancelled=${journeyResult.cancelled}`
                )
                for (const action of journeyResult.actions || []) {
                    if (action.action !== 'sent') {
                        console.log(`[Lead Journey] ${action.action} lead=${action.leadId} step=${action.stepId} — ${action.reason || ''}`)
                    }
                }
            }
        } catch (journeyErr) {
            const message = journeyErr instanceof Error ? journeyErr.message : String(journeyErr)
            console.warn('[Lead Journey] due-step pass failed:', message)
        }

        const isForce = url.searchParams.get('force') === 'true'
        const istDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date())
        const isSaturday = istDay === 'Sat'

        if (!isSaturday && !isForce) {
            console.log(`[WhatsApp Weekly Followup Cron] Today is ${istDay} (Not Saturday). Weekly followups run strictly on Saturdays. Skipping.`)
            return NextResponse.json({
                success: true,
                message: `Today is ${istDay}. Weekly followups are scheduled strictly for Saturdays.`,
                isSaturday: false,
                journey: journeyResult
            })
        }

        const now = Date.now()
        const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000 // Minimum 6 days spacing to prevent duplicate Saturday dispatches

        // 1. Fetch leads across all accounts (excluding Lost, Won, and Not Interested categories)
        const { data: leads, error: leadsErr } = await supabaseAdmin
            .from('leads')
            .select('id, user_id, name, phone, email, booked_time, pipeline_stage, status, custom_fields, created_at')
            .not('phone', 'is', null)
            .is('booked_time', null)
            .not('pipeline_stage', 'in', '("Won", "Deal/Token", "Deal / Token Paid", "Lost", "Lost/NI", "Not Interested", "Dealer", "Already Purchased", "Unqualified")')
            .order('created_at', { ascending: false })
            .limit(500)

        if (leadsErr) throw leadsErr

        if (!leads || leads.length === 0) {
            return NextResponse.json({ success: true, message: 'No leads found to scan.', journey: journeyResult })
        }

        let sentCount = 0
        let skippedCount = 0

        const profileCache = new Map<string, any>()

        for (const lead of leads) {
            try {
                const cf = parseCustomFields(lead.custom_fields)

                // Check opt-out or explicit non-interest
                const isLostOrNotInterested = 
                    cf.opt_out || 
                    cf.unsubscribed_at || 
                    lead.status === 'not_interested' || 
                    lead.status === 'lost' ||
                    lead.pipeline_stage === 'Lost' ||
                    lead.pipeline_stage === 'Lost/NI' ||
                    lead.pipeline_stage === 'Not Interested'

                if (isLostOrNotInterested) {
                    skippedCount++
                    continue
                }

                // P7: a lead that is on its own journey is messaged by the journey
                // (first reply / T+1h / T+1d), not by this weekly drip. Without
                // this guard one lead would have two automated schedules.
                if (cf.journey_started_at) {
                    skippedCount++
                    continue
                }

                // Check weekly interval (Must be at least 6 days since last weekly followup)
                const lastWeeklyFollowup = cf.last_weekly_followup_at ? new Date(cf.last_weekly_followup_at).getTime() : 0
                const createdTime = new Date(lead.created_at).getTime()
                
                // If never followed up, wait at least 24h after lead creation before starting the weekly drip
                if (!lastWeeklyFollowup) {
                    if (now - createdTime < 24 * 60 * 60 * 1000) {
                        skippedCount++
                        continue
                    }
                } else if (now - lastWeeklyFollowup < SIX_DAYS_MS) {
                    skippedCount++
                    continue
                }

                // Fetch owner profile
                let profile = profileCache.get(lead.user_id)
                if (!profile) {
                    const { data: fetchedProfile } = await supabaseAdmin
                        .from('profiles')
                        .select('id, business_name, email, industry, custom_domain, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
                        .eq('id', lead.user_id)
                        .maybeSingle()
                    if (fetchedProfile) {
                        profile = fetchedProfile
                        profileCache.set(lead.user_id, fetchedProfile)
                    }
                }

                if (!profile) {
                    skippedCount++
                    continue
                }

                // Strictly ensure Nobogent SaaS internal test accounts do not blast automated prospect messages
                const isNobogentSaaS = 
                    lead.user_id === 'bc63c065-9bcc-4793-bedc-f0960406425b' ||
                    lead.user_id === '91553adf-20b5-4c4c-9614-6b6f89fd0bfd' ||
                    lead.user_id === 'b1645a6d-4b73-41ef-a197-8247d0168905' ||
                    (profile.email || '').toLowerCase().includes('nobogent') || 
                    (profile.email || '').toLowerCase() === 'rchopra489@gmail.com' ||
                    (profile.business_name || '').toLowerCase().includes('nobogent') ||
                    (profile.business_name || '').toLowerCase().includes('adrolls')
                if (isNobogentSaaS) {
                    skippedCount++
                    continue
                }

                // MUST be the tenant's own WhatsApp Business credentials.
                // This used to fall back to `facebook_token` and then to
                // DEV_WHATSAPP_ACCESS_TOKEN / DEV_WHATSAPP_PHONE_ID, both of
                // which are configured — so a tenant who had never connected
                // WhatsApp still had their leads messaged, from Nobogent's own
                // number, on Nobogent's Meta bill.
                const waToken = profile.whatsapp_access_token
                const waPhoneId = profile.whatsapp_phone_number_id

                if (!waToken || !waPhoneId) {
                    skippedCount++
                    continue
                }

                const cleanPhone = (outboundRecipient(lead.phone) || '').replace(/\D/g, '')
                if (cleanPhone.length < 10) {
                    skippedCount++
                    continue
                }

                const businessName = profile.business_name || 'our team'
                const leadName = (lead.name && !lead.name.startsWith('+') && lead.name !== 'Customer') ? lead.name : 'there'
                
                // Business-initiated weekly re-engagement MUST be a template.
                // The previous interactive message is rejected by Meta outside
                // the 24h service window (131047), so it could only ever reach
                // a lead who had already replied within the last day — i.e.
                // essentially nobody.
                //
                /**
                 * WHICH TEMPLATE, FOR WHICH INDUSTRY.
                 *
                 * Buttons live inside an approved template — Meta approves the words — so tailoring the
                 * check-in per industry means choosing a different APPROVED template, not rewording one.
                 * A real-estate account with a property check-in approved gets "View Properties";
                 * everyone else gets the variable-free generic one; and if neither is approved we do not
                 * send at all, because Meta rejects an unknown name and the owner would be left thinking
                 * the broadcast ran.
                 */
                const weekly = await weeklyTemplateFor(profile)
                if (!weekly.template) {
                    console.warn(`[Weekly Followup] ${lead.user_id}: ${weekly.reason}`)
                    skippedCount++
                    continue
                }

                const metaUrl = `https://graph.facebook.com/v20.0/${waPhoneId}/messages`
                const payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'template',
                    template: {
                        name: weekly.template,
                        language: { code: 'en_US' }
                    }
                }

                // Rendered copy for our own chat/inbox log — what the customer actually receives.
                const promptText = weeklyCheckinPreview(weekly.template)

                const sendRes = await fetch(metaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${waToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                })

                // Guardrail: daily message cap.
                let sendAllowed = true
                try {
                  const { canSpend } = await import('@/lib/automation/ceo')
                  const cap = await canSpend(supabaseAdmin, lead.user_id, 'message', 0, 1)
                  if (!cap.allowed) {
                    console.log(
                      '[Weekly Followup] daily message cap reached for ' + lead.user_id +
                      ' (' + (cap.reason || 'cap') + ' ' + cap.used + '/' + cap.cap + ')'
                    )
                    skippedCount++
                    sendAllowed = false
                  }
                } catch {}

                if (sendAllowed && sendRes.ok) {
                    sentCount++

                    // Ledger for the message cap.
                    try {
                      const { recordSpend } = await import('@/lib/automation/ceo')
                      await recordSpend(supabaseAdmin, lead.user_id, 'message', 0, 1)
                    } catch {}

                    // Update lead custom fields with timestamp & count
                    const updatedCount = (cf.weekly_followup_count || 0) + 1
                    cf.last_weekly_followup_at = new Date().toISOString()
                    cf.weekly_followup_count = updatedCount

                    await supabaseAdmin
                        .from('leads')
                        .update({ custom_fields: cf })
                        .eq('id', lead.id)

                    // Find or create chat
                    let { data: chat } = await supabaseAdmin
                        .from('whatsapp_chats')
                        .select('id')
                        .eq('user_id', lead.user_id)
                        .eq('recipient_phone', cleanPhone)
                        .maybeSingle()

                    if (!chat) {
                        const { data: newChat } = await supabaseAdmin
                            .from('whatsapp_chats')
                            .insert({
                                user_id: lead.user_id,
                                recipient_phone: cleanPhone,
                                recipient_name: lead.name || null,
                                lead_id: lead.id,
                                last_message_text: promptText,
                                unread_count: 0
                            })
                            .select('id')
                            .single()
                        chat = newChat
                    }

                    if (chat) {
                        await supabaseAdmin.from('whatsapp_messages').insert({
                            chat_id: chat.id,
                            direction: 'outbound',
                            message_text: `${promptText} [Buttons: View properties | Talk to an expert | Book an appointment]`
                        })

                        await supabaseAdmin.from('whatsapp_chats').update({
                            last_message_text: promptText,
                            updated_at: new Date().toISOString()
                        }).eq('id', chat.id)
                    }

                    // Log in lead_history
                    await supabaseAdmin.from('lead_history').insert({
                        lead_id: lead.id,
                        action_type: 'FOLLOW_UP',
                        description: `📨 Sent Weekly Real Estate Follow-up #${updatedCount} via WhatsApp.`,
                        created_at: new Date().toISOString()
                    })

                    diagnostics.push({ leadId: lead.id, phone: cleanPhone, status: 'sent', weeklyFollowupCount: updatedCount })
                } else {
                    const errJson = await sendRes.json()
                    console.error(`[WhatsApp Weekly Followup] Send failed for lead ${lead.id}:`, errJson)
                    diagnostics.push({ leadId: lead.id, phone: cleanPhone, status: 'failed', error: errJson })
                }
            } catch (leadErr: any) {
                console.error(`[WhatsApp Weekly Followup] Error processing lead ${lead.id}:`, leadErr.message)
            }
        }

        return NextResponse.json({
            success: true,
            scannedCount: leads.length,
            sentCount,
            skippedCount,
            journey: journeyResult,
            diagnostics
        })
    } catch (err: any) {
        console.error('[WhatsApp Weekly Followup Cron Fatal Error]:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
