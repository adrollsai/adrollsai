import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const TEMPLATE_NAME = 'marq'
const HEADER_IMAGE_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/user_assets/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/kie_gen_1789882406376_h3h4kp.png'
const AUDIENCE_TAG = 'List of buyer - list'
const FLOW_ID = '3a9feb3e-3126-47b6-a516-57201aee78cf'
const FLOW_TITLE = 'The Marq — Sector 82'

// TIER_250 safe cap (leaving buffer for inbound / direct testing)
const BATCH_LIMIT = 240

async function dispatchHomcomBuyers(sendAll: boolean = false) {
  console.log(`Starting Marq broadcast dispatch for HOMCOM REALTORS...`)

  // 1. Fetch credentials
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_waba_id')
    .eq('id', HOMCOM_USER_ID)
    .single()

  if (profErr || !profile) {
    console.error('Failed to load HOMCOM profile:', profErr)
    return
  }

  const phoneId = profile.whatsapp_phone_number_id
  const accessToken = profile.whatsapp_access_token
  if (!phoneId || !accessToken) {
    console.error('HOMCOM profile missing WhatsApp credentials!')
    return
  }

  // 2. Fetch leads
  const { data: leads, error: leadErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, csv_audience')
    .eq('user_id', HOMCOM_USER_ID)
    .eq('csv_audience', AUDIENCE_TAG)
    .order('created_at', { ascending: true })

  if (leadErr || !leads || leads.length === 0) {
    console.error('No leads found for audience:', AUDIENCE_TAG, leadErr)
    return
  }

  // Clean & deduplicate phones
  const seenPhones = new Set<string>()
  const validLeads: any[] = []

  for (const l of leads) {
    let clean = (l.phone || '').replace(/\D/g, '')
    if (clean.startsWith('0') && clean.length === 11) {
      clean = clean.slice(1)
    }
    if (clean.length === 10) {
      clean = '91' + clean
    }
    if (clean.length >= 10 && clean.length <= 15) {
      if (!seenPhones.has(clean)) {
        seenPhones.add(clean)
        validLeads.push({ ...l, cleanPhone: clean })
      }
    }
  }

  const targetLeads = sendAll ? validLeads : validLeads.slice(0, BATCH_LIMIT)
  console.log(`Targeting ${targetLeads.length} leads out of ${validLeads.length} valid buyer leads.`)

  // 3. Create broadcast record
  const broadcastTitle = `[Flow: ${FLOW_TITLE}] The Marq Aerocity - List of Buyers (Batch 1: ${targetLeads.length} Leads) [flow:${FLOW_ID}]`
  const { data: broadcast, error: bcastErr } = await supabase
    .from('whatsapp_broadcasts')
    .insert({
      user_id: HOMCOM_USER_ID,
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

  // Link to flow description
  try {
    const { data: flowRow } = await supabase
      .from('automations')
      .select('description')
      .eq('id', FLOW_ID)
      .single()

    if (flowRow) {
      const desc = JSON.parse(flowRow.description || '{}')
      desc.lastBroadcastId = broadcast.id
      desc.lastBroadcastAt = new Date().toISOString()
      desc.lastBroadcastAudience = AUDIENCE_TAG
      desc.lastBroadcastRecipients = targetLeads.length
      await supabase
        .from('automations')
        .update({ description: JSON.stringify(desc) })
        .eq('id', FLOW_ID)
      console.log(`Linked broadcast to flow ${FLOW_ID}`)
    }
  } catch (flowErr) {
    console.warn('Could not link broadcast to flow:', flowErr)
  }

  // 4. Insert recipient rows
  const recipientRows = targetLeads.map(l => ({
    broadcast_id: broadcast.id,
    lead_id: l.id,
    user_id: HOMCOM_USER_ID,
    phone_number: l.cleanPhone,
    status: 'pending',
    created_at: new Date().toISOString()
  }))

  for (let i = 0; i < recipientRows.length; i += 100) {
    const chunk = recipientRows.slice(i, i + 100)
    await supabase.from('whatsapp_broadcast_recipients').insert(chunk)
  }
  console.log(`Inserted ${recipientRows.length} recipient rows in DB.`)

  // 5. Dispatch via Meta API
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
  let sentCount = 0
  let failCount = 0

  for (let i = 0; i < targetLeads.length; i++) {
    const lead = targetLeads[i]
    const cleanPhone = lead.cleanPhone

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
          .eq('phone_number', cleanPhone)

        // Ensure chat conversation exists in whatsapp_chats so replies show in inbox
        const { data: existingChat } = await supabase
          .from('whatsapp_chats')
          .select('id')
          .eq('user_id', HOMCOM_USER_ID)
          .eq('recipient_phone', cleanPhone)
          .maybeSingle()

        if (!existingChat) {
          await supabase.from('whatsapp_chats').insert({
            user_id: HOMCOM_USER_ID,
            recipient_phone: cleanPhone,
            recipient_name: lead.name || 'Buyer',
            lead_id: lead.id,
            last_message_text: `Sent Template: ${TEMPLATE_NAME}`,
            unread_count: 0,
            updated_at: new Date().toISOString()
          })
        }
      } else {
        failCount++
        const errMsg = resData?.error?.message || 'Meta API error'
        console.warn(`Failed lead ${cleanPhone} (${lead.name}): ${errMsg}`)
        await supabase
          .from('whatsapp_broadcast_recipients')
          .update({
            status: 'failed',
            error_message: errMsg
          })
          .eq('broadcast_id', broadcast.id)
          .eq('phone_number', cleanPhone)
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
        .eq('phone_number', cleanPhone)
    }

    // Rate pacing: 60ms delay
    await new Promise(r => setTimeout(r, 60))

    if ((i + 1) % 25 === 0 || i === targetLeads.length - 1) {
      console.log(`Progress: ${i + 1}/${targetLeads.length} processed (Sent: ${sentCount}, Failed: ${failCount})`)
    }
  }

  // 6. Update broadcast record status
  await supabase
    .from('whatsapp_broadcasts')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString()
    })
    .eq('id', broadcast.id)

  console.log(`\n🎉 Campaign Broadcast Completed!`)
  console.log(`Campaign: ${broadcastTitle}`)
  console.log(`Total Target Leads: ${targetLeads.length}`)
  console.log(`Successfully Dispatched: ${sentCount}`)
  console.log(`Failed: ${failCount}`)
  console.log(`Broadcast ID: ${broadcast.id}`)
  console.log(`Flow ID: ${FLOW_ID}`)
  console.log(`Admin Alert Email: ihomcomrealtors@gmail.com`)
}

// Check command line arguments: pass --all to send all 303, otherwise sends Batch 1 (240)
const sendAllFlag = process.argv.includes('--all')
dispatchHomcomBuyers(sendAllFlag).then(() => process.exit(0)).catch(console.error)
