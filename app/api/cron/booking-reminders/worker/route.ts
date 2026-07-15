import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendReminderEmail } from '@/utils/email-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to format friendly appointment time
function formatFriendlyDate(isoStr: string) {
  return new Date(isoStr).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
}

// Helper to send outbound WhatsApp text message
async function sendWhatsAppReminder(
  accessToken: string,
  phoneNumberId: string,
  toPhone: string,
  message: string
) {
  try {
    const cleanPhone = toPhone.replace(/[^0-9]/g, '')
    // Add default country code if missing
    const finalPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone

    const metaUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`
    const messagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: finalPhone,
      type: 'text',
      text: { body: message }
    }

    const res = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messagePayload)
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('[CRON REMINDERS WORKER] WhatsApp Send Error Response:', data)
      return { success: false, error: data }
    }
    return { success: true, messageId: data.messages?.[0]?.id }
  } catch (e: any) {
    console.error('[CRON REMINDERS WORKER] WhatsApp Fetch Exception:', e.message)
    return { success: false, error: e.message }
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Security check
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('[CRON REMINDERS WORKER] Unauthorized worker execution attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id: leadId, type: reminderType } = body

    if (!leadId || !reminderType) {
      return NextResponse.json({ error: 'Missing parameter: id, type' }, { status: 400 })
    }

    console.log(`[CRON REMINDERS WORKER] Processing ${reminderType} reminder for lead ID: ${leadId}...`)

    // A. Fetch lead details
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .maybeSingle()

    if (leadErr) throw leadErr
    if (!lead || !lead.booked_time) {
      return NextResponse.json({ error: 'Lead or booking details not found' }, { status: 404 })
    }

    // Double check that reminder has not been sent already
    let alreadySent = false
    let updatePayload: any = null
    let timeLeftStr = ''

    if (reminderType === '24h') {
      alreadySent = lead.reminder_24h_sent
      updatePayload = { reminder_24h_sent: true }
      timeLeftStr = '24 hours'
    } else if (reminderType === '4h') {
      alreadySent = lead.reminder_4h_sent
      updatePayload = { reminder_4h_sent: true }
      timeLeftStr = '4 hours'
    } else if (reminderType === '1h') {
      alreadySent = lead.reminder_1h_sent
      updatePayload = { reminder_1h_sent: true }
      timeLeftStr = '1 hour'
    } else if (reminderType === '15m') {
      alreadySent = lead.reminder_15m_sent
      updatePayload = { reminder_15m_sent: true }
      timeLeftStr = '15 minutes'
    }

    if (alreadySent) {
      console.log(`[CRON REMINDERS WORKER] Reminder ${reminderType} already sent for lead ${leadId}. Skipping.`)
      return NextResponse.json({ success: true, message: 'Already sent' })
    }

    // B. Fetch host profile settings
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, whatsapp_access_token, whatsapp_phone_number_id, custom_domain')
      .eq('id', lead.user_id)
      .maybeSingle()

    if (!profile) {
      return NextResponse.json({ error: 'Host profile not found' }, { status: 404 })
    }

    // Construct rescheduling and cancellation links
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
    const baseDomain = profile.custom_domain ? `https://${profile.custom_domain}` : appUrl
    const rescheduleLink = `${baseDomain}/booking/${lead.id}?action=reschedule`
    const cancelLink = `${baseDomain}/booking/${lead.id}?action=cancel`

    // Resolve lead email
    let leadEmail = lead.email || ''
    if (!leadEmail && lead.custom_fields) {
      try {
        const custom = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields
        const customKeys = Object.keys(custom)
        const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
        if (emailKey) {
          leadEmail = custom[emailKey]
        }
      } catch (e) {
        console.warn('[CRON REMINDERS WORKER] Error parsing email from custom_fields:', e)
      }
    }

    const friendlyTime = formatFriendlyDate(lead.booked_time)

    // 1. Dispatch Email Reminder
    if (leadEmail) {
      console.log(`[CRON REMINDERS WORKER] Sending email to ${leadEmail}...`)
      await sendReminderEmail(
        leadEmail,
        lead.name,
        lead.booked_time,
        lead.meet_link || '',
        rescheduleLink,
        cancelLink,
        profile.business_name || 'Our Team',
        'Asia/Kolkata',
        timeLeftStr
      ).catch(e => console.error('[CRON REMINDERS WORKER] Email dispatch failed:', e))
    }

    // 2. Dispatch WhatsApp Reminder
    if (profile.whatsapp_access_token && profile.whatsapp_phone_number_id && lead.phone) {
      console.log(`[CRON REMINDERS WORKER] Sending WhatsApp message to ${lead.phone}...`)
      
      let cleanPhone = lead.phone.replace(/\D/g, '')
      if (cleanPhone.startsWith('00')) {
        cleanPhone = cleanPhone.substring(2)
      }
      if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone
      } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
        cleanPhone = '91' + cleanPhone.substring(1)
      }

      // Check if chat exists, if not create
      let chat: any = null
      try {
        const { data: existingChat } = await supabaseAdmin
          .from('whatsapp_chats')
          .select('*')
          .eq('lead_id', lead.id)
          .maybeSingle()

        if (existingChat) {
          chat = existingChat
        } else {
          const { data: altChat } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('*')
            .eq('recipient_phone', cleanPhone)
            .eq('user_id', lead.user_id)
            .maybeSingle()

          if (altChat) {
            const { data: updatedChat } = await supabaseAdmin
              .from('whatsapp_chats')
              .update({ lead_id: lead.id })
              .eq('id', altChat.id)
              .select('*')
              .single()
            chat = updatedChat || altChat
          } else {
            const { data: newChat } = await supabaseAdmin
              .from('whatsapp_chats')
              .insert({
                user_id: lead.user_id,
                lead_id: lead.id,
                recipient_phone: cleanPhone,
                recipient_name: lead.name || 'Prospect',
                unread_count: 0,
                last_message_text: 'Reminder queued',
                last_message_at: new Date().toISOString()
              })
              .select('*')
              .single()
            chat = newChat
          }
        }
      } catch (chatErr) {
        console.error('[CRON REMINDERS WORKER] Error ensuring chat exists:', chatErr)
      }

      // Check 24-hour window active status
      let isWindowActive = false
      if (chat) {
        const { data: lastInbound } = await supabaseAdmin
          .from('whatsapp_messages')
          .select('created_at')
          .eq('chat_id', chat.id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)

        if (lastInbound && lastInbound.length > 0) {
          const lastInboundTime = new Date(lastInbound[0].created_at).getTime()
          if (Date.now() - lastInboundTime < 24 * 60 * 60 * 1000) {
            isWindowActive = true
          }
        }
      }

      const dateOptions = { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' } as const
      const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' } as const
      const formattedDate = new Date(lead.booked_time).toLocaleDateString('en-US', dateOptions)
      const formattedTime = new Date(lead.booked_time).toLocaleTimeString('en-US', timeOptions)

      let metaPayload: any = null
      let isTemplate = false
      let templateName = ''
      let logText = ''

      if (isWindowActive) {
        // Construct Free-form text message
        let messageBody = ''
        if (reminderType === '24h') {
          messageBody = `Hi ${lead.name || 'there'}, this is a quick reminder of your scheduled appointment with ${profile.business_name || 'us'} tomorrow, ${formattedDate} at ${formattedTime}. We look forward to speaking with you!`
        } else if (reminderType === '4h') {
          messageBody = `Hi ${lead.name || 'there'}, looking forward to our appointment today in 4 hours (at ${formattedTime}). Please let us know if you need to reschedule.`
        } else if (reminderType === '1h') {
          messageBody = `Hi ${lead.name || 'there'}, our meeting starts in 1 hour at ${formattedTime}. We look forward to connecting with you shortly!`
        } else if (reminderType === '15m') {
          messageBody = `Hi ${lead.name || 'there'}, we are starting in 15 minutes! Please click the link to join: ${lead.meet_link || 'our meeting link'}`
        }

        metaPayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: { body: messageBody }
        }
        logText = messageBody
      }

      if (!metaPayload) {
        isTemplate = true
        let templateParams: string[] = []

        if (reminderType === '24h') {
          templateName = 'auto_reminder_24h'
          templateParams = [lead.name || 'Valued Client', profile.business_name || 'our team', formattedDate, formattedTime]
        } else if (reminderType === '4h') {
          templateName = 'auto_reminder_4h'
          templateParams = [lead.name || 'Valued Client', formattedTime]
        } else if (reminderType === '1h') {
          templateName = 'auto_reminder_1h'
          templateParams = [lead.name || 'Valued Client', formattedTime]
        } else if (reminderType === '15m') {
          templateName = 'auto_reminder_15m'
          templateParams = [lead.name || 'Valued Client', lead.meet_link || 'our meeting link']
        }

        metaPayload = {
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: templateParams.map(val => ({ type: 'text', text: val }))
              }
            ]
          }
        }
        logText = `Sent Template: ${templateName}`
      }

      // Send to Meta API
      try {
        const metaUrl = `https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}/messages`
        const sendRes = await fetch(metaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${profile.whatsapp_access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(metaPayload)
        })

        const sendData = await sendRes.json()

        if (sendData.error) {
          console.error(`[CRON REMINDERS WORKER] Meta API rejected reminder for lead ${lead.name}:`, sendData.error)
          
          // Fallback to Template if free-form failed due to 24h limit
          if (!isTemplate && (sendData.error.code === 131047 || sendData.error.error_subcode === 2494010)) {
            console.log(`[CRON REMINDERS WORKER] Free-form failed due to 24h limit, falling back to Meta template...`);
            
            let fallbackTemplate = ''
            let fallbackParams: string[] = []

            if (reminderType === '24h') {
              fallbackTemplate = 'auto_reminder_24h'
              fallbackParams = [lead.name || 'Valued Client', profile.business_name || 'our team', formattedDate, formattedTime]
            } else if (reminderType === '4h') {
              fallbackTemplate = 'auto_reminder_4h'
              fallbackParams = [lead.name || 'Valued Client', formattedTime]
            } else if (reminderType === '1h') {
              fallbackTemplate = 'auto_reminder_1h'
              fallbackParams = [lead.name || 'Valued Client', formattedTime]
            } else if (reminderType === '15m') {
              fallbackTemplate = 'auto_reminder_15m'
              fallbackParams = [lead.name || 'Valued Client', lead.meet_link || 'our meeting link']
            }

            const fallbackPayload = {
              messaging_product: 'whatsapp',
              to: cleanPhone,
              type: 'template',
              template: {
                name: fallbackTemplate,
                language: { code: 'en_US' },
                components: [
                  {
                    type: 'body',
                    parameters: fallbackParams.map(val => ({ type: 'text', text: val }))
                  }
                ]
              }
            }

            const fallbackRes = await fetch(metaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(fallbackPayload)
            })
            const fallbackData = await fallbackRes.json()

            if (fallbackData.error) {
              console.error(`[CRON REMINDERS WORKER] Fallback template send failed:`, fallbackData.error)
            } else {
              console.log(`[CRON REMINDERS WORKER] Fallback template sent successfully for lead ${lead.name}`);
              logText = `Sent Template: ${fallbackTemplate}`
              if (chat) {
                await supabaseAdmin.from('whatsapp_messages').insert({
                  chat_id: chat.id,
                  direction: 'outbound',
                  message_text: logText
                })
              }
            }
          }
        } else {
          // Success
          console.log(`[CRON REMINDERS WORKER] WhatsApp sent successfully for lead ${lead.name}`);
          if (chat) {
            await supabaseAdmin.from('whatsapp_messages').insert({
              chat_id: chat.id,
              direction: 'outbound',
              message_text: logText
            })
            await supabaseAdmin.from('whatsapp_chats').update({
              last_message_text: logText,
              last_message_at: new Date().toISOString()
            }).eq('id', chat.id)
          }

          // Insert lead history log
          await supabaseAdmin.from('lead_history').insert({
            lead_id: lead.id,
            action_type: 'REMARK',
            description: `⏰ Automated ${reminderType} appointment reminder sent via WhatsApp.`
          })

          // Deduct credits
          try {
            const { deductCreditsByCost } = await import('@/utils/credits')
            await deductCreditsByCost(
              supabaseAdmin,
              lead.user_id,
              0.10,
              'whatsapp',
              `Automated WhatsApp appointment reminder (${reminderType}) to ${lead.name || 'Prospect'}`
            )
          } catch (crErr) {}
        }
      } catch (err: any) {
        console.error(`[CRON REMINDERS WORKER] Exception sending WhatsApp reminder:`, err.message)
      }
    }

    // 3. Mark reminder as sent in DB
    const { error: updErr } = await supabaseAdmin
      .from('leads')
      .update(updatePayload)
      .eq('id', lead.id)

    if (updErr) {
      console.error(`[CRON REMINDERS WORKER] Failed to update lead reminder state for ${lead.id}:`, updErr.message)
      throw updErr
    }

    console.log(`[CRON REMINDERS WORKER] Successfully sent and recorded ${reminderType} reminder for lead ${leadId}`)
    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('[CRON REMINDERS WORKER] Execution failed:', error)
    return NextResponse.json({ error: error.message || 'Worker execution failed' }, { status: 500 })
  }
}
