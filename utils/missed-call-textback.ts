import { SupabaseClient } from '@supabase/supabase-js'

interface MissedCallParams {
  supabaseAdmin: SupabaseClient
  leadId?: string | null
  profileId: string
  callerPhone: string
  callerName?: string | null
  reason?: string
}

// In-memory cooldown set to prevent sending duplicate text backs within 15 minutes to the same caller
const recentTextBacks = new Map<string, number>()

export async function triggerMissedCallTextBack({
  supabaseAdmin,
  leadId,
  profileId,
  callerPhone,
  callerName,
  reason = 'missed_call'
}: MissedCallParams): Promise<{ success: boolean; channel?: string; error?: string }> {
  try {
    if (!callerPhone || !profileId) {
      return { success: false, error: 'Missing phone or profileId' }
    }

    const cleanPhone = callerPhone.replace(/[^\d+]/g, '')
    const cooldownKey = `${profileId}_${cleanPhone}`
    const now = Date.now()
    const lastSent = recentTextBacks.get(cooldownKey) || 0

    // 15-minute cooldown per caller
    if (now - lastSent < 15 * 60 * 1000) {
      console.log(`[MISSED CALL TEXTBACK] Skipping for ${cleanPhone}: already sent within 15 minutes.`)
      return { success: true, channel: 'skipped_cooldown' }
    }

    // Fetch business profile settings
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, full_name, contact_number, custom_domain, business_info, voice_twilio_sid, voice_twilio_token, voice_twilio_number, whatsapp_phone_number_id, whatsapp_access_token, whatsapp_phone_number')
      .eq('id', profileId)
      .single()

    if (!profile) {
      return { success: false, error: 'Profile not found' }
    }

    let bi: any = {}
    if (profile.business_info) {
      try {
        bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : profile.business_info
      } catch {}
    }

    // Check if missed call textback is enabled (either directly on profile or in business_info)
    const isEnabled = (profile as any).missed_call_textback_enabled === true || bi.missed_call_textback_enabled === true
    if (!isEnabled) {
      console.log(`[MISSED CALL TEXTBACK] Feature is disabled for profile ${profileId}`)
      return { success: false, error: 'Feature disabled' }
    }

    const platform = ((profile as any).missed_call_platform || bi.missed_call_platform || 'twilio').toLowerCase()
    const flowType = (profile as any).missed_call_flow_type || bi.missed_call_flow_type || 'booking_link'
    const customTemplate = (profile as any).missed_call_custom_template || bi.missed_call_custom_template || ''

    const businessName = profile.business_name || profile.full_name || 'our office'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
    const bookingLink = profile.custom_domain
      ? `https://${profile.custom_domain}/book`
      : `${appUrl}/book/${profileId}`

    const resolvedName = callerName || 'there'

    // Build message body
    let messageBody = customTemplate
    if (!messageBody || messageBody.trim().length === 0) {
      messageBody = `Hi {{caller_name}}! Sorry we missed your call at {{business_name}}. We're currently assisting other clients. How can we help you? You can easily book an appointment or strategy call directly here: {{booking_link}}`
    }

    // Replace merge tags
    messageBody = messageBody
      .replace(/{{caller_name}}/gi, resolvedName)
      .replace(/{{business_name}}/gi, businessName)
      .replace(/{{booking_link}}/gi, bookingLink)

    let sendSuccess = false
    let usedChannel = platform

    // 1. WhatsApp API Channel
    if (platform === 'whatsapp') {
      const waPhoneId = profile.whatsapp_phone_number_id || process.env.META_WA_PHONE_NUMBER_ID
      const waToken = profile.whatsapp_access_token || process.env.META_WA_SYSTEM_USER_TOKEN

      if (waPhoneId && waToken) {
        try {
          const toDigits = cleanPhone.replace(/\D/g, '')
          const metaUrl = `https://graph.facebook.com/v20.0/${waPhoneId}/messages`

          let waPayload: any
          if (flowType === 'interactive_flow' || flowType === 'booking_link') {
            // Send Interactive Button Message with direct booking CTA
            waPayload = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: toDigits,
              type: 'interactive',
              interactive: {
                type: 'cta_url',
                body: { text: messageBody },
                action: {
                  name: 'cta_url',
                  parameters: {
                    display_text: '📅 Book Appointment',
                    url: bookingLink
                  }
                }
              }
            }
          } else {
            // Standard text message
            waPayload = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: toDigits,
              type: 'text',
              text: { body: messageBody }
            }
          }

          const waRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${waToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(waPayload)
          })

          const waData = await waRes.json()
          if (waRes.ok && waData?.messages) {
            sendSuccess = true
            console.log(`[MISSED CALL TEXTBACK] Successfully sent WhatsApp message to ${cleanPhone}`)
          } else {
            console.warn(`[MISSED CALL TEXTBACK] WhatsApp API returned error, falling back to Twilio if available:`, waData)
          }
        } catch (waErr: any) {
          console.error(`[MISSED CALL TEXTBACK] WhatsApp error:`, waErr.message)
        }
      }
    }

    // 2. Twilio SMS Channel (Primary if selected, or fallback if WhatsApp failed)
    if (!sendSuccess && (platform === 'twilio' || !sendSuccess)) {
      usedChannel = 'twilio'
      const twilioSid = profile.voice_twilio_sid || process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID
      const twilioToken = profile.voice_twilio_token || process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN
      let fromNumber = profile.voice_twilio_number || process.env.MASTER_TWILIO_PHONE_NUMBER || process.env.DEV_TWILIO_PHONE_NUMBER

      if (twilioSid && twilioToken && fromNumber) {
        try {
          const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`

          const params = new URLSearchParams()
          params.append('From', fromNumber)
          params.append('To', cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`)
          params.append('Body', messageBody)

          const smsRes = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
          })

          const smsData = await smsRes.json()
          if (smsRes.ok && smsData.sid) {
            sendSuccess = true
            console.log(`[MISSED CALL TEXTBACK] Successfully sent Twilio SMS to ${cleanPhone} (SID: ${smsData.sid})`)
          } else {
            console.error(`[MISSED CALL TEXTBACK] Twilio SMS failed:`, smsData)
          }
        } catch (smsErr: any) {
          console.error(`[MISSED CALL TEXTBACK] Twilio SMS exception:`, smsErr.message)
        }
      }
    }

    if (sendSuccess) {
      recentTextBacks.set(cooldownKey, Date.now())

      // Log in lead_history if leadId exists
      if (leadId) {
        try {
          await supabaseAdmin.from('lead_history').insert({
            lead_id: leadId,
            action_type: 'MISSED_CALL_TEXTBACK',
            description: `📲 Auto-sent missed call text back via ${usedChannel.toUpperCase()} with appointment booking link (${bookingLink}) to ${cleanPhone}. Reason: ${reason}`
          })
        } catch {}
      }

      return { success: true, channel: usedChannel }
    }

    return { success: false, error: 'Could not send text back via configured channels' }
  } catch (err: any) {
    console.error('[MISSED CALL TEXTBACK] Error in execution:', err)
    return { success: false, error: err.message || 'Internal error' }
  }
}
