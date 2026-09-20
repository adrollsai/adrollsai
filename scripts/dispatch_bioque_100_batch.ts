import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0'
const TEMPLATE_NAME = 'sakhsi'
const HEADER_IMAGE_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/68b55a31-a16d-454d-a20f-11adabf590b0/1789877891600-5percent.jpg'
const AUDIENCE_TAG = 'indian-leads-clean - Leads'
const FLOW_ID = 'b019e075-88d3-4929-a1b7-a3f89012f99a'
const BATCH_LIMIT = 100

async function dispatchBatch() {
  console.log(`Starting 100-lead dispatch for Bioque Estates International...`)

  // 1. Fetch Bioque WhatsApp credentials
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_business_account_id, whatsapp_waba_id')
    .eq('id', BIOQUE_USER_ID)
    .single()

  if (profErr || !profile) {
    console.error('Failed to load Bioque profile:', profErr)
    return
  }

  const phoneId = profile.whatsapp_phone_number_id
  const accessToken = profile.whatsapp_access_token
  if (!phoneId || !accessToken) {
    console.error('Bioque profile missing WhatsApp credentials!')
    return
  }

  console.log(`Using Bioque phone ID: ${phoneId}`)

  // 2. Fetch first 100 leads from 'indian-leads-clean - Leads'
  const { data: leads, error: leadErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, property_id, csv_audience, pipeline_stage')
    .eq('user_id', BIOQUE_USER_ID)
    .eq('csv_audience', AUDIENCE_TAG)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (leadErr || !leads || leads.length === 0) {
    console.error('Could not find leads with audience tag:', AUDIENCE_TAG, leadErr)
    return
  }

  console.log(`Fetched ${leads.length} leads for dispatch batch.`)

  // Filter valid phone numbers
  const validLeads = leads.filter(l => {
    const p = (l.phone || '').replace(/\D/g, '')
    return p.length >= 10
  })

  console.log(`Valid phone leads: ${validLeads.length}`)

  // 3. Create broadcast record in DB
  const broadcastTitle = `Sakshi 5% Down Payment - Indian Leads (Batch 1: ${validLeads.length} Leads)`
  const { data: broadcast, error: bcastErr } = await supabase
    .from('whatsapp_broadcasts')
    .insert({
      user_id: BIOQUE_USER_ID,
      title: broadcastTitle,
      template_name: TEMPLATE_NAME,
      recipient_stage: AUDIENCE_TAG,
      status: 'processing',
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  if (bcastErr || !broadcast) {
    console.error('Error creating broadcast record:', bcastErr)
    return
  }

  console.log(`Created broadcast ID: ${broadcast.id}`)

  // Link broadcast to automation flow
  try {
    const { data: flowData } = await supabase.from('automations').select('description').eq('id', FLOW_ID).single()
    if (flowData) {
      const desc = typeof flowData.description === 'string' ? JSON.parse(flowData.description || '{}') : flowData.description
      desc.lastBroadcastId = broadcast.id
      desc.lastBroadcastAt = new Date().toISOString()
      desc.lastBroadcastAudience = AUDIENCE_TAG
      desc.lastBroadcastRecipients = validLeads.length
      await supabase.from('automations').update({ description: JSON.stringify(desc) }).eq('id', FLOW_ID)
      console.log(`🔗 Flow ${FLOW_ID} linked with broadcast ${broadcast.id}`)
    }
  } catch (flowErr) {
    console.warn('Could not link broadcast to flow:', flowErr)
  }

  // 4. Insert recipient records
  const recipientRows = validLeads.map(l => ({
    broadcast_id: broadcast.id,
    lead_id: l.id,
    user_id: BIOQUE_USER_ID,
    phone_number: l.phone,
    status: 'pending',
    created_at: new Date().toISOString()
  }))

  const { error: recErr } = await supabase
    .from('whatsapp_broadcast_recipients')
    .insert(recipientRows)

  if (recErr) {
    console.error('Error creating broadcast recipients:', recErr)
    return
  }

  console.log(`Inserted ${recipientRows.length} recipient rows. Commencing Meta API dispatch...`)

  // 5. Send Meta API Template Messages
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
  let sentCount = 0
  let failCount = 0

  for (let i = 0; i < validLeads.length; i++) {
    const lead = validLeads[i]
    let cleanPhone = lead.phone.replace(/\D/g, '')
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: 'en_US' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: { link: HEADER_IMAGE_URL }
              }
            ]
          }
        ]
      }
    }

    try {
      const res = await fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const resData = await res.json()
      if (res.ok && resData.messages?.[0]?.id) {
        sentCount++
        await supabase
          .from('whatsapp_broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('broadcast_id', broadcast.id)
          .eq('lead_id', lead.id)

        // Ensure chat conversation exists in whatsapp_chats so replies appear in live inbox
        const { data: existingChat } = await supabase
          .from('whatsapp_chats')
          .select('id')
          .eq('user_id', BIOQUE_USER_ID)
          .eq('recipient_phone', cleanPhone)
          .maybeSingle()

        if (!existingChat) {
          await supabase.from('whatsapp_chats').insert({
            user_id: BIOQUE_USER_ID,
            recipient_phone: cleanPhone,
            recipient_name: lead.name || 'Investor',
            lead_id: lead.id,
            last_message_text: `Sent Template: ${TEMPLATE_NAME}`,
            unread_count: 0,
            updated_at: new Date().toISOString()
          })
        }
      } else {
        failCount++
        const errMsg = resData?.error?.message || 'Meta API error'
        console.warn(`Failed lead ${cleanPhone}:`, errMsg)
        await supabase
          .from('whatsapp_broadcast_recipients')
          .update({
            status: 'failed',
            error_message: errMsg
          })
          .eq('broadcast_id', broadcast.id)
          .eq('lead_id', lead.id)
      }
    } catch (sendErr: any) {
      failCount++
      console.error(`Fetch exception for ${cleanPhone}:`, sendErr.message)
      await supabase
        .from('whatsapp_broadcast_recipients')
        .update({
          status: 'failed',
          error_message: sendErr.message
        })
        .eq('broadcast_id', broadcast.id)
        .eq('lead_id', lead.id)
    }

    // Rate pacing: 50ms interval between messages
    await new Promise(r => setTimeout(r, 50))
    if ((i + 1) % 20 === 0) {
      console.log(`Progress: ${i + 1}/${validLeads.length} processed (Sent: ${sentCount}, Failed: ${failCount})`)
    }
  }

  // 6. Update broadcast status: Batch 1 sent and paused as requested
  await supabase
    .from('whatsapp_broadcasts')
    .update({
      status: 'paused', // Paused as requested to analyze performance
      sent_at: new Date().toISOString()
    })
    .eq('id', broadcast.id)

  console.log(`\n🎉 Broadcast Batch Completed!`)
  console.log(`Campaign: ${broadcastTitle}`)
  console.log(`Total Leads Processed: ${validLeads.length}`)
  console.log(`Successfully Dispatched: ${sentCount}`)
  console.log(`Failed: ${failCount}`)
  console.log(`Status set to: 'paused' (ready for analysis)`)
  console.log(`Flow ID: ${FLOW_ID}`)
  console.log(`Notification Email: sakshi.rathi61@gmail.com`)
}

dispatchBatch()
