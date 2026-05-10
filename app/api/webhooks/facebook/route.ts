import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  console.log(`🔗 WEBHOOK VERIFY ATTEMPT: mode=${mode}, token=${token}`)

  const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'adrolls_secure_webhook_token'

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED")
    return new Response(challenge, { status: 200 })
  }
  console.error("❌ WEBHOOK VERIFICATION FAILED: Token Mismatch")
  return new Response('Forbidden', { status: 403 })
}

// Bypassing RLS with Admin Key because Webhooks lack user cookies
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log("📥 WEBHOOK RECEIVED:", JSON.stringify(body, null, 2))

    if (body.object !== 'page') return NextResponse.json({ success: true }, { status: 200 })

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === 'leadgen') {
          const leadData = change.value
          const { leadgen_id, page_id, ad_id } = leadData
          console.log(`🔍 Processing Lead: ${leadgen_id} for Page: ${page_id}`)

          // Find the User based on the Page ID using Admin Client
          const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, selected_page_token, facebook_pixel_id')
            .eq('selected_page_id', page_id)
            .single()

          if (profileErr || !profile) {
            console.error(`❌ No profile found for Page ID: ${page_id}. Error:`, profileErr)
            continue;
          }

          if (!profile.selected_page_token) {
            console.error(`❌ Profile found but NO Page Token for Page ID: ${page_id}`)
            continue;
          }

          // Fetch the actual Lead Details (Name, Email, Phone, Created Time, Form ID)
          const fbUrl = `https://graph.facebook.com/v19.0/${leadgen_id}?fields=id,created_time,field_data,form_id&access_token=${profile.selected_page_token}`
          const fbResponse = await fetch(fbUrl)
          const fbLead = await fbResponse.json()
          
          if (fbLead.error) {
            console.error(`❌ Meta Lead Fetch Failed:`, fbLead.error)
            continue;
          }

          let name = 'Unknown', phone = '', email = ''
          const customFields: Record<string, any> = {}
          let firstName = '', lastName = ''
          fbLead.field_data?.forEach((field: any) => {
            if (!field.name || !field.values || field.values.length === 0) return;
            
            const fieldName = field.name.toLowerCase()
            const fieldValue = field.values[0]

            if (fieldName === 'full_name' || fieldName === 'name') name = fieldValue
            else if (fieldName === 'first_name') firstName = fieldValue
            else if (fieldName === 'last_name') lastName = fieldValue
            else if (fieldName === 'email') email = fieldValue
            else if (fieldName === 'phone_number' || fieldName === 'phone' || fieldName === 'mobile_number') phone = fieldValue
            else {
              customFields[field.name] = fieldValue
            }
          })

          if (name === 'Unknown' && (firstName || lastName)) {
            name = `${firstName} ${lastName}`.trim()
          }

          // Fetch Form Name
          let formName = 'Facebook Lead Form'
          if (fbLead.form_id) {
            try {
              const formRes = await fetch(`https://graph.facebook.com/v19.0/${fbLead.form_id}?fields=name&access_token=${profile.selected_page_token}`)
              const formData = await formRes.json()
              if (formData.name) formName = formData.name
            } catch (e) {
              console.error("Could not fetch Form metadata", e)
            }
          }

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

          // Save to DB using Admin Client
          const { data: savedLead, error } = await supabaseAdmin.from('leads').insert({
            user_id: profile.id,
            name,
            phone,
            email,
            source: 'Facebook Ads',
            facebook_lead_id: leadgen_id,
            facebook_created_at: fbLead.created_time,
            form_id: fbLead.form_id,
            form_name: formName,
            custom_fields: customFields,
            pipeline_stage: 'New',
            ad_name: adCampaignString
          }).select().single()

          if (error) continue;

          // FIRE THE RICHER NOTIFICATION
          const cleanSource = adCampaignString.split(' / ')[0];
          
          await sendPushNotification(
              profile.id,
              "🔥 New Facebook Lead!",
              `${name} • ${phone} • ${cleanSource}`,
              `/dashboard/crm/${savedLead.id}` 
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