import { refreshGoogleAccessToken, getCalendarTimezone } from '@/utils/google-calendar'
import { sendCAPIEvent } from '@/utils/external-apis'
import { sendBookingConfirmationEmail } from '@/utils/email-helper'
import { hasEnoughCredits } from '@/utils/credits'

/**
 * Warms up the Cloud Run Voice Bridge container to prevent cold-start websocket timeouts in Twilio.
 */
export async function warmupVoiceBridge(): Promise<void> {
    const bridgeUrl = process.env.GEMINI_VOICE_BRIDGE_URL || 'ws://localhost:5050';
    if (bridgeUrl.startsWith('ws')) {
        const healthUrl = bridgeUrl.replace(/^ws/, 'http') + '/health';
        console.log(`[VOICE HELPER] Warming up Voice Bridge container at: ${healthUrl}`);
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 8000);
            const warmupRes = await fetch(healthUrl, { signal: controller.signal });
            clearTimeout(id);
            if (warmupRes.ok) {
                console.log(`[VOICE HELPER] Voice Bridge container warmed up successfully.`);
            } else {
                console.warn(`[VOICE HELPER] Voice Bridge warmup returned status: ${warmupRes.status}`);
            }
        } catch (warmupErr: any) {
            console.warn(`[VOICE HELPER] Voice Bridge warmup failed or timed out:`, warmupErr.message);
        }
    }
}

/**
 * Triggers an automated outbound AI call for a lead via Twilio and ElevenLabs.
 */
export async function triggerOutboundCall(
    supabaseAdmin: any,
    leadId: string,
    profileId: string,
    isAutoTrigger = false
): Promise<{ success: boolean; error?: string; callSid?: string; scheduled?: boolean; scheduledTime?: Date }> {
    try {
        // 1. Fetch credentials from user profile
        const { data: profile, error: profErr } = await supabaseAdmin
            .from('profiles')
            .select('elevenlabs_api_key, elevenlabs_agent_id, voice_twilio_sid, voice_twilio_token, voice_twilio_number, google_refresh_token, google_booking_enabled')
            .eq('id', profileId)
            .single()

        if (profErr || !profile) {
            return { success: false, error: 'Failed to fetch user voice configuration.' }
        }

        if (isAutoTrigger) {
            // Resolve timezone
            let timeZone = 'Asia/Kolkata' // Default fallback timezone
            if (profile && profile.google_refresh_token && profile.google_booking_enabled) {
                try {
                    const refreshToken = profile.google_refresh_token
                    const accessToken = await refreshGoogleAccessToken(refreshToken)
                    timeZone = await getCalendarTimezone(accessToken)
                } catch (tzErr: any) {
                    console.warn('[VOICE HELPER] Failed to fetch calendar timezone, defaulting to Asia/Kolkata:', tzErr.message)
                }
            }

            // Check if within window (9 AM to 7 PM business local time)
            const now = new Date()
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            })
            const formattedStr = formatter.format(now)
            const [hStr, mStr] = formattedStr.split(':')
            const hourVal = parseInt(hStr, 10)
            const minuteVal = parseInt(mStr, 10)
            
            const timeInMinutes = hourVal * 60 + minuteVal
            const startMinutes = 9 * 60     // 9:00 AM
            const endMinutes = 19 * 60       // 7:00 PM

            const isWithinWindow = timeInMinutes >= startMinutes && timeInMinutes < endMinutes

            if (!isWithinWindow) {
                // Calculate next valid 9 AM slot in local time and convert to UTC Date
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone,
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    hour12: false
                }).formatToParts(now)
                const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]))
                
                const year = parseInt(partMap.year, 10)
                const month = parseInt(partMap.month, 10) - 1
                const day = parseInt(partMap.day, 10)
                const hour = parseInt(partMap.hour, 10)
                
                let targetDay = day
                if (hour >= 19) {
                    // After 7 PM -> schedule for tomorrow at 9 AM
                    targetDay += 1
                }
                // Before 9 AM -> schedule for today at 9 AM (targetDay stays same)

                const localUtcTs = Date.UTC(year, month, targetDay, 9, 0, 0, 0)
                
                const getOffset = (tz: string, d: Date) => {
                    const tzStr = d.toLocaleString('en-US', { timeZone: tz })
                    const locD = new Date(tzStr)
                    const utcD = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
                    return (locD.getTime() - utcD.getTime()) / 60000
                }
                
                const offsetMin = getOffset(timeZone, new Date(localUtcTs))
                const scheduledTime = new Date(localUtcTs - offsetMin * 60000)

                // Update lead in DB
                await supabaseAdmin
                    .from('leads')
                    .update({ 
                        voice_call_scheduled_at: scheduledTime.toISOString(),
                        voice_call_status: 'scheduled_callback'
                    })
                    .eq('id', leadId)

                // Log to history
                try {
                    await supabaseAdmin.from('lead_history').insert({
                        lead_id: leadId,
                        action_type: 'REMARK',
                        description: `🕒 Auto-call scheduled for ${scheduledTime.toLocaleString('en-US', { timeZone })} (${timeZone}) because the lead arrived outside business hours (9 AM - 7 PM).`
                    })
                } catch (histErr) {
                    console.error('[VOICE HELPER] Failed to insert lead history for scheduling outside hours:', histErr)
                }

                console.log(`[VOICE HELPER] Lead ${leadId} call scheduled for ${scheduledTime.toISOString()} due to outside hours (9 AM - 7 PM).`)
                return { success: true, scheduled: true, scheduledTime }
            }
        }
        
        // Check credit balance (must have at least 40 credits to dial 1 minute)
        const hasCredits = await hasEnoughCredits(supabaseAdmin, profileId, 40)
        if (!hasCredits) {
            console.warn(`[VOICE HELPER] Outbound call aborted for lead ${leadId}: Insufficient credits for user ${profileId}`)
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', leadId)
            
            try {
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `❌ Outbound call aborted: Insufficient credit balance. Please recharge your Nobo Credits to make voice calls.`
                })
            } catch (hErr) {
                console.error('[VOICE HELPER] Failed to write out-of-credits history entry:', hErr)
            }
            return { success: false, error: 'Insufficient credits' }
        }

        const twilioSid = process.env.MASTER_TWILIO_SID || profile.voice_twilio_sid || process.env.DEV_TWILIO_SID
        const twilioToken = process.env.MASTER_TWILIO_TOKEN || profile.voice_twilio_token || process.env.DEV_TWILIO_TOKEN
        const voiceNumber = profile.voice_twilio_number || process.env.MASTER_TWILIO_NUMBER

        if (!twilioSid || !twilioToken || !voiceNumber) {
            return { success: false, error: 'Voice calling credentials or phone number are not configured.' }
        }

        // 2. Fetch lead details
        const { data: lead, error: leadErr } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone')
            .eq('id', leadId)
            .single()

        if (leadErr || !lead || !lead.phone) {
            return { success: false, error: 'Lead not found or has no phone number.' }
        }

        // 3. Format phone number to E.164
        let cleanPhone = lead.phone.replace(/\D/g, '')
        if (!cleanPhone.startsWith('+')) {
            if (cleanPhone.length === 10) {
                cleanPhone = '+91' + cleanPhone // Default to India country code if 10 digits
            } else {
                cleanPhone = '+' + cleanPhone
            }
        }

        // Warm up the Cloud Run voice bridge container before placing the call
        await warmupVoiceBridge();

        console.log(`[VOICE HELPER] Dialing lead ${lead.name} (${cleanPhone}) from caller ID ${voiceNumber}...`)

        // 4. Update status to calling
        await supabaseAdmin
            .from('leads')
            .update({ voice_call_status: 'calling' })
            .eq('id', lead.id)

        // 5. Call Twilio REST API
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://local.nobogent.com'
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`
        const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')

        const params = new URLSearchParams()
        params.append('Url', `${appUrl}/api/voice/twiml?leadId=${lead.id}&profileId=${profileId}`)
        params.append('To', cleanPhone)
        params.append('From', voiceNumber.trim())
        params.append('StatusCallback', `${appUrl}/api/voice/status-callback?leadId=${lead.id}`)
        params.append('TimeLimit', '300') // Set hard limit of 5 minutes (300 seconds) for the call

        const twilioRes = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${twilioAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        })

        const twilioData = await twilioRes.json()

        if (!twilioRes.ok) {
            console.error('[VOICE HELPER] Twilio REST API failed:', twilioData)
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', lead.id)

            return { success: false, error: twilioData.message || 'Twilio calling failed.' }
        }

        console.log(`[VOICE HELPER] Call initiated successfully. Sid: ${twilioData.sid}`)
        return { success: true, callSid: twilioData.sid }
    } catch (e: any) {
        console.error('[VOICE HELPER] Error initiating call:', e)
        return { success: false, error: e.message || 'Internal error' }
    }
}

/**
 * Automates booking an appointment for a lead, integrating Google Calendar,
 * CRM updates, email confirmation, history logging, and Meta CAPI tracking.
 */
export async function bookAppointment(
    supabaseAdmin: any,
    leadId: string,
    slot: string,
    profileId: string
): Promise<{ success: boolean; meetLink?: string; error?: string }> {
    try {
        console.log(`[VOICE HELPER] Booking appointment for lead ${leadId} at slot ${slot}...`)

        // 1. Fetch Lead Details
        const { data: lead, error: leadError } = await supabaseAdmin
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .maybeSingle()

        if (leadError) throw leadError
        if (!lead) {
            return { success: false, error: 'Lead not found' }
        }

        // 2. Fetch Host Settings
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('google_refresh_token, google_booking_enabled, google_booking_duration, google_booking_hours, business_name, google_calendar_id, facebook_token, selected_page_token, pixel_id')
            .eq('id', profileId)
            .maybeSingle()

        if (profileError) throw profileError

        let hangoutLink = ''
        let calendarEventId: string | null = null
        let calendarEventCreated = false
        let timeZone = 'Asia/Kolkata' // Default fallback timezone

        // Resolve calendar timezone if integrated
        if (profile && profile.google_refresh_token && profile.google_booking_enabled) {
            try {
                const refreshToken = profile.google_refresh_token
                const accessToken = await refreshGoogleAccessToken(refreshToken)
                timeZone = await getCalendarTimezone(accessToken)
            } catch (tzErr: any) {
                console.warn('[VOICE HELPER] Failed to fetch calendar timezone:', tzErr.message)
            }
        }

        // Convert slot to correct UTC ISO-8601 string based on timezone if it lacks offset
        let formattedSlot = slot
        if (slot && !/Z|[+-]\d{2}:?\d{2}$/.test(slot)) {
            try {
                const parts = slot.split(/[T:-]/)
                if (parts.length >= 5) {
                    const yr = parseInt(parts[0])
                    const mo = parseInt(parts[1]) - 1
                    const dy = parseInt(parts[2])
                    const hr = parseInt(parts[3])
                    const mi = parseInt(parts[4])
                    const se = parts[5] ? parseInt(parts[5]) : 0
                    
                    const utcTs = Date.UTC(yr, mo, dy, hr, mi, se)
                    
                    const getOffset = (tz: string, d: Date) => {
                        const tzStr = d.toLocaleString('en-US', { timeZone: tz })
                        const locD = new Date(tzStr)
                        const utcD = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
                        return (locD.getTime() - utcD.getTime()) / 60000
                    }
                    
                    const offsetMin = getOffset(timeZone, new Date(utcTs))
                    const actualUtc = new Date(utcTs - offsetMin * 60000)
                    formattedSlot = actualUtc.toISOString()
                    console.log(`[VOICE HELPER] Local slot ${slot} converted to UTC: ${formattedSlot} for timezone ${timeZone}`)
                }
            } catch (err: any) {
                console.error('[VOICE HELPER] Failed to convert local slot to UTC timezone:', err.message)
            }
        }

        // Check availability hours & slot validity
        const duration = profile?.google_booking_duration || 30
        const start = new Date(formattedSlot)
        const end = new Date(start.getTime() + (duration * 60000))
        
        let bookingHours = { start: '09:00', end: '17:00' }
        if (profile?.google_booking_hours && typeof profile.google_booking_hours === 'object') {
            const h = profile.google_booking_hours as any
            if (h.start) bookingHours.start = h.start
            if (h.end) bookingHours.end = h.end
        }

        const timeFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        
        const slotStartFormatted = timeFormatter.format(start)
        const slotEndFormatted = timeFormatter.format(end)

        if (slotStartFormatted < bookingHours.start || slotEndFormatted > bookingHours.end) {
            console.warn(`[VOICE HELPER] Booking failed: proposed slot ${slotStartFormatted} - ${slotEndFormatted} is outside working hours: ${bookingHours.start} - ${bookingHours.end}`)
            return { success: false, error: 'out_of_hours' }
        }

        // Overlapping event checks (Google Calendar vs local DB fallback)
        let isSlotAvailable = true
        if (profile && profile.google_refresh_token && profile.google_booking_enabled) {
            try {
                const refreshToken = profile.google_refresh_token
                const accessToken = await refreshGoogleAccessToken(refreshToken)
                const calendarId = encodeURIComponent(profile.google_calendar_id || 'primary')
                const timeMin = start.toISOString()
                const timeMax = end.toISOString()

                const checkUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`
                const checkRes = await fetch(checkUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                })
                const checkData = await checkRes.json()
                if (checkRes.ok && checkData.items) {
                    const activeEvents = checkData.items.filter((event: any) => event.status !== 'cancelled')
                    if (activeEvents.length > 0) {
                        isSlotAvailable = false
                        console.warn(`[VOICE HELPER] Google Calendar slot taken. Found overlapping events:`, activeEvents)
                    }
                }
            } catch (calErr: any) {
                console.warn('[VOICE HELPER] Google Calendar availability check failed:', calErr.message)
            }
        } else {
            // Check Supabase leads table for overlapping booked slot for this user
            try {
                const { data: overlappingLeads, error: dbErr } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, booked_time')
                    .eq('user_id', profileId)
                    .not('booked_time', 'is', null)
                    .neq('id', leadId)
                
                if (dbErr) throw dbErr

                if (overlappingLeads && overlappingLeads.length > 0) {
                    for (const otherLead of overlappingLeads) {
                        const otherStart = new Date(otherLead.booked_time)
                        const otherEnd = new Date(otherStart.getTime() + (duration * 60000))
                        if (
                            (start >= otherStart && start < otherEnd) ||
                            (end > otherStart && end <= otherEnd) ||
                            (start <= otherStart && end >= otherEnd)
                        ) {
                            isSlotAvailable = false
                            console.warn(`[VOICE HELPER] DB fallback slot taken. Overlaps with lead: ${otherLead.name} (${otherLead.booked_time})`)
                            break
                        }
                    }
                }
            } catch (dbCheckErr: any) {
                console.error('[VOICE HELPER] DB availability check failed:', dbCheckErr.message)
            }
        }

        if (!isSlotAvailable) {
            return { success: false, error: 'slot_taken' }
        }

        // 3. Create Calendar Event on Google Calendar (if integrated)
        if (profile && profile.google_refresh_token && profile.google_booking_enabled) {
            try {
                const refreshToken = profile.google_refresh_token
                const duration = profile.google_booking_duration || 30

                const accessToken = await refreshGoogleAccessToken(refreshToken)
                const calendarId = encodeURIComponent(profile.google_calendar_id || 'primary')

                const start = new Date(formattedSlot)
                const end = new Date(start.getTime() + (duration * 60000))

                let leadEmail = lead.email || ''
                if (!leadEmail && lead.custom_fields) {
                    const customKeys = Object.keys(lead.custom_fields)
                    const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
                    if (emailKey) {
                        leadEmail = lead.custom_fields[emailKey]
                    }
                }

                const eventBody: any = {
                    summary: `Meeting with ${lead.name}`,
                    description: `Google Calendar Booking via Voice Agent.\nName: ${lead.name}\nPhone: ${lead.phone || 'N/A'}\nGenerated via AdRolls CRM.`,
                    start: {
                        dateTime: start.toISOString(),
                        timeZone
                    },
                    end: {
                        dateTime: end.toISOString(),
                        timeZone
                    },
                    reminders: {
                        useDefault: true
                    },
                    conferenceData: {
                        createRequest: {
                            requestId: `booking-voice-${lead.id}-${start.getTime()}`,
                            conferenceSolutionKey: {
                                type: 'hangoutsMeet'
                            }
                        }
                    }
                }

                if (leadEmail) {
                    eventBody.attendees = [{ email: leadEmail }]
                }

                // Delete old calendar event if rescheduling
                if (lead.google_calendar_event_id) {
                    try {
                        const oldEventId = lead.google_calendar_event_id
                        const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${oldEventId}`
                        await fetch(deleteUrl, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        })
                        console.log(`[VOICE HELPER] Successfully deleted old Google Calendar event: ${oldEventId}`)
                    } catch (delErr: any) {
                        console.warn('[VOICE HELPER] Failed to delete old event during reschedule:', delErr.message || delErr)
                    }
                }

                const calendarEventRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all&conferenceDataVersion=1`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(eventBody)
                })

                const eventResult = await calendarEventRes.json()

                if (eventResult.error) {
                    console.warn('[VOICE HELPER] Google Calendar API Error:', eventResult.error)
                } else {
                    hangoutLink = eventResult.hangoutLink || ''
                    calendarEventId = eventResult.id || null
                    calendarEventCreated = true
                    console.log(`[VOICE HELPER] Google Calendar event created successfully. Link: ${hangoutLink}, Event ID: ${calendarEventId}`)
                }
            } catch (calErr: any) {
                console.warn('[VOICE HELPER] Failed to book via Google Calendar:', calErr.message || calErr)
            }
        } else {
            console.log('[VOICE HELPER] Google Calendar integration not configured for user. Falling back to basic CRM booking.')
        }

        // 4. Update Lead in Supabase
        const { error: updateError } = await supabaseAdmin
            .from('leads')
            .update({
                booked_time: formattedSlot,
                pipeline_stage: 'Appointment booked',
                meet_link: hangoutLink || null,
                google_calendar_event_id: calendarEventId || null,
                reminder_24h_sent: false,
                reminder_4h_sent: false,
                reminder_1h_sent: false,
                reminder_15m_sent: false,
                // Clear any pending AI voice call — human agent handles booked meetings
                voice_call_scheduled_at: null,
                voice_call_status: 'completed',
                voice_call_retry_count: 0
            })
            .eq('id', leadId)

        if (updateError) throw updateError


        // 5. Send confirmation email to lead
        let leadEmail = lead.email || ''
        if (!leadEmail && lead.custom_fields) {
            const customKeys = Object.keys(lead.custom_fields)
            const emailKey = customKeys.find(k => k.toLowerCase().includes('email'))
            if (emailKey) {
                leadEmail = lead.custom_fields[emailKey]
            }
        }

        if (leadEmail) {
            try {
                await sendBookingConfirmationEmail(
                    leadEmail,
                    lead.name,
                    formattedSlot,
                    hangoutLink,
                    profile?.business_name || 'Consultation',
                    timeZone
                )
                console.log(`[VOICE HELPER] Sent confirmation email to lead: ${leadEmail}`)
            } catch (emailErr) {
                console.error('[VOICE HELPER] Failed to send confirmation email:', emailErr)
            }
        }

        // 6. Save History Log
        try {
            const localSlotDate = new Date(formattedSlot)
            const formattedDate = localSlotDate.toLocaleString('en-US', {
                timeZone: timeZone,
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            })
            const historyDesc = `📆 Appointment booked automatically by Voice AI for ${formattedDate}${hangoutLink ? ` (Google Meet: ${hangoutLink})` : ''}`

            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                user_id: profileId,
                action_type: 'STATUS_CHANGE',
                description: historyDesc
            })
        } catch (histErr) {
            console.error('[VOICE HELPER] Failed to log lead history:', histErr)
        }

        // 7. Trigger Conversions API (CAPI) Schedule Event
        const pixelId = lead?.pixel_id || profile?.pixel_id
        const fbToken = profile?.facebook_token || profile?.selected_page_token
        if (pixelId && fbToken) {
            try {
                const nameParts = (lead.name || '').trim().split(/\s+/)
                const firstName = nameParts[0] || ''
                const lastName = nameParts.slice(1).join(' ') || ''

                console.log(`[VOICE HELPER] Dispatching Meta CAPI Schedule event for Pixel: ${pixelId}`)
                await sendCAPIEvent(
                    fbToken,
                    pixelId,
                    'Schedule',
                    {
                        email: leadEmail || undefined,
                        phone: lead.phone,
                        firstName: firstName,
                        lastName: lastName,
                        externalId: lead.id
                    },
                    0,
                    '127.0.0.1',
                    'VoiceAgent',
                    ''
                )
            } catch (capiErr) {
                console.error('[VOICE HELPER] Failed to send Meta CAPI Schedule event:', capiErr)
            }
        }

        return { success: true, meetLink: hangoutLink }
    } catch (e: any) {
        console.error('[VOICE HELPER] bookAppointment Exception:', e)
        return { success: false, error: e.message || 'Internal error' }
    }
}

/**
 * Cancels a booked appointment, deleting Google Calendar event and clearing booked_time fields.
 */
export async function cancelAppointment(
    supabaseAdmin: any,
    leadId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        console.log(`[VOICE HELPER] Cancelling appointment for lead ${leadId}...`)

        // 1. Fetch Lead Details
        const { data: lead, error: leadError } = await supabaseAdmin
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .maybeSingle()

        if (leadError) throw leadError
        if (!lead) {
            return { success: false, error: 'Lead not found' }
        }

        // 2. Fetch Host Settings if Google calendar integration is used
        if (lead.google_calendar_event_id) {
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('google_refresh_token, google_calendar_id')
                .eq('id', lead.user_id)
                .maybeSingle()

            if (profileError) throw profileError

            if (profile && profile.google_refresh_token) {
                try {
                    const accessToken = await refreshGoogleAccessToken(profile.google_refresh_token)
                    const calendarId = encodeURIComponent(profile.google_calendar_id || 'primary')
                    const eventId = lead.google_calendar_event_id
                    
                    const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`
                    await fetch(deleteUrl, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    })
                    console.log(`[VOICE HELPER] Deleted Google Calendar event ${eventId} on cancellation`)
                } catch (calErr: any) {
                    console.warn('[VOICE HELPER] Failed to delete calendar event during cancellation:', calErr.message || calErr)
                }
            }
        }

        // 3. Update Lead in DB
        const { error: updateError } = await supabaseAdmin
            .from('leads')
            .update({
                booked_time: null,
                meet_link: null,
                google_calendar_event_id: null,
                pipeline_stage: 'Lead', // Reset to standard pipeline stage
                reminder_24h_sent: false,
                reminder_4h_sent: false,
                reminder_1h_sent: false,
                reminder_15m_sent: false
            })
            .eq('id', leadId)

        if (updateError) throw updateError

        // 4. Log history
        try {
            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                action: 'Booking Cancelled',
                description: 'Appointment cancelled manually or by client. Booking time cleared.'
            })
        } catch (histErr) {
            console.error('[VOICE HELPER] Failed to log lead history for cancellation:', histErr)
        }

        return { success: true }
    } catch (e: any) {
        console.error('[VOICE HELPER] cancelAppointment Exception:', e)
        return { success: false, error: e.message || 'Internal error' }
    }
}

