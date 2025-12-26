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
    
    // LOG RAW BODY to confirm receipt
    console.log("📨 [Webhook Hit] Raw Body:", JSON.stringify(body, null, 2))

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0]
      const changes = entry?.changes?.[0]
      const value = changes?.value
      
      if (value?.messages?.[0]) {
        const message = value.messages[0]
        const from = message.from
        const messageText = message.text?.body || "[Media Message]"
        const wabaId = entry.id

        console.log(`[Webhook] Message from ${from}: ${messageText}`)

        // --- 🚀 DEV BYPASS: Use Env Vars if Database Fails ---
        let accessToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        let phoneNumberId = process.env.DEV_WHATSAPP_PHONE_ID;

        // Only try DB if Dev vars are missing
        if (!accessToken || !phoneNumberId) {
            const supabase = await createClient()
            const { data: profile } = await supabase
              .from('profiles')
              .select('whatsapp_access_token, whatsapp_phone_number_id')
              .eq('whatsapp_business_account_id', wabaId)
              .single()
            
            accessToken = profile?.whatsapp_access_token;
            phoneNumberId = profile?.whatsapp_phone_number_id;
        }

        if (accessToken && phoneNumberId) {
          // Send Reply
          console.log("Found credentials, sending auto-reply...")
          await sendWhatsAppMessage(
             accessToken,
             phoneNumberId,
             from,
             `✅ Server Received: "${messageText}"`
           )
        } else {
            console.error("❌ No credentials found (DB or ENV) to reply.")
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