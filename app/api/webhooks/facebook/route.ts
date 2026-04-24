import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendPushNotification } from '@/utils/notification-helper'

// 1. Facebook Verification (GET)
// FB hits this when you set up the Webhook in the Developer Portal
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Make sure this matches the token you enter in the Meta portal
  const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'adrolls_secure_webhook_token'

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// 2. Receiving the Lead (POST)
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = await createClient()

    if (body.object !== 'page') {
      return NextResponse.json({ success: true }, { status: 200 })
    }

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === 'leadgen') {
          const leadData = change.value
          const leadgen_id = leadData.leadgen_id
          const page_id = leadData.page_id
          const ad_id = leadData.ad_id
          const form_id = leadData.form_id

          // A. Find which user owns this page
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, selected_page_token')
            .eq('selected_page_id', page_id)
            .single()

          if (!profile || !profile.selected_page_token) {
             console.error('No page token found for page:', page_id)
             continue;
          }

          // B. Fetch the actual lead details from Graph API
          const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${leadgen_id}?access_token=${profile.selected_page_token}`)
          const fbLead = await fbResponse.json()

          if (fbLead.error) {
              console.error('FB API Error:', fbLead.error)
              continue;
          }

          // Extract fields
          let name = 'Unknown', phone = '', email = ''
          fbLead.field_data?.forEach((field: any) => {
            if (field.name === 'full_name' || field.name === 'name') name = field.values[0]
            if (field.name === 'phone_number') phone = field.values[0]
            if (field.name === 'email') email = field.values[0]
          })

          // C. Save Lead to DB
          const { data: savedLead, error } = await supabase.from('leads').insert({
            user_id: profile.id,
            name,
            phone,
            email,
            source: 'Facebook Ads',
            facebook_lead_id: leadgen_id,
            pipeline_stage: 'New'
          }).select().single()

          if (error) {
              console.error('DB Insert Error:', error)
              continue;
          }

          // D. FIRE THE PUSH NOTIFICATION
          await sendPushNotification(
              profile.id,
              "New Lead Received! 🔥",
              `${name} just submitted a form via Facebook Ads. Tap to view.`,
              `/dashboard/crm`
          )
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Webhook Error:', error)
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}