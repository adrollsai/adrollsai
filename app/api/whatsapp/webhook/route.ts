import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendWhatsAppMessage } from '@/utils/external-apis'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new NextResponse(challenge, { status: 200 })
    }
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // 1. Log Raw Body (Crucial for debugging)
    // console.log("📨 [Webhook Raw]:", JSON.stringify(body, null, 2))

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0]
      const changes = entry?.changes?.[0]
      const value = changes?.value
      
      // Check for incoming message
      if (value?.messages?.[0]) {
        const message = value.messages[0]
        const from = message.from
        const messageText = message.text?.body || "[Media/Other]"
        const wabaId = entry.id // The Business Account ID this message was sent TO

        console.log(`[Webhook] Message from ${from} to WABA ${wabaId}: "${messageText}"`)

        // 2. Find the User who owns this WABA
        const supabase = await createClient()
        const { data: profile } = await supabase
          .from('profiles')
          .select('whatsapp_access_token, whatsapp_phone_number_id')
          .eq('whatsapp_business_account_id', wabaId)
          .single()

        if (profile?.whatsapp_access_token && profile?.whatsapp_phone_number_id) {
          
          // 3. Send Auto-Reply (Echo)
          // Note: In production, you would call your AI Agent here instead.
          console.log(`[Webhook] Found owner. Sending reply...`)
          
          await sendWhatsAppMessage(
             profile.whatsapp_access_token,
             profile.whatsapp_phone_number_id,
             from,
             `✅ Server Received: "${messageText}"`
           )
        } else {
            console.error(`[Webhook] ❌ No user found for WABA ID: ${wabaId}`)
        }
      }
      return NextResponse.json({ status: 'ok' })
    }
    return NextResponse.json({ status: 'ignored' })
  } catch (error: any) {
    console.error("Webhook Error:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}