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
            // Fetch all chats
            const { data: chats, error } = await supabase
                .from('whatsapp_chats')
                .select('*')
                .eq('user_id', user.id)
                .order('updated_at', { ascending: false })

            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ success: true, chats })
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

        // Fetch chat details
        const { data: chat, error: chatErr } = await supabase
            .from('whatsapp_chats')
            .select('*')
            .eq('id', chatId)
            .eq('user_id', user.id)
            .single()

        if (chatErr || !chat) {
            return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
        }

        // Fetch user WABA credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id')
            .eq('id', user.id)
            .single()

        const whatsappToken = profile?.whatsapp_access_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN
        const whatsappPhoneId = profile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID

        if (!whatsappToken || !whatsappPhoneId) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 })
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

        console.log(`[CHAT API] Dispatching message: recipient=${cleanRecipient}, type=${payload.type}, phoneId=${whatsappPhoneId}`);
        console.log(`[CHAT API] Token Source - DB: ${!!profile?.whatsapp_access_token}, Env: ${!!process.env.DEV_WHATSAPP_ACCESS_TOKEN}`);
        if (whatsappToken) {
            console.log(`[CHAT API] Token Snippet: ${whatsappToken.substring(0, 15)}...${whatsappToken.substring(whatsappToken.length - 15)}`);
        }

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
