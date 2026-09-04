import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { calculateLeadScore, parseCustomFields } from '@/utils/lead-scoring'

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

        const isForce = url.searchParams.get('force') === 'true'
        const istDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date())
        const isSaturday = istDay === 'Sat'

        if (!isSaturday && !isForce) {
            console.log(`[WhatsApp Weekly Followup Cron] Today is ${istDay} (Not Saturday). Weekly followups run strictly on Saturdays. Skipping.`)
            return NextResponse.json({
                success: true,
                message: `Today is ${istDay}. Weekly followups are scheduled strictly for Saturdays.`,
                isSaturday: false
            })
        }

        const now = Date.now()
        const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000 // Minimum 6 days spacing to prevent duplicate Saturday dispatches

        // 1. Fetch leads across all accounts
        const { data: leads, error: leadsErr } = await supabaseAdmin
            .from('leads')
            .select('id, user_id, name, phone, email, booked_time, pipeline_stage, status, custom_fields, created_at')
            .not('phone', 'is', null)
            .is('booked_time', null)
            .not('pipeline_stage', 'in', '("Won", "Deal/Token", "Lost/NI", "Dealer", "Already Purchased")')
            .order('created_at', { ascending: false })
            .limit(200)

        if (leadsErr) throw leadsErr

        if (!leads || leads.length === 0) {
            return NextResponse.json({ success: true, message: 'No leads found to scan.' })
        }

        let sentCount = 0
        let skippedCount = 0

        const profileCache = new Map<string, any>()

        for (const lead of leads) {
            try {
                const cf = parseCustomFields(lead.custom_fields)

                // Check opt-out
                if (cf.opt_out || cf.unsubscribed_at || lead.status === 'not_interested') {
                    skippedCount++
                    continue
                }

                // Check qualification score (Qualified and above: Score >= 40 or warm/hot)
                const scoreResult = calculateLeadScore(lead, ['property_type', 'budget', 'timeline'])
                const isQualified = scoreResult.score >= 40 || ['warm', 'hot'].includes(scoreResult.tier)
                
                if (!isQualified) {
                    skippedCount++
                    continue
                }

                // Check weekly interval (Must be at least 7 days since last weekly followup)
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
                        .select('id, business_name, email, custom_domain, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
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

                // Strictly ensure weekly inventory showcase followups ONLY run for real estate accounts with property inventory
                // NEVER for Nobogent SaaS or non-real estate accounts
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

                const { count: propCount } = await supabaseAdmin
                    .from('properties')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', lead.user_id)

                if (!propCount || propCount === 0) {
                    skippedCount++
                    continue
                }

                const waToken = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN
                const waPhoneId = profile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID

                if (!waToken || !waPhoneId) {
                    skippedCount++
                    continue
                }

                const cleanPhone = (lead.phone || '').replace(/\D/g, '')
                if (cleanPhone.length < 10) {
                    skippedCount++
                    continue
                }

                const businessName = profile.business_name || 'our team'
                const leadName = (lead.name && !lead.name.startsWith('+') && lead.name !== 'Customer') ? lead.name : 'there'
                const promptText = `Hi ${leadName}! 👋 Following up from ${businessName} with our latest curated property opportunities and project updates.\n\nWhat would you like to do?`

                // Send 3-Button Weekly Follow-Up Message via Meta Graph API
                const metaUrl = `https://graph.facebook.com/v20.0/${waPhoneId}/messages`
                const payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'interactive',
                    interactive: {
                        type: 'button',
                        body: { text: promptText },
                        action: {
                            buttons: [
                                { type: 'reply', reply: { id: 'view_properties', title: 'View properties' } },
                                { type: 'reply', reply: { id: 'talk_expert', title: 'Talk to an expert' } },
                                { type: 'reply', reply: { id: 'book_appointment', title: 'Book an appointment' } }
                            ]
                        }
                    }
                }

                const sendRes = await fetch(metaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${waToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                })

                if (sendRes.ok) {
                    sentCount++

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
            diagnostics
        })
    } catch (err: any) {
        console.error('[WhatsApp Weekly Followup Cron Fatal Error]:', err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
