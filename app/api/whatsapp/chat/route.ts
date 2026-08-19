import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const chatId = url.searchParams.get('chatId')
        const impersonateId = url.searchParams.get('impersonate')

        // Resolve the effective user ID and the appropriate DB client
        // When impersonating, use service role client to bypass RLS
        let effectiveUserId = user.id
        let isImpersonating = false
        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            const role = authProfile?.role?.toLowerCase() || ''
            if (['super_admin', 'agency', 'admin'].includes(role)) {
                effectiveUserId = impersonateId
                isImpersonating = true
            }
        }

        // Use admin client for impersonation to bypass RLS, otherwise use session client
        const dbClient = isImpersonating
            ? createSupabaseAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
            : supabase

        if (chatId) {
            // Fetch messages for a specific chat (limit to recent 500)
            const { data: messages, error } = await dbClient
                .from('whatsapp_messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true })
                .limit(500)

            if (error) return NextResponse.json({ error: error.message }, { status: 500 })

            // Clear unread count for this chat
            await dbClient
                .from('whatsapp_chats')
                .update({ unread_count: 0 })
                .eq('id', chatId)

            return NextResponse.json({ success: true, messages })
        } else {
            // Determine the user's role and resolve the correct owner user_id
            const { data: profile } = await dbClient
                .from('profiles')
                .select('role, parent_id, agency_id')
                .eq('id', effectiveUserId)
                .single()

            const role = profile?.role?.toLowerCase() || 'admin'
            const parentId = profile?.parent_id || profile?.agency_id

            if (role === 'agent' && parentId) {
                // Agent: fetch only chats linked to leads assigned to them (by lead_id or phone match)
                const { data: assignedLeads } = await dbClient
                    .from('leads')
                    .select('id, phone')
                    .eq('assigned_to', effectiveUserId)

                const assignedLeadIds = assignedLeads?.map(l => l.id) || []
                const assignedPhones = (assignedLeads || [])
                    .map(l => (l.phone || '').replace(/\D/g, '').slice(-10))
                    .filter(Boolean)

                if (assignedLeadIds.length === 0 && assignedPhones.length === 0) {
                    return NextResponse.json({ success: true, chats: [] })
                }

                let query = dbClient.from('whatsapp_chats').select('*')
                if (assignedLeadIds.length > 0) {
                    query = query.in('lead_id', assignedLeadIds)
                }

                const { data: chats, error } = await query
                    .order('updated_at', { ascending: false })
                    .limit(500)

                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
                return NextResponse.json({ success: true, chats: chats || [] })
            } else {
                // Admin / Agency Owner / Super Admin
                let query = dbClient
                    .from('whatsapp_chats')
                    .select('*')
                    .order('updated_at', { ascending: false })
                    .limit(500)

                if (role !== 'super_admin') {
                    query = query.eq('user_id', effectiveUserId)
                }

                const { data: chats, error } = await query

                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
                return NextResponse.json({ success: true, chats: chats || [] })
            }
        }
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')

        const { chatId, messageText, templateName, language, headerMediaUrl, mediaUrl, parameters, variableValues } = await req.json()
        if (!chatId || (!messageText && !templateName)) {
            return NextResponse.json({ error: 'Missing required parameters (chatId, and either messageText or templateName)' }, { status: 400 })
        }

        // Always create admin client (needed for credits and impersonation)
        const supabaseAdmin = createSupabaseAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Resolve the owner user ID (for agents, use parent's credentials; for impersonation, use impersonated user)
        let ownerUserId = user.id
        let isImpersonating = false
        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            const authRole = authProfile?.role?.toLowerCase() || ''
            if (['super_admin', 'agency', 'admin'].includes(authRole)) {
                ownerUserId = impersonateId
                isImpersonating = true
            }
        } else {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role, parent_id, agency_id')
                .eq('id', user.id)
                .single()

            const role = profile?.role?.toLowerCase() || 'admin'
            const parentId = profile?.parent_id || profile?.agency_id
            ownerUserId = (role === 'agent' && parentId) ? parentId : user.id
        }

        // Use admin client for impersonation to bypass RLS
        const dbClient = isImpersonating ? supabaseAdmin : supabase

        // Fetch chat details
        const { data: chat, error: chatErr } = await dbClient
            .from('whatsapp_chats')
            .select('*')
            .eq('id', chatId)
            .single()

        if (chatErr || !chat) {
            return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
        }

        // Fetch WABA credentials from the owner profile
        const { data: ownerProfile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token, email, business_name, avatar_url')
            .eq('id', ownerUserId)
            .single()

        const isMasterDefaultUser = ownerProfile?.email === 'rchopra489@gmail.com' || ownerProfile?.email === 'infobluesquareinfra@gmail.com'
        const whatsappToken = ownerProfile?.whatsapp_access_token || ownerProfile?.facebook_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)
        const whatsappPhoneId = ownerProfile?.whatsapp_phone_number_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_PHONE_ID : null)
        const whatsappWabaId = ownerProfile?.whatsapp_waba_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_WABA_ID : null)

        if (!whatsappToken || !whatsappPhoneId) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 })
        }

        // Pre-flight credits check (manual outbound message = Rs. 0.10 cost * 2x markup = 0.2 credits)
        const { hasEnoughCredits, deductCreditsByCost } = await import('@/utils/credits')
        const hasCredits = await hasEnoughCredits(supabaseAdmin, ownerUserId, 0.2)
        if (!hasCredits) {
            return NextResponse.json({ error: 'Insufficient credits. Please top up your Nobo Credits to send WhatsApp messages.' }, { status: 402 })
        }

        const cleanRecipient = chat.recipient_phone.replace(/\D/g, '')

        // Construct Meta payload based on type
        const payload: any = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanRecipient
        }

        let resolvedTemplateText = ''

        if (templateName) {
            payload.type = 'template'
            payload.template = {
                name: templateName,
                language: {
                    code: language || 'en_US'
                }
            }

            // Fetch template details from Meta to resolve component parameters
            if (whatsappWabaId) {
                try {
                    const metaTemplateUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates?name=${templateName}&access_token=${whatsappToken}`
                    const tRes = await fetch(metaTemplateUrl)
                    if (tRes.ok) {
                        const tData = await tRes.json()
                        const templateDef = tData.data?.[0]
                        if (templateDef && templateDef.components) {
                            const components: any[] = []
                            const providedMedia = headerMediaUrl || mediaUrl || null

                            // Check for HEADER component (IMAGE, VIDEO, DOCUMENT)
                            const headerComp = templateDef.components.find((c: any) => c.type === 'HEADER')
                            if (headerComp && headerComp.format) {
                                const fmt = headerComp.format.toUpperCase()
                                if (fmt === 'VIDEO') {
                                    let videoUrl = providedMedia || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4'
                                    if (!providedMedia) {
                                        const { data: flow } = await supabaseAdmin
                                            .from('whatsapp_flows')
                                            .select('header_media_url')
                                            .eq('user_id', ownerUserId)
                                            .eq('template_name', templateName)
                                            .maybeSingle()
                                        if (flow?.header_media_url) videoUrl = flow.header_media_url
                                    }

                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'video',
                                                video: { link: videoUrl }
                                            }
                                        ]
                                    })
                                } else if (fmt === 'IMAGE') {
                                    let imgUrl = providedMedia || ownerProfile?.avatar_url || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg'
                                    if (imgUrl.includes('/api/fetch-image?url=')) {
                                        try { imgUrl = decodeURIComponent(imgUrl.split('/api/fetch-image?url=')[1]) } catch (e) {}
                                    }
                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'image',
                                                image: { link: imgUrl }
                                            }
                                        ]
                                    })
                                } else if (fmt === 'DOCUMENT') {
                                    const docUrl = providedMedia || 'https://adrolls.in/sample-doc.pdf'
                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'document',
                                                document: { link: docUrl, filename: 'Document.pdf' }
                                            }
                                        ]
                                    })
                                }
                            }

                            // Check for BODY component parameters
                            const bodyComp = templateDef.components.find((c: any) => c.type === 'BODY')
                            if (bodyComp && bodyComp.text) {
                                const varCount = (bodyComp.text.match(/\{\{\d+\}\}/g) || []).length
                                const bodyParams = []
                                const paramValues: string[] = []
                                const rawProvided = Array.isArray(parameters) && parameters.length > 0
                                    ? parameters
                                    : (Array.isArray(variableValues) ? variableValues : []);

                                for (let i = 0; i < varCount; i++) {
                                    const p = rawProvided[i]
                                    let textVal = typeof p === 'string' ? p : (p?.text || '')
                                    textVal = textVal.trim()
                                    if (!textVal) {
                                        if (i === 0) textVal = chat.recipient_name || 'Valued Lead'
                                        else if (i === 1) textVal = ownerProfile?.business_name || 'Partner'
                                        else textVal = 'details'
                                    }
                                    bodyParams.push({ type: 'text', text: textVal })
                                    paramValues.push(textVal)
                                }

                                if (varCount > 0) {
                                    components.push({
                                        type: 'body',
                                        parameters: bodyParams
                                    })
                                }

                                // Resolve template body text with actual parameter values
                                let resolved = bodyComp.text as string
                                paramValues.forEach((val, idx) => {
                                    resolved = resolved.replace(`{{${idx + 1}}}`, val)
                                })
                                resolvedTemplateText = resolved
                            }

                            if (components.length > 0) {
                                payload.template.components = components
                            }
                        }
                    }
                } catch (err) {
                    console.error('[CHAT API] Failed to fetch template structure from Meta:', err)
                }
            }
        } else {
            payload.type = 'text'
            payload.text = { body: messageText }
        }

        console.log(`[CHAT API] Dispatching message: recipient=${cleanRecipient}, type=${payload.type}, phoneId=${whatsappPhoneId}, sender=${user.id}, owner=${ownerUserId}`);

        // Send to Meta API
        const metaUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/messages`
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${whatsappToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })

        const metaData = await metaRes.json()
        console.log(`[CHAT API] Meta API Response Status: ${metaRes.status}, Body: ${JSON.stringify(metaData)}`);

        if (!metaRes.ok) {
            console.error('[CHAT API] Meta API failed:', metaData)
            return NextResponse.json({ 
                error: metaData.error?.message || 'Meta API failed to send message.' 
            }, { status: 400 })
        }

        // Deduct manual sending credits (Rs. 0.10 cost = 2 credits)
        await deductCreditsByCost(
            supabaseAdmin,
            ownerUserId,
            0.10,
            'whatsapp',
            `Manual WhatsApp outbound message to ${chat.recipient_name || 'Prospect'} (${cleanRecipient})`
        )

        // Save to whatsapp_messages — use resolved template text if available
        const logText = templateName 
            ? (resolvedTemplateText || `📋 Template: ${templateName}`)
            : messageText
        const { data: insertedMsg, error: insertErr } = await dbClient
            .from('whatsapp_messages')
            .insert({
                chat_id: chatId,
                direction: 'outbound',
                message_text: logText
            })
            .select('*')
            .single()

        if (insertErr) {
            return NextResponse.json({ error: insertErr.message }, { status: 500 })
        }

        // Update chat's last message
        await dbClient
            .from('whatsapp_chats')
            .update({
                last_message_text: logText,
                unread_count: 0,
                updated_at: new Date().toISOString()
            })
            .eq('id', chatId)

        return NextResponse.json({ success: true, message: insertedMsg })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
