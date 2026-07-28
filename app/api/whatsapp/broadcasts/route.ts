import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { searchParams } = new URL(req.url)
        const impersonateId = searchParams.get('impersonate')
        const broadcastId = searchParams.get('broadcastId')
        const targetUserId = impersonateId || user.id

        // If specific broadcastId stats requested
        if (broadcastId) {
            const { data: broadcast } = await supabase
                .from('whatsapp_broadcasts')
                .select('*')
                .eq('id', broadcastId)
                .single()

            if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

            const { data: recipients } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('*')
                .eq('broadcast_id', broadcastId)

            const total = recipients?.length || 0
            const sent = recipients?.filter(r => r.status === 'sent').length || 0
            const failed = recipients?.filter(r => r.status === 'failed').length || 0
            const pending = recipients?.filter(r => r.status === 'pending').length || 0

            const recipientPhones = (recipients || []).map(r => r.phone_number.replace(/\D/g, '')).filter(Boolean)
            
            // Batch fetch whatsapp_chats in chunks of 100
            let chats: any[] = []
            for (let i = 0; i < recipientPhones.length; i += 100) {
                const batch = recipientPhones.slice(i, i + 100)
                const { data: bChats } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id, recipient_phone, recipient_name, updated_at, last_message_text')
                    .eq('user_id', targetUserId)
                    .in('recipient_phone', batch)
                if (bChats) chats = chats.concat(bChats)
            }

            const chatMap = new Map((chats || []).map(c => [c.recipient_phone, c]))

            // Batch fetch leads in chunks of 100
            const leadIds = (recipients || []).map(r => r.lead_id).filter(Boolean)
            let leadsMap = new Map()
            for (let i = 0; i < leadIds.length; i += 100) {
                const batch = leadIds.slice(i, i + 100)
                const { data: bLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, phone')
                    .in('id', batch)
                if (bLeads) {
                    for (const l of bLeads) {
                        leadsMap.set(l.id, l)
                    }
                }
            }

            let replyCount = 0
            let buttonClickCount = 0

            const recipientDetails = (recipients || []).map(r => {
                const cleanPhone = r.phone_number.replace(/\D/g, '')
                const lead = leadsMap.get(r.lead_id)
                const chat = chatMap.get(cleanPhone) || chatMap.get('91' + cleanPhone)

                const name = lead?.name || chat?.recipient_name || 'Valued Lead'
                const hasReplied = !!chat && (chat.last_message_text !== `Sent Template: ${broadcast.template_name}`)
                if (hasReplied) replyCount++

                const isButtonClick = hasReplied && (chat?.last_message_text === 'View Properties' || chat?.last_message_text?.includes('Button'))
                if (isButtonClick) buttonClickCount++

                return {
                    id: r.id,
                    phone: r.phone_number,
                    name,
                    status: r.status,
                    sent_at: r.sent_at,
                    error_message: r.error_message,
                    has_replied: hasReplied,
                    last_message: chat?.last_message_text || null
                }
            })

            const deliveryRate = total > 0 ? ((sent / total) * 100).toFixed(1) : '0'
            const responseRate = sent > 0 ? ((replyCount / sent) * 100).toFixed(1) : '0'

            return NextResponse.json({
                success: true,
                broadcast,
                stats: {
                    total,
                    sent,
                    failed,
                    pending,
                    replyCount,
                    buttonClickCount,
                    deliveryRate,
                    responseRate
                },
                recipients: recipientDetails
            })
        }

        // Fetch broadcasts
        const { data: broadcasts, error: bErr } = await supabase
            .from('whatsapp_broadcasts')
            .select('*')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false })

        if (bErr) {
            console.error('[BROADCAST API] Error fetching broadcasts:', bErr)
            return NextResponse.json({ error: bErr.message }, { status: 500 })
        }

        // Fetch status stats for each broadcast
        const resolvedBroadcasts = await Promise.all((broadcasts || []).map(async (b) => {
            const { data: recipients } = await supabase
                .from('whatsapp_broadcast_recipients')
                .select('status')
                .eq('broadcast_id', b.id)

            const total = recipients?.length || 0
            const sent = recipients?.filter(r => r.status === 'sent').length || 0
            const failed = recipients?.filter(r => r.status === 'failed').length || 0

            return {
                ...b,
                stats: { total, sent, failed }
            }
        }))

        return NextResponse.json({ success: true, broadcasts: resolvedBroadcasts })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const { title, templateName, recipientStage, recipientPropertyId, recipientCsvAudience, scheduledAt, impersonateId, variableMappings, audienceFilter } = body
        const targetUserId = impersonateId || user.id

        if (!title || !templateName) {
            return NextResponse.json({ error: 'Missing required broadcast parameters (title, templateName)' }, { status: 400 })
        }

        // Fetch credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, business_name')
            .eq('id', targetUserId)
            .single()

        if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
            return NextResponse.json({ 
                error: 'WhatsApp credentials not connected for the target profile.' 
            }, { status: 400 })
        }

        // Create the broadcast record with fallback
        let broadcast: any = null
        const { data: bData, error: cErr } = await supabase
            .from('whatsapp_broadcasts')
            .insert({
                user_id: targetUserId,
                title,
                template_name: templateName,
                recipient_stage: recipientStage || 'All',
                recipient_property_id: recipientPropertyId || null,
                recipient_csv_audience: recipientCsvAudience || null,
                scheduled_at: scheduledAt || null,
                status: scheduledAt ? 'pending' : 'processing',
                created_at: new Date().toISOString()
            })
            .select()
            .single()

        if (cErr) {
            const { data: bDataFallback, error: cErrFallback } = await supabase
                .from('whatsapp_broadcasts')
                .insert({
                    user_id: targetUserId,
                    title,
                    template_name: templateName,
                    recipient_stage: recipientStage || 'All',
                    recipient_property_id: recipientPropertyId || null,
                    scheduled_at: scheduledAt || null,
                    status: scheduledAt ? 'pending' : 'processing',
                    created_at: new Date().toISOString()
                })
                .select()
                .single()

            if (cErrFallback) {
                console.error('[BROADCAST API] Error creating broadcast:', cErrFallback)
                return NextResponse.json({ error: cErrFallback.message }, { status: 500 })
            }
            broadcast = bDataFallback
        } else {
            broadcast = bData
        }

        // Filter and find matching leads in DB
        let leadQuery = supabaseAdmin
            .from('leads')
            .select('*')
            .eq('user_id', targetUserId)

        if (audienceFilter && audienceFilter.targetType === 'custom') {
            const { csvAudiences, sources, metaCampaigns, pipelineStages, propertyIds } = audienceFilter

            if (csvAudiences && Array.isArray(csvAudiences) && csvAudiences.length > 0) {
                leadQuery = leadQuery.in('csv_audience', csvAudiences)
            }

            if (sources && Array.isArray(sources) && sources.length > 0) {
                leadQuery = leadQuery.in('source', sources)
            }

            if (metaCampaigns && Array.isArray(metaCampaigns) && metaCampaigns.length > 0) {
                leadQuery = leadQuery.in('ad_name', metaCampaigns)
            }

            if (pipelineStages && Array.isArray(pipelineStages) && pipelineStages.length > 0) {
                leadQuery = leadQuery.in('pipeline_stage', pipelineStages)
            }

            if (propertyIds && Array.isArray(propertyIds) && propertyIds.length > 0) {
                leadQuery = leadQuery.in('property_id', propertyIds)
            }
        } else {
            if (recipientStage && recipientStage !== 'All') {
                leadQuery = leadQuery.eq('pipeline_stage', recipientStage)
            }

            if (recipientPropertyId) {
                leadQuery = leadQuery.eq('property_id', recipientPropertyId)
            }

            if (recipientCsvAudience) {
                leadQuery = leadQuery.eq('csv_audience', recipientCsvAudience)
            }
        }

        const { data: leads } = await leadQuery



        if (!leads || leads.length === 0) {
            // No matching leads, mark sent/empty
            await supabase
                .from('whatsapp_broadcasts')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', broadcast.id)

            return NextResponse.json({ 
                success: true, 
                broadcast, 
                recipientsCount: 0,
                message: 'Broadcast created but no matching leads found.'
            })
        }

        // Insert pending recipient records
        const recipientPayloads = leads.map(l => ({
            broadcast_id: broadcast.id,
            lead_id: l.id,
            user_id: targetUserId,
            phone_number: l.phone || l.custom_fields?.whatsapp_number || l.custom_fields?.phone_number || '',
            status: 'pending'
        })).filter(r => !!r.phone_number)

        if (recipientPayloads.length === 0) {
            await supabase
                .from('whatsapp_broadcasts')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', broadcast.id)

            return NextResponse.json({ 
                success: true, 
                broadcast, 
                recipientsCount: 0,
                message: 'Broadcast created but leads lacked valid phone numbers.'
            })
        }

        const { error: insErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .insert(recipientPayloads)

        if (insErr) {
            console.error('[BROADCAST API] Error creating recipients:', insErr)
            return NextResponse.json({ error: insErr.message }, { status: 500 })
        }

        // If scheduled in the future, we stop here and let the scheduler handle it later
        if (scheduledAt) {
            return NextResponse.json({ 
                success: true, 
                broadcast, 
                recipientsCount: recipientPayloads.length,
                message: 'Broadcast scheduled successfully for ' + scheduledAt
            })
        }

        // Otherwise execute immediately in background (don't block the HTTP response)
        executeBroadcastImmediately(broadcast.id, targetUserId, profile, templateName, leads, recipientPayloads, variableMappings).catch(console.error)

        return NextResponse.json({ 
            success: true, 
            broadcast, 
            recipientsCount: recipientPayloads.length,
            message: 'Broadcast started successfully and is executing in the background.'
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

// Background async delivery execution function
async function executeBroadcastImmediately(
    broadcastId: string, 
    userId: string, 
    profile: any, 
    templateName: string, 
    leads: any[], 
    recipients: any[],
    variableMappings?: Record<string, string>
) {
    console.log(`[BROADCAST EXECUTION] Starting Broadcast ID ${broadcastId} for ${recipients.length} recipients...`)
    
    // Fetch user properties context for template variables
    const { data: properties } = await supabaseAdmin
        .from('properties')
        .select('id, title')
        .eq('user_id', userId)

    const accessToken = profile.whatsapp_access_token
    const phoneId = profile.whatsapp_phone_number_id
    const businessName = profile.business_name || 'Adrolls Partner'
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`

    // Fetch template details to get exact language and parameter count
    let templateLanguageCode = 'en_US'
    let templateVarCount = 0

    try {
        const wabaId = profile.whatsapp_waba_id
        if (wabaId && accessToken) {
            const tplRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${templateName}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            })
            if (tplRes.ok) {
                const tplData = await tplRes.json()
                const foundTpl = (tplData.data || []).find((t: any) => t.name === templateName)
                if (foundTpl) {
                    if (foundTpl.language) templateLanguageCode = foundTpl.language
                    const bodyComp = (foundTpl.components || []).find((c: any) => c.type === 'BODY')
                    if (bodyComp && bodyComp.text) {
                        const matches = bodyComp.text.match(/\{\{(\d+)\}\}/g) || []
                        const parsed = matches.map((m: string) => parseInt(m.replace(/\D/g, '')))
                        templateVarCount = new Set(parsed).size
                    }
                }
            }
        }
    } catch (tplErr) {
        console.error('[BROADCAST EXECUTION] Error fetching template info from Meta:', tplErr)
    }

    for (const r of recipients) {
        const lead = leads.find(l => l.id === r.lead_id)
        if (!lead) continue

        let cleanPhone = r.phone_number.replace(/\D/g, '')
        if (!cleanPhone) continue
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone; // Auto-format 10-digit Indian numbers with country code
        }

        // Resolve property title
        const property = (properties || []).find(p => p.id === lead.property_id)
        const propertyTitle = property ? property.title : 'Premium Listings'

        // Map template variables dynamically based on user UI selection or exact template variable count
        let parameters: any[] = []
        
        if (templateVarCount > 0) {
            for (let i = 1; i <= templateVarCount; i++) {
                const k = i.toString()
                const mappedField = variableMappings?.[k] || (i === 1 ? 'name' : i === 2 ? 'property_title' : 'business_name')
                
                let val = ''
                if (mappedField === 'name') val = lead.name || 'Valued Customer'
                else if (mappedField === 'phone') val = lead.phone || ''
                else if (mappedField === 'email') val = lead.email || ''
                else if (mappedField === 'property_title') val = propertyTitle
                else if (mappedField === 'business_name') val = businessName
                else if (mappedField === 'csv_audience') val = lead.csv_audience || ''
                else if (mappedField === 'pipeline_stage') val = lead.pipeline_stage || ''
                else val = mappedField || 'Valued Customer'
                
                parameters.push({ type: 'text', text: val })
            }
        } else if (variableMappings && Object.keys(variableMappings).length > 0) {
            const varKeys = Object.keys(variableMappings).sort((a, b) => parseInt(a) - parseInt(b))
            parameters = varKeys.map(k => {
                const mappedField = variableMappings[k]
                let val = ''
                if (mappedField === 'name') val = lead.name || 'Valued Customer'
                else if (mappedField === 'phone') val = lead.phone || ''
                else if (mappedField === 'email') val = lead.email || ''
                else if (mappedField === 'property_title') val = propertyTitle
                else if (mappedField === 'business_name') val = businessName
                else if (mappedField === 'csv_audience') val = lead.csv_audience || ''
                else if (mappedField === 'pipeline_stage') val = lead.pipeline_stage || ''
                else val = mappedField || 'Valued Customer'
                
                return { type: 'text', text: val }
            })
        }

        const templatePayload: any = {
            name: templateName,
            language: { code: templateLanguageCode }
        }

        if (parameters.length > 0) {
            templatePayload.components = [
                {
                    type: 'body',
                    parameters
                }
            ]
        }

        const messagePayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'template',
            template: templatePayload
        }


        try {
            const metaRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messagePayload)
            })

            const metaData = await metaRes.json()

            if (metaData.error) {
                console.error(`[BROADCAST EXECUTION] Meta API send failed for phone ${cleanPhone}:`, metaData.error)
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ 
                        status: 'failed', 
                        error_message: metaData.error.message || 'Meta API returned error' 
                    })
                    .eq('broadcast_id', broadcastId)
                    .eq('lead_id', r.lead_id)
            } else {
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ 
                        status: 'sent', 
                        sent_at: new Date().toISOString() 
                    })
                    .eq('broadcast_id', broadcastId)
                    .eq('lead_id', r.lead_id)

                // Log outbound chat & message in WhatsApp CRM tab
                try {
                    const recipientName = lead.name || 'Prospect'
                    const summaryText = `Sent Template: ${templateName}`

                    let { data: chat } = await supabaseAdmin
                        .from('whatsapp_chats')
                        .select('id')
                        .eq('user_id', userId)
                        .eq('recipient_phone', cleanPhone)
                        .maybeSingle()

                    if (!chat) {
                        const { data: newChat } = await supabaseAdmin
                            .from('whatsapp_chats')
                            .insert({
                                user_id: userId,
                                recipient_phone: cleanPhone,
                                recipient_name: recipientName,
                                lead_id: lead.id,
                                last_message_text: summaryText,
                                unread_count: 0,
                                flow_answers: {},
                                flow_completed: false,
                                updated_at: new Date().toISOString()
                            })
                            .select('id')
                            .maybeSingle()

                        chat = newChat
                    } else {
                        await supabaseAdmin
                            .from('whatsapp_chats')
                            .update({
                                last_message_text: summaryText,
                                lead_id: lead.id,
                                recipient_name: recipientName,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', chat.id)
                    }

                    if (chat) {
                        await supabaseAdmin
                            .from('whatsapp_messages')
                            .insert({
                                chat_id: chat.id,
                                direction: 'outbound',
                                message_text: summaryText,
                                created_at: new Date().toISOString()
                            })
                    }
                } catch (chatErr) {
                    console.error('[BROADCAST EXECUTION] Error syncing chat message:', chatErr)
                }
            }
        } catch (sendErr: any) {
            console.error(`[BROADCAST EXECUTION] Exception sending to phone ${cleanPhone}:`, sendErr)
            await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .update({ 
                    status: 'failed', 
                    error_message: sendErr.message || 'HTTP fetch exception' 
                })
                .eq('broadcast_id', broadcastId)
                .eq('lead_id', r.lead_id)
        }
    }

    // Mark broadcast complete
    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ 
            status: 'sent', 
            sent_at: new Date().toISOString() 
        })
        .eq('id', broadcastId)
        
    console.log(`[BROADCAST EXECUTION] Broadcast ID ${broadcastId} finished executing.`)
}
