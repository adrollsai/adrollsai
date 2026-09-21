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

async function dispatchRemaining() {
  console.log(`=======================================================`)
  console.log(`🚀 Commencing Full Dispatch to Remaining CSV Leads`)
  console.log(`Account: Bioque Estates International (${BIOQUE_USER_ID})`)
  console.log(`Audience: "${AUDIENCE_TAG}"`)
  console.log(`Template: "${TEMPLATE_NAME}"`)
  console.log(`=======================================================\n`)

  // 1. Fetch WhatsApp credentials
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token')
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

  // 2. Identify already sent leads from previous broadcast
  const { data: previousRecipients } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('lead_id, phone_number')
    .eq('user_id', BIOQUE_USER_ID)

  const sentLeadIds = new Set((previousRecipients || []).map(r => r.lead_id).filter(Boolean))
  const sentPhones = new Set(
    (previousRecipients || []).map(r => (r.phone_number || '').replace(/\D/g, '').slice(-10)).filter(Boolean)
  )
  console.log(`Found ${sentLeadIds.size} leads already sent in previous batches. Excluding them to prevent duplicates.`)

  // 3. Fetch all leads for this audience
  const { data: allLeads, error: leadErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, property_id, csv_audience, pipeline_stage')
    .eq('user_id', BIOQUE_USER_ID)
    .eq('csv_audience', AUDIENCE_TAG)
    .order('created_at', { ascending: true })

  if (leadErr || !allLeads) {
    console.error('Error fetching leads:', leadErr)
    return
  }

  console.log(`Total leads in "${AUDIENCE_TAG}": ${allLeads.length}`)

  // Filter out already sent leads and invalid phone numbers
  const remainingLeads = allLeads.filter(l => {
    if (sentLeadIds.has(l.id)) return false
    const cleanDigits = (l.phone || '').replace(/\D/g, '').slice(-10)
    if (cleanDigits.length < 10) return false
    if (sentPhones.has(cleanDigits)) return false
    return true
  })

  console.log(`Remaining unsent leads ready for dispatch: ${remainingLeads.length}\n`)

  if (remainingLeads.length === 0) {
    console.log('No remaining leads to dispatch. All leads in this audience have already received the broadcast!')
    return
  }

  // 4. Create new broadcast record in DB
  const broadcastTitle = `Sakshi 5% Down Payment - Remaining Indian Leads (${remainingLeads.length} Leads)`
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

  console.log(`Created Broadcast ID: ${broadcast.id}`)

  // Link broadcast to automation flow
  try {
    const { data: flowData } = await supabase.from('automations').select('description').eq('id', FLOW_ID).single()
    if (flowData) {
      const desc = typeof flowData.description === 'string' ? JSON.parse(flowData.description || '{}') : flowData.description
      desc.lastBroadcastId = broadcast.id
      desc.lastBroadcastAt = new Date().toISOString()
      desc.lastBroadcastAudience = AUDIENCE_TAG
      desc.lastBroadcastRecipients = remainingLeads.length
      await supabase.from('automations').update({ description: JSON.stringify(desc) }).eq('id', FLOW_ID)
      console.log(`🔗 Flow ${FLOW_ID} linked with broadcast ${broadcast.id}`)
    }
  } catch (flowErr) {
    console.warn('Could not link broadcast to flow:', flowErr)
  }

  // 5. Insert recipient rows in chunks of 200
  console.log(`Inserting ${remainingLeads.length} recipient rows into database...`)
  const recipientRows = remainingLeads.map(l => ({
    broadcast_id: broadcast.id,
    lead_id: l.id,
    user_id: BIOQUE_USER_ID,
    phone_number: l.phone,
    status: 'pending',
    created_at: new Date().toISOString()
  }))

  for (let i = 0; i < recipientRows.length; i += 200) {
    const chunk = recipientRows.slice(i, i + 200)
    const { error: insErr } = await supabase.from('whatsapp_broadcast_recipients').insert(chunk)
    if (insErr) {
      console.error('Error inserting recipient chunk:', insErr)
    }
  }
  console.log(`Recipient records inserted successfully.\n`)

  // 6. Commencing Meta API Dispatch
  console.log(`Commencing WhatsApp template delivery via Meta API...`)
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
  let sentCount = 0
  let failCount = 0
  const summaryText = `Sent Template: ${TEMPLATE_NAME}`

  for (let i = 0; i < remainingLeads.length; i++) {
    const lead = remainingLeads[i]
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
            status: 'sent'
          })
          .eq('broadcast_id', broadcast.id)
          .eq('lead_id', lead.id)

        // Ensure chat conversation exists in whatsapp_chats
        let { data: existingChat } = await supabase
          .from('whatsapp_chats')
          .select('id')
          .eq('user_id', BIOQUE_USER_ID)
          .eq('recipient_phone', cleanPhone)
          .maybeSingle()

        let chatId = existingChat?.id
        if (!chatId) {
          const { data: newChat } = await supabase
            .from('whatsapp_chats')
            .insert({
              user_id: BIOQUE_USER_ID,
              recipient_phone: cleanPhone,
              recipient_name: lead.name || 'Prospect',
              lead_id: lead.id,
              last_message_text: summaryText,
              unread_count: 0,
              updated_at: new Date().toISOString()
            })
            .select('id')
            .maybeSingle()
          chatId = newChat?.id
        } else {
          await supabase
            .from('whatsapp_chats')
            .update({
              last_message_text: summaryText,
              updated_at: new Date().toISOString()
            })
            .eq('id', chatId)
        }

        // Insert outbound message record into whatsapp_messages so chatbox displays it
        if (chatId) {
          await supabase
            .from('whatsapp_messages')
            .insert({
              chat_id: chatId,
              direction: 'outbound',
              message_text: summaryText,
              media_url: HEADER_IMAGE_URL,
              media_type: 'image',
              created_at: new Date().toISOString()
            })
        }
      } else {
        failCount++
        const errMsg = resData?.error?.message || 'Meta API error'
        console.warn(`[Failed] Lead #${i + 1} (${cleanPhone}): ${errMsg}`)
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
      console.error(`[Exception] Lead #${i + 1} (${cleanPhone}):`, sendErr.message)
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
    if ((i + 1) % 50 === 0 || i + 1 === remainingLeads.length) {
      console.log(`Progress: ${i + 1}/${remainingLeads.length} processed (Sent: ${sentCount}, Failed: ${failCount})`)
    }
  }

  // 7. Update broadcast record status to completed
  await supabase
    .from('whatsapp_broadcasts')
    .update({
      status: 'completed',
      sent_at: new Date().toISOString()
    })
    .eq('id', broadcast.id)

  console.log(`\n=======================================================`)
  console.log(`🎉 Broadcast Dispatch to Remaining Leads Finished!`)
  console.log(`Campaign: "${broadcastTitle}"`)
  console.log(`Total Remaining Leads Processed: ${remainingLeads.length}`)
  console.log(`Successfully Dispatched: ${sentCount}`)
  console.log(`Failed: ${failCount}`)
  console.log(`Broadcast Status: 'completed'`)
  console.log(`Flow ID: ${FLOW_ID}`)
  console.log(`Email Alerts Target: sakshi.rathi61@gmail.com`)
  console.log(`=======================================================\n`)
}

dispatchRemaining().then(() => process.exit(0)).catch(err => {
  console.error('Fatal dispatch error:', err)
  process.exit(1)
})
