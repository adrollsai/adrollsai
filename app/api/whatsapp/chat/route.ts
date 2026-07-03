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

        const { chatId, messageText } = await req.json()
        if (!chatId || !messageText) {
            return NextResponse.json({ error: 'Missing required parameters (chatId, messageText)' }, { status: 400 })
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

        if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 })
        }

        const cleanRecipient = chat.recipient_phone.replace(/\D/g, '')

        // Send to Meta API
        const metaUrl = `https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}/messages`
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanRecipient,
                type: 'text',
                text: { body: messageText }
            })
        })

        const metaData = await metaRes.json()

        if (!metaRes.ok) {
            console.error('[CHAT API] Meta API failed:', metaData)
            return NextResponse.json({ 
                error: metaData.error?.message || 'Meta API failed to send message.' 
            }, { status: 400 })
        }

        // Save to whatsapp_messages
        const { data: insertedMsg, error: insertErr } = await supabase
            .from('whatsapp_messages')
            .insert({
                chat_id: chatId,
                direction: 'outbound',
                message_text: messageText
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
                last_message_text: messageText,
                unread_count: 0,
                updated_at: new Date().toISOString()
            })
            .eq('id', chatId)

        return NextResponse.json({ success: true, message: insertedMsg })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
