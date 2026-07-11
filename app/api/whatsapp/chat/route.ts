import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const chatId = url.searchParams.get('chatId')

        if (chatId) {
            // Fetch messages for a specific chat
            const { data: messages, error } = await supabase
                .from('whatsapp_messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true })

            if (error) return NextResponse.json({ error: error.message }, { status: 500 })

            // Clear unread count for this chat
            await supabase
                .from('whatsapp_chats')
                .update({ unread_count: 0 })
                .eq('id', chatId)

            return NextResponse.json({ success: true, messages })
        } else {
            // Determine the user's role and resolve the correct owner user_id
            const { data: profile } = await supabase
                .from('profiles')
                .select('role, parent_id, agency_id')
                .eq('id', user.id)
                .single()

            const role = profile?.role?.toLowerCase() || 'admin'
            const parentId = profile?.parent_id || profile?.agency_id

            if (role === 'agent' && parentId) {
                // Agent: fetch only chats linked to leads assigned to them
                // RLS policy handles access control, but we also filter explicitly
                const { data: assignedLeads } = await supabase
                    .from('leads')
                    .select('id')
                    .eq('assigned_to', user.id)

                const assignedLeadIds = assignedLeads?.map(l => l.id) || []

                if (assignedLeadIds.length === 0) {
                    return NextResponse.json({ success: true, chats: [] })
                }

                const { data: chats, error } = await supabase
                    .from('whatsapp_chats')
                    .select('*')
                    .in('lead_id', assignedLeadIds)
                    .order('updated_at', { ascending: false })

                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
                return NextResponse.json({ success: true, chats })
            } else {
                // Admin/owner: fetch all their chats
                const { data: chats, error } = await supabase
                    .from('whatsapp_chats')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('updated_at', { ascending: false })

                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
                return NextResponse.json({ success: true, chats })
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

        const { chatId, messageText, templateName, language } = await req.json()
        if (!chatId || (!messageText && !templateName)) {
            return NextResponse.json({ error: 'Missing required parameters (chatId, and either messageText or templateName)' }, { status: 400 })
        }

        // Resolve the owner user ID (for agents, use parent's credentials)
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, parent_id, agency_id')
            .eq('id', user.id)
            .single()

        const role = profile?.role?.toLowerCase() || 'admin'
        const parentId = profile?.parent_id || profile?.agency_id
        const ownerUserId = (role === 'agent' && parentId) ? parentId : user.id

        // Fetch chat details — RLS will enforce access control
        const { data: chat, error: chatErr } = await supabase
            .from('whatsapp_chats')
            .select('*')
            .eq('id', chatId)
            .single()

        if (chatErr || !chat) {
            return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
        }

        // Fetch WABA credentials from the owner profile (not the agent's)
        const { data: ownerProfile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .eq('id', ownerUserId)
            .single()

        const whatsappToken = ownerProfile?.whatsapp_access_token || ownerProfile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN
        const whatsappPhoneId = ownerProfile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID

        if (!whatsappToken || !whatsappPhoneId) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 })
        }

        // Pre-flight credits check (manual outbound message = Rs. 0.10 cost = 2 credits)
        const { createClient: createSupabaseAdmin } = await import('@supabase/supabase-js')
        const supabaseAdmin = createSupabaseAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const { hasEnoughCredits, deductCreditsByCost } = await import('@/utils/credits')
        const hasCredits = await hasEnoughCredits(supabaseAdmin, ownerUserId, 2)
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

        if (templateName) {
            payload.type = 'template'
            payload.template = {
                name: templateName,
                language: {
                    code: language || 'en_US'
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

        // Save to whatsapp_messages
        const logText = templateName ? `Sent Template: ${templateName}` : messageText
        const { data: insertedMsg, error: insertErr } = await supabase
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
        await supabase
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
