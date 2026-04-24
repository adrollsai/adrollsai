import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'adrolls_secure_webhook_token'

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Bypassing RLS with Admin Key because Webhooks lack user cookies
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.object !== 'page') return NextResponse.json({ success: true }, { status: 200 })

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === 'leadgen') {
          const leadData = change.value
          const { leadgen_id, page_id, ad_id } = leadData

          // Find the User based on the Page ID
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, selected_page_token')
            .eq('selected_page_id', page_id)
            .single()

          if (!profile || !profile.selected_page_token) continue;

          // Fetch the actual Lead Details (Name, Email, Phone)
          const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${leadgen_id}?access_token=${profile.selected_page_token}`)
          const fbLead = await fbResponse.json()
          if (fbLead.error) continue;

          let name = 'Unknown', phone = '', email = ''
          fbLead.field_data?.forEach((field: any) => {
            if (field.name === 'full_name' || field.name === 'name') name = field.values[0]
            if (field.name === 'phone_number') phone = field.values[0]
            if (field.name === 'email') email = field.values[0]
          })

          // Fetch Ad and Campaign Name if available
          let adCampaignString = 'Direct Lead Form'
          if (ad_id) {
            try {
                const adRes = await fetch(`https://graph.facebook.com/v19.0/${ad_id}?fields=name,campaign{name}&access_token=${profile.selected_page_token}`)
                const adDetails = await adRes.json()
                if (adDetails.name) {
                    const campName = adDetails.campaign?.name || 'Unknown Campaign'
                    adCampaignString = `${campName} / ${adDetails.name}`
                }
            } catch (e) {
                console.error("Could not fetch Ad metadata", e)
            }
          }

          // Save to DB
          const { data: savedLead, error } = await supabaseAdmin.from('leads').insert({
            user_id: profile.id,
            name,
            phone,
            email,
            source: 'Facebook Ads',
            facebook_lead_id: leadgen_id,
            pipeline_stage: 'New',
            ad_name: adCampaignString
          }).select().single()

          if (error) continue;

          // RICHER NOTIFICATION
          await sendPushNotification(
              profile.id,
              "🔥 New Facebook Lead!",
              `Name: ${name}\nPhone: ${phone}\nFrom: ${adCampaignString.split(' / ')[0]}`,
              `/dashboard/crm/${savedLead.id}` // Link directly to the new lead profile page
          )
        }
      }
    }
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}