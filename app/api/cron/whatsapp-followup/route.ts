import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callGemini } from '@/utils/external-apis'

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
    return handleWhatsappFollowups(request)
}

export async function POST(request: Request) {
    return handleWhatsappFollowups(request)
}

async function handleWhatsappFollowups(request: Request) {
    const diagnostics: any[] = []
    try {
        const url = new URL(request.url)
        const authHeader = request.headers.get('Authorization')
        const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

        console.log('[WhatsApp Followup Cron] Running 24h followups scanner...')

        if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
            console.warn('[WhatsApp Followup Cron] Unauthorized access attempt.')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Fetch chats active within the last 24 hours (if older than 24h, the customer service window is closed)
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: chats, error: chatsErr } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('*')
            .gte('updated_at', yesterday)

        if (chatsErr) throw chatsErr

        if (!chats || chats.length === 0) {
            return NextResponse.json({ success: true, message: 'No recently active chats to scan.' })
        }

        const now = Date.now()
        let sentCount = 0

        for (const chat of chats) {
            // Fetch last 15 messages for chronological chat history and follow-up calculation
            const { data: messages, error: msgErr } = await supabaseAdmin
                .from('whatsapp_messages')
                .select('*')
                .eq('chat_id', chat.id)
                .order('created_at', { ascending: false })
                .limit(15)

            if (msgErr || !messages || messages.length === 0) continue

            // Find the customer's last inbound message
            const lastInbound = messages.find(m => m.direction === 'inbound')
            if (!lastInbound) continue

            const inboundTime = new Date(lastInbound.created_at).getTime()
            const timeSinceInbound = now - inboundTime
            const twentyFourHours = 24 * 60 * 60 * 1000
            const fortyEightHours = 48 * 60 * 60 * 1000
            const seventyTwoHours = 72 * 60 * 60 * 1000

            // Guardrail: Skip if the very last message in the chat (inbound or outbound) was sent less than 2 hours ago
            const lastMessage = messages[0]
            const timeSinceLastMessage = now - new Date(lastMessage.created_at).getTime()
            if (timeSinceLastMessage < 2 * 60 * 60 * 1000) {
                continue
            }

            // Filter outbound messages sent after the customer's last inbound message
            const outboundAfterInbound = messages.filter(m => 
                m.direction === 'outbound' && 
                new Date(m.created_at).getTime() > inboundTime
            )

            // Spacing thresholds: Count outbound messages sent > 5 minutes after the customer's last message
            const fiveMinutes = 5 * 60 * 1000
            const followups = outboundAfterInbound.filter(m => 
                new Date(m.created_at).getTime() > (inboundTime + fiveMinutes)
            )
            const numFollowups = followups.length

            let isDue = false
            let followupStage = 0
            let isTemplate = false
            let templateName = ''
            let templateParams: string[] = []

            if (timeSinceInbound <= twentyFourHours) {
                if (numFollowups === 0 && timeSinceInbound >= 2 * 60 * 60 * 1000) {
                    isDue = true
                    followupStage = 1
                } else if (numFollowups === 1 && timeSinceInbound >= 8 * 60 * 60 * 1000) {
                    isDue = true
                    followupStage = 2
                } else if (numFollowups === 2 && timeSinceInbound >= 20 * 60 * 60 * 1000) {
                    isDue = true
                    followupStage = 3
                }
            } else if (timeSinceInbound <= fortyEightHours) {
                if (numFollowups <= 3) {
                    isDue = true
                    followupStage = 4
                    isTemplate = true
                    templateName = 'auto_drip_followup_24h'
                }
            } else if (timeSinceInbound <= seventyTwoHours) {
                if (numFollowups <= 4) {
                    isDue = true
                    followupStage = 5
                    isTemplate = true
                    templateName = 'auto_drip_followup_48h'
                }
            }

            if (!isDue) continue

            // Fetch owner's WhatsApp credentials and business profile info
            const { data: profile } = await supabaseAdmin
                .from('profiles')
                .select('whatsapp_access_token, whatsapp_phone_number_id, business_name, business_info, whatsapp_catalogue_button_text, whatsapp_buttons, custom_domain')
                .eq('id', chat.user_id)
                .maybeSingle()

            if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
                continue
            }

            templateParams = [chat.recipient_name || 'there', profile.business_name || 'our team']

            // Fetch active properties in owner's inventory to enrich the AI context
            const { data: properties } = await supabaseAdmin
                .from('properties')
                .select('title, price, address, property_type, description')
                .eq('user_id', chat.user_id)
                .limit(8)

            let propertiesText = 'No active listings in inventory.'
            if (properties && properties.length > 0) {
                propertiesText = properties
                    .map(p => `- ${p.title} (${p.property_type || 'Listing'}): ${p.price || 'N/A'}, Address: ${p.address || 'N/A'}, Description: ${p.description || 'N/A'}`)
                    .join('\n')
            }

            // Retrieve matching CRM lead to log history and get source attribution context
            const { data: matchedLeads } = await supabaseAdmin
                .from('leads')
                .select('id, source, ad_name, form_name')
                .eq('user_id', chat.user_id)
                .ilike('phone', `%${chat.recipient_phone.slice(-10)}%`)

            const matchedLead = matchedLeads?.[0]
            let leadContextText = ''
            if (matchedLead) {
                leadContextText = `Lead Source: ${matchedLead.source || 'Unknown'}\nAd Campaign/Property: ${matchedLead.ad_name || 'N/A'}\nLead Form: ${matchedLead.form_name || 'N/A'}`
            }

            // Build chronological chat history
            const chatHistory = [...messages]
                .reverse()
                .map(m => `${m.direction === 'inbound' ? 'User' : 'Assistant'}: ${m.message_text}`)
                .join('\n')

            const systemPrompt = `
You are an AI follow-up assistant for "${profile.business_name || 'our company'}".
Here is information about our business:
${profile.business_info || 'AI marketing systems, client acquisition, and growth automation.'}

Business Offerings / Products:
${propertiesText}

Lead Context:
${leadContextText || 'No background metadata available.'}

Recent conversation history:
${chatHistory}

The customer has not replied to our last message. Generate a highly natural, polite, and brief follow-up text message (under 30 words) in English suitable for WhatsApp to re-engage the customer.
Guidelines:
1. Refer strictly to our business ("${profile.business_name || 'our company'}") and the preceding conversation topic.
2. If the user hasn't requested specific product/service details yet, ask if they have any questions about our offerings or if they would like to discuss their requirements.
3. NEVER mention properties, listings, real estate, residential, or commercial unless our business explicitly sells real estate.
4. Do NOT repeat hi/hello greetings if we already greeted them. Keep it casual, friendly, and helpful.
5. Output ONLY the raw response string. No JSON, no markdown code blocks, no quotes around the reply.`

            try {
                let metaPayload: any = null
                let logText = ''
                let isFallback = false

                if (isTemplate) {
                    metaPayload = {
                        messaging_product: 'whatsapp',
                        to: chat.recipient_phone,
                        type: 'template',
                        template: {
                            name: templateName,
                            language: { code: 'en_US' },
                            components: [
                                {
                                    type: 'body',
                                    parameters: templateParams.map(val => ({ type: 'text', text: val }))
                                }
                            ]
                        }
                    }
                    logText = `Sent Template: ${templateName}`
                } else {
                    const aiRes = await callGemini(systemPrompt)
                    const replyText = aiRes.trim().replace(/^"|"$/g, '')
                    if (!replyText) continue

                    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
                    const catalogueLink = profile.custom_domain 
                        ? `https://${profile.custom_domain}` 
                        : `${appUrl}/shared/${chat.user_id}`

                    const catalogueBtnText = profile.whatsapp_catalogue_button_text || 'See Products'
                    let buttons = [{ text: catalogueBtnText, url: catalogueLink }]
                    if (profile.whatsapp_buttons && Array.isArray(profile.whatsapp_buttons) && profile.whatsapp_buttons.length > 0) {
                        buttons = profile.whatsapp_buttons.map((btn: any, idx: number) => {
                            let url = btn.url ? btn.url.trim() : ''
                            if (!url) {
                                url = catalogueLink
                            } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
                                url = 'https://' + url
                            }
                            return {
                                text: (btn.text || (idx === 0 ? catalogueBtnText : 'View Link')).slice(0, 20),
                                url: url
                            }
                        })
                    }

                    metaPayload = {
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: chat.recipient_phone,
                        type: 'interactive',
                        interactive: {
                            type: 'cta_url',
                            body: {
                                text: replyText
                            },
                            action: {
                                name: 'cta_url',
                                parameters: {
                                    display_text: buttons[0].text,
                                    url: buttons[0].url
                                }
                            }
                        }
                    }
                    logText = replyText
                }

                // Send message via Meta API
                const metaUrl = `https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}/messages`
                let metaRes = await fetch(metaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(metaPayload)
                })

                let sendData = await metaRes.json()

                // Fallback to Template if free-form text failed due to 24h customer service window expiration
                if (sendData.error && !isTemplate && (sendData.error.code === 131047 || sendData.error.error_subcode === 2494010)) {
                    console.log(`[WhatsApp Followup Cron] Free-form failed due to 24h limit for ${chat.recipient_phone}, falling back to Meta template...`)
                    isFallback = true
                    const fallbackPayload = {
                        messaging_product: 'whatsapp',
                        to: chat.recipient_phone,
                        type: 'template',
                        template: {
                            name: 'auto_drip_followup_24h',
                            language: { code: 'en_US' },
                            components: [
                                {
                                    type: 'body',
                                    parameters: templateParams.map(val => ({ type: 'text', text: val }))
                                }
                            ]
                        }
                    }

                    metaRes = await fetch(metaUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(fallbackPayload)
                    })
                    sendData = await metaRes.json()
                    logText = `Sent Template: auto_drip_followup_24h`
                }

                if (!sendData.error) {
                    // Log message in whatsapp_messages
                    await supabaseAdmin
                        .from('whatsapp_messages')
                        .insert({
                            chat_id: chat.id,
                            direction: 'outbound',
                            message_text: logText
                        })

                    // Update chat details
                    await supabaseAdmin
                        .from('whatsapp_chats')
                        .update({
                            last_message_text: logText,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', chat.id)

                    // Send "Connect with Expert" button message as a follow-up interactive message
                    if (!isTemplate && !isFallback) {
                        try {
                            await new Promise(resolve => setTimeout(resolve, 800))
                            const expertBodyText = "Would you like to speak directly with our expert on call?"
                            const expertPayload = {
                                messaging_product: 'whatsapp',
                                recipient_type: 'individual',
                                to: chat.recipient_phone,
                                type: 'interactive',
                                interactive: {
                                    type: 'button',
                                    body: {
                                        text: expertBodyText
                                    },
                                    action: {
                                        buttons: [
                                            {
                                                type: 'reply',
                                                reply: {
                                                    id: 'connect_expert',
                                                    title: 'Connect with Expert'
                                                }
                                            }
                                        ]
                                    }
                                }
                            }

                            const expertRes = await fetch(metaUrl, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(expertPayload)
                            })

                            if (expertRes.ok) {
                                await supabaseAdmin
                                    .from('whatsapp_messages')
                                    .insert({
                                        chat_id: chat.id,
                                        direction: 'outbound',
                                        message_text: `${expertBodyText} [Button: Connect with Expert]`
                                    })
                            }
                        } catch (expertErr) {
                            console.error('[WhatsApp Followup Cron] Error sending Connect with Expert button:', expertErr)
                        }
                    }

                    if (matchedLead) {
                        await supabaseAdmin
                            .from('lead_history')
                            .insert({
                                lead_id: matchedLead.id,
                                action_type: 'REMARK',
                                description: `💬 Automated WhatsApp follow-up (Stage ${followupStage}) sent: "${logText.substring(0, 100)}"`
                            })
                    }

                    sentCount++
                    diagnostics.push({ phone: chat.recipient_phone, stage: followupStage, success: true })
                } else {
                    diagnostics.push({ phone: chat.recipient_phone, stage: followupStage, success: false, error: JSON.stringify(sendData.error) })
                }
            } catch (err: any) {
                console.error(`Error generating/sending follow-up for chat ${chat.id}:`, err)
                diagnostics.push({ phone: chat.recipient_phone, error: err.message })
            }
        }

        return NextResponse.json({ success: true, processed: sentCount, diagnostics })
    } catch (error: any) {
        console.error('[WhatsApp Followup Cron] Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error', diagnostics }, { status: 500 })
    }
}
