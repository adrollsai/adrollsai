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
    } else {
      return new NextResponse('Verification failed', { status: 403 })
    }
  }
  return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0]
      const changes = entry?.changes?.[0]
      const value = changes?.value
      
      // Check for incoming message
      if (value?.messages?.[0]) {
        const message = value.messages[0]
        const wabaId = entry.id
        const from = message.from
        const messageText = message.text?.body

        console.log(`[Webhook] Received from ${from}: ${messageText}`)

        // 1. Fetch Credentials
        const supabase = await createClient()
        const { data: profile } = await supabase
          .from('profiles')
          .select('whatsapp_access_token, whatsapp_phone_number_id')
          .eq('whatsapp_business_account_id', wabaId)
          .single()

        if (profile?.whatsapp_access_token && profile?.whatsapp_phone_number_id) {
          // 2. Mirror Reply (Proof of Receipt)
          if (messageText) {
             await sendWhatsAppMessage(
               profile.whatsapp_access_token,
               profile.whatsapp_phone_number_id,
               from,
               `✅ Received: "${messageText}"`
             )
             console.log("[Webhook] Auto-reply sent.")
          }
        }
      }
      return NextResponse.json({ status: 'ok' })
    }
    return NextResponse.json({ error: 'Not a WhatsApp event' }, { status: 404 })
  } catch (error: any) {
    console.error("Webhook Error:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}