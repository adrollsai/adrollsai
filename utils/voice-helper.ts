import { refreshGoogleAccessToken, getCalendarTimezone } from '@/utils/google-calendar'
import { sendCAPIEvent } from '@/utils/external-apis'
import { sendBookingConfirmationEmail } from '@/utils/email-helper'
import { hasEnoughCredits } from '@/utils/credits'
import { triggerVobizOutboundCall } from '@/utils/vobiz-helper'

/**
 * Warms up the Cloud Run Voice Bridge container & pre-warms Gemini session context before Twilio dials.
 */
export async function warmupVoiceBridge(leadId?: string, profileId?: string, campaignId?: string): Promise<void> {
    const bridgeUrl = process.env.GEMINI_VOICE_BRIDGE_URL || 'wss://gemini-voice-bridge-805895515412.us-central1.run.app';
    if (bridgeUrl.startsWith('ws')) {
        const httpBase = bridgeUrl.replace(/^ws/, 'http');
        const healthUrl = httpBase + '/health';
        console.log(`[VOICE HELPER] Warming up Voice Bridge container at: ${healthUrl}`);
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 8000);
            const warmupRes = await fetch(healthUrl, { signal: controller.signal });
            clearTimeout(id);
            if (warmupRes.ok) {
                console.log(`[VOICE HELPER] Voice Bridge container warmed up successfully.`);
            }

            // Trigger session pre-warming if leadId & profileId are provided
            if (leadId && profileId) {
                const prewarmUrl = httpBase + '/prewarm';
                console.log(`[VOICE HELPER] Pre-warming Gemini session at ${prewarmUrl} for lead ${leadId}...`);
                fetch(prewarmUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ leadId, profileId, campaignId })
                }).catch(pErr => console.warn('[VOICE HELPER] Prewarm request error:', pErr.message));
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
    isAutoTrigger = false,
    campaignId?: string
): Promise<{ success: boolean; error?: string; callSid?: string; scheduled?: boolean; scheduledTime?: Date }> {
    try {
        // 1. Fetch credentials from user profile & lead details in parallel
        const [profResult, leadResult] = await Promise.all([
            supabaseAdmin
                .from('profiles')
                .select('elevenlabs_api_key, elevenlabs_agent_id, voice_twilio_sid, voice_twilio_token, voice_twilio_number, google_refresh_token, google_booking_enabled, subscription_status, subscription_valid_until, email')
                .eq('id', profileId)
                .single(),
            supabaseAdmin
                .from('leads')
                .select('id, user_id, name, phone, custom_fields')
                .eq('id', leadId)
                .single()
        ])

        let profile = profResult.data
        const lead = leadResult.data

        if (leadResult.error || !lead || !lead.phone) {
            return { success: false, error: 'Lead not found or has no phone number.' }
        }

        const effectiveProfileId = lead.user_id || profileId
        if (effectiveProfileId !== profileId) {
            const { data: ownerProfile } = await supabaseAdmin
                .from('profiles')
                .select('elevenlabs_api_key, elevenlabs_agent_id, voice_twilio_sid, voice_twilio_token, voice_twilio_number, google_refresh_token, google_booking_enabled, subscription_status, subscription_valid_until, email')
                .eq('id', effectiveProfileId)
                .maybeSingle()
            if (ownerProfile) {
                profile = ownerProfile
            }
        }

        if (!profile) {
            return { success: false, error: 'Failed to fetch user voice configuration.' }
        }

        // Subscription Validation Check
        const subscriptionStatus = profile.subscription_status?.toLowerCase() || ''
        const subscriptionValidUntil = profile.subscription_valid_until
        const userEmail = profile.email?.toLowerCase() || ''
        const whitelistedEmails = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com']
        const isWhitelisted = whitelistedEmails.includes(userEmail)

        const isSubscriptionExpired = subscriptionValidUntil && new Date(subscriptionValidUntil) < new Date()
        const isPaid = (subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'pro') && !isSubscriptionExpired

        if (!isPaid && !isWhitelisted) {
            return { success: false, error: 'SUBSCRIPTION_EXPIRED' }
        }

        // Concurrency Check: Limit active calls according to account capacity (default 1 concurrent call per user)
        const maxConcurrent = profile.voice_concurrency_limit || 1
        const { data: activeLeads } = await supabaseAdmin
            .from('leads')
            .select('id, last_called_at, voice_call_scheduled_at, created_at')
            .eq('user_id', profileId)
            .eq('voice_call_status', 'calling');

        const nowTs = Date.now();
        const activeCalls: any[] = [];

        for (const c of (activeLeads || [])) {
            const updatedAtTime = new Date(c.last_called_at || c.voice_call_scheduled_at || c.created_at || 0).getTime();
            const elapsed = nowTs - updatedAtTime;
            if (updatedAtTime > 0 && elapsed >= 7 * 60 * 1000) {
                console.warn(`[VOICE HELPER] Auto-recovering stale call stuck in calling status for lead ${c.id}`);
                await supabaseAdmin
                    .from('leads')
                    .update({ voice_call_status: 'no_answer' })
                    .eq('id', c.id);
            } else {
                activeCalls.push(c);
            }
        }

        if (activeCalls.length >= maxConcurrent && !activeCalls.some(c => c.id === leadId)) {
            console.warn(`[VOICE HELPER] Max concurrency limit (${maxConcurrent}) reached for user ${profileId}. Queuing call for lead ${leadId}.`);
            // Automatically queue this lead so dispatchNextCall dials them as soon as the line frees up
            await supabaseAdmin
                .from('leads')
                .update({ 
                    voice_call_status: 'queued',
                    voice_call_scheduled_at: new Date().toISOString()
                })
                .eq('id', leadId);

            return { 
                success: true, 
                scheduled: true, 
                scheduledTime: new Date() 
            };
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

            // Check if explicitly allowed after hours (asked on whatsapp or call)
            let allowAfterHours = false
            if (lead && lead.custom_fields) {
                try {
                    const customFields = typeof lead.custom_fields === 'string'
                        ? JSON.parse(lead.custom_fields)
                        : lead.custom_fields
                    allowAfterHours = !!customFields?.allow_after_hours
                } catch (e) {
                    console.warn('[VOICE HELPER] Failed to parse custom_fields for allow_after_hours:', e)
                }
            }

            if (!isWithinWindow && !allowAfterHours) {
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

        const telephonyProvider = profile.voice_telephony_provider || 'vobiz'

        // If telephony provider is Vobiz (default)
        if (telephonyProvider === 'vobiz') {
            const vobizRes = await triggerVobizOutboundCall(supabaseAdmin, {
                leadId: lead.id,
                profileId: effectiveProfileId,
                toPhone: lead.phone,
                campaignId
            })
            return {
                success: vobizRes.success,
                callSid: vobizRes.callUuid,
                error: vobizRes.error,
                scheduled: vobizRes.scheduled,
                scheduledTime: vobizRes.scheduledTime
            }
        }

        const twilioSid = profile.voice_twilio_sid || process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID
        const twilioToken = profile.voice_twilio_token || process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN
        
        const isMasterDefaultUser = profile.email === 'rchopra489@gmail.com' || profile.email === 'infobluesquareinfra@gmail.com'
        const voiceNumber = profile.voice_twilio_number || (isMasterDefaultUser ? process.env.MASTER_TWILIO_NUMBER : null)

        if (!twilioSid || !twilioToken || !voiceNumber) {
            return { success: false, error: 'Voice calling credentials or phone number are not configured. Please provision a phone number in Voice settings.' }
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

        // Warm up the Cloud Run voice bridge container & pre-warm session before placing the call
        await warmupVoiceBridge(lead.id, profileId, campaignId);


        console.log(`[VOICE HELPER] Dialing lead ${lead.name} (${cleanPhone}) from caller ID ${voiceNumber}...`)

        // 4. Update status to calling & clear stale call data
        await supabaseAdmin
            .from('leads')
            .update({ 
                voice_call_status: 'calling',
                voice_call_summary: null,
                voice_call_transcript: null,
                voice_recording_url: null
            })
            .eq('id', lead.id)

        // 5. Call Twilio REST API
        let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
        if (appUrl.includes('localhost') || appUrl.includes('local.nobogent.com')) {
            appUrl = 'https://app.nobogent.com'
        }
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`
        const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')

        const params = new URLSearchParams()
        params.append('Url', `${appUrl}/api/voice/twiml?leadId=${lead.id}&profileId=${effectiveProfileId}${campaignId ? `&campaignId=${campaignId}` : ''}`)
        params.append('To', cleanPhone)
        params.append('From', voiceNumber.trim())
        params.append('StatusCallback', `${appUrl}/api/voice/status-callback?leadId=${lead.id}`)
        params.append('TimeLimit', '300') // Set hard limit of 5 minutes (300 seconds) for the call
        params.append('Record', 'true') // Ensure outbound call recording is enabled

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
    profileId: string,
    bypassHoursCheck = false
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
            .select('google_refresh_token, google_booking_enabled, google_booking_duration, google_booking_hours, business_name, google_calendar_id, facebook_token, selected_page_token, pixel_id, whatsapp_access_token, whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_personal_number, avatar_url, full_name')
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

        if (!bypassHoursCheck && (slotStartFormatted < bookingHours.start || slotEndFormatted > bookingHours.end)) {
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
                    .select('id, name, phone, booked_time')
                    .eq('user_id', profileId)
                    .not('booked_time', 'is', null)
                    .neq('id', leadId)
                
                if (dbErr) throw dbErr

                if (overlappingLeads && overlappingLeads.length > 0) {
                    const currentLeadDigits = lead?.phone ? lead.phone.replace(/\D/g, '').slice(-10) : ''
                    for (const otherLead of overlappingLeads) {
                        const otherDigits = otherLead.phone ? otherLead.phone.replace(/\D/g, '').slice(-10) : ''
                        
                        // If it's the same lead/phone number rebooking, ignore conflict
                        if (currentLeadDigits && otherDigits && currentLeadDigits === otherDigits) {
                            continue
                        }

                        const otherStart = new Date(otherLead.booked_time)
                        const otherEnd = new Date(otherStart.getTime() + (duration * 60000))
                        if (
                            (start >= otherStart && start < otherEnd) ||
                            (end > otherStart && end <= otherEnd) ||
                            (start <= otherStart && end >= otherEnd)
                        ) {
                            if (!bypassHoursCheck) {
                                isSlotAvailable = false
                                console.warn(`[VOICE HELPER] DB fallback slot taken. Overlaps with lead: ${otherLead.name} (${otherLead.booked_time})`)
                                break
                            }
                        }
                    }
                }
            } catch (dbCheckErr: any) {
                console.error('[VOICE HELPER] DB availability check failed:', dbCheckErr.message)
            }
        }

        if (!isSlotAvailable && !bypassHoursCheck) {
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
                status: 'Appointment Booked',
                pipeline_stage: 'Appointment Booked',
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

        // Recalculate and persist boosted Lead Score for booked appointment
        try {
            const { updateLeadScoreInDB } = await import('./lead-scoring')
            await updateLeadScoreInDB(supabaseAdmin, leadId)
        } catch (sErr) {
            console.error('[VOICE HELPER] Lead score update on booking failed:', sErr)
        }

        // Trigger multi-channel alert to admin (Push, Free-form WhatsApp, Email)
        try {
            const { sendAdminMultiChannelNotification } = await import('./notification-helper')
            const formattedSlotDate = new Date(formattedSlot).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })
            await sendAdminMultiChannelNotification({
                ownerUserId: lead.user_id,
                title: '🎙️ Meeting Booked via AI Call!',
                body: `AI Voice Agent successfully booked a meeting with ${lead.name} (${lead.phone || 'No Phone'}) for ${formattedSlotDate}.${hangoutLink ? `\nMeet Link: ${hangoutLink}` : ''}`,
                url: `/dashboard/crm/${leadId}`,
                type: 'meeting_booked'
            })
        } catch (notifErr: any) {
            console.error('[VOICE HELPER] Failed to send multi-channel admin alert:', notifErr)
        }


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

        // 6b. WhatsApp Notifications (Double booking confirmation)
        try {
            // Resolve host name and avatar (assigned team member or admin owner)
            let hostName = profile?.full_name || profile?.business_name || 'Team Member'
            let hostAvatar = profile?.avatar_url || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg'
            if (hostAvatar.includes('/api/fetch-image?url=')) {
                try { hostAvatar = decodeURIComponent(hostAvatar.split('/api/fetch-image?url=')[1]); } catch (e) {}
            }
            if (!hostAvatar.startsWith('http')) {
                hostAvatar = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg'
            }

            if (lead?.assigned_to) {
                const { data: assignedProfile } = await supabaseAdmin
                    .from('profiles')
                    .select('full_name, business_name, avatar_url')
                    .eq('id', lead.assigned_to)
                    .maybeSingle()

                if (assignedProfile) {
                    hostName = assignedProfile.full_name || assignedProfile.business_name || hostName
                    hostAvatar = assignedProfile.avatar_url || hostAvatar
                }
            }

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

            const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN
            const phoneId = profile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || process.env.DEV_WHATSAPP_PHONE_NUMBER_ID
            
            // Normalize prospect phone
            let cleanLeadPhone = lead?.phone ? lead.phone.replace(/\D/g, '') : ''
            if (cleanLeadPhone.length === 10) {
                cleanLeadPhone = '91' + cleanLeadPhone
            }

            // Normalize admin personal phone
            const adminPhone = profile?.whatsapp_personal_number
            let cleanAdminPhone = adminPhone ? adminPhone.replace(/\D/g, '') : ''
            if (cleanAdminPhone.length === 10) {
                cleanAdminPhone = '91' + cleanAdminPhone
            }

            if (phoneId && whatsappToken) {
                // 1. Prospect message: Free-form Priority 1, Template Priority 2 Fallback
                if (cleanLeadPhone) {
                    console.log(`[VOICE HELPER] Sending WhatsApp booking confirmation to prospect: ${cleanLeadPhone}`)
                    let confirmationDelivered = false

                    // Priority 1: Free-Form Text Message (high conversion, instant delivery)
                    const freeFormText = `Hello ${lead.name || 'Valued Lead'}! 🎉\n\nYour meeting has been successfully confirmed!\n\n📅 Date & Time: ${formattedDate}\n👤 Host: ${hostName}\n🏢 Business: ${profile?.business_name || 'Consultation'}${hangoutLink ? `\n🔗 Google Meet: ${hangoutLink}` : ''}\n\nThank you, and we look forward to connecting with you!`

                    const freeFormPayload = {
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: cleanLeadPhone,
                        type: 'text',
                        text: { body: freeFormText }
                    }

                    try {
                        console.log(`[VOICE HELPER] Priority 1: Sending Free-Form WhatsApp text confirmation to ${cleanLeadPhone}`)
                        const freeFormRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${whatsappToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(freeFormPayload)
                        })
                        const freeFormData = await freeFormRes.json()

                        if (freeFormRes.ok && freeFormData.messages?.[0]?.id) {
                            confirmationDelivered = true
                            console.log(`[VOICE HELPER] Free-Form WhatsApp confirmation delivered to ${cleanLeadPhone}. Message ID: ${freeFormData.messages[0].id}`)
                            
                            // Helper to ensure message appears in WhatsApp Inbox tab
                            let { data: chat } = await supabaseAdmin
                                .from('whatsapp_chats')
                                .select('id')
                                .eq('user_id', profileId)
                                .eq('recipient_phone', cleanLeadPhone)
                                .maybeSingle()

                            if (!chat) {
                                const { data: newChat } = await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .insert({
                                        user_id: profileId,
                                        lead_id: leadId,
                                        recipient_name: lead.name || 'Valued Prospect',
                                        recipient_phone: cleanLeadPhone,
                                        last_message_text: freeFormText,
                                        unread_count: 0,
                                        updated_at: new Date().toISOString()
                                    })
                                    .select('id')
                                    .single()
                                chat = newChat
                            } else {
                                await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .update({
                                        lead_id: leadId,
                                        last_message_text: freeFormText,
                                        updated_at: new Date().toISOString()
                                    })
                                    .eq('id', chat.id)
                            }

                            if (chat?.id) {
                                await supabaseAdmin.from('whatsapp_messages').insert({
                                    chat_id: chat.id,
                                    direction: 'outbound',
                                    message_text: freeFormText,
                                    created_at: new Date().toISOString()
                                }).catch(() => {})
                            }
                        } else {
                            console.warn('[VOICE HELPER] Free-form WhatsApp send failed (likely outside 24h window), falling back to template message:', freeFormData.error)
                        }
                    } catch (freeFormErr: any) {
                        console.warn('[VOICE HELPER] Exception in Priority 1 Free-Form send:', freeFormErr.message)
                    }

                    // Priority 2: Generic Text-Only Template Fallback (no image requirement, 100% reliable)
                    if (!confirmationDelivered) {
                        console.log(`[VOICE HELPER] Priority 2: Sending Generic WhatsApp Template confirmation (booking_confirmation_generic) to ${cleanLeadPhone}`)
                        const genericPayload = {
                            messaging_product: 'whatsapp',
                            recipient_type: 'individual',
                            to: cleanLeadPhone,
                            type: 'template',
                            template: {
                                name: 'booking_confirmation_generic',
                                language: { code: 'en_US' },
                                components: [
                                    {
                                        type: 'body',
                                        parameters: [
                                            { type: 'text', text: lead.name || 'Valued Prospect' },
                                            { type: 'text', text: formattedDate },
                                            { type: 'text', text: hostName },
                                            { type: 'text', text: profile?.business_name || 'Consultation' }
                                        ]
                                    }
                                ]
                            }
                        }

                        try {
                            const genRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${whatsappToken}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(genericPayload)
                            })
                            const genData = await genRes.json()
                            if (genRes.ok && genData.messages?.[0]?.id) {
                                confirmationDelivered = true
                                console.log(`[VOICE HELPER] Generic WhatsApp template confirmation delivered to ${cleanLeadPhone}. Message ID: ${genData.messages[0].id}`)
                                await supabaseAdmin.from('whatsapp_messages').insert({
                                    user_id: profileId,
                                    lead_id: leadId,
                                    direction: 'outbound',
                                    message_type: 'template',
                                    body: `💬 WhatsApp Template (Generic): Booking confirmed for ${formattedDate}`,
                                    status: 'sent',
                                    message_id: genData.messages[0].id,
                                    created_at: new Date().toISOString()
                                }).catch(() => {})
                            } else {
                                console.warn('[VOICE HELPER] Generic template send failed, trying image-header template fallback:', genData.error)
                            }
                        } catch (genErr: any) {
                            console.warn('[VOICE HELPER] Exception in Generic Template send:', genErr.message)
                        }
                    }

                    // Priority 3: Image-Header Template Fallback (booking_confirmation_prospect)
                    if (!confirmationDelivered) {
                        console.log(`[VOICE HELPER] Priority 3: Sending WhatsApp Template confirmation (booking_confirmation_prospect) to ${cleanLeadPhone}`)
                        const prospectPayload = {
                            messaging_product: 'whatsapp',
                            recipient_type: 'individual',
                            to: cleanLeadPhone,
                            type: 'template',
                            template: {
                                name: 'booking_confirmation_prospect',
                                language: {
                                    code: 'en_US'
                                },
                                components: [
                                    {
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'image',
                                                image: {
                                                    link: hostAvatar
                                                }
                                            }
                                        ]
                                    },
                                    {
                                        type: 'body',
                                        parameters: [
                                            {
                                                type: 'text',
                                                text: lead.name || 'Prospect'
                                            },
                                            {
                                                type: 'text',
                                                text: formattedDate
                                            },
                                            {
                                                type: 'text',
                                                text: hostName
                                            },
                                            {
                                                type: 'text',
                                                text: profile?.business_name || 'Consultation'
                                            }
                                        ]
                                    }
                                ]
                            }
                        }

                        try {
                            const waRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${whatsappToken}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(prospectPayload)
                            })
                            const waData = await waRes.json()
                            if (waData.error) {
                                console.error('[VOICE HELPER] WhatsApp Prospect Template Confirmation Error:', waData.error)
                            } else {
                                console.log(`[VOICE HELPER] Prospect WhatsApp template confirmation sent successfully. Message ID: ${waData.messages?.[0]?.id}`)
                                await supabaseAdmin.from('whatsapp_messages').insert({
                                    user_id: profileId,
                                    lead_id: leadId,
                                    direction: 'outbound',
                                    message_type: 'template',
                                    body: `💬 WhatsApp Template: Booking confirmed for ${formattedDate}`,
                                    status: 'sent',
                                    message_id: waData.messages?.[0]?.id,
                                    created_at: new Date().toISOString()
                                }).catch(() => {})
                            }
                        } catch (tmplErr: any) {
                            console.error('[VOICE HELPER] Exception in Priority 3 Template send:', tmplErr)
                        }
                    }
                }

                // 2. Admin message template
                if (cleanAdminPhone) {
                    console.log(`[VOICE HELPER] Sending WhatsApp booking notification to admin: ${cleanAdminPhone}`)
                    const adminPayload = {
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: cleanAdminPhone,
                        type: 'template',
                        template: {
                            name: 'booking_notification_admin',
                            language: {
                                code: 'en_US'
                            },
                            components: [
                                {
                                    type: 'body',
                                    parameters: [
                                        {
                                            type: 'text',
                                            text: lead.name || 'Prospect'
                                        },
                                        {
                                            type: 'text',
                                            text: formattedDate
                                        },
                                        {
                                            type: 'text',
                                            text: hostName
                                        },
                                        {
                                            type: 'text',
                                            text: lead.phone || 'N/A'
                                        },
                                        {
                                            type: 'text',
                                            text: leadEmail || 'N/A'
                                        }
                                    ]
                                }
                            ]
                        }
                    }

                    const waAdminRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${whatsappToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(adminPayload)
                    })
                    const waAdminData = await waAdminRes.json()
                    if (waAdminData.error) {
                        console.error('[VOICE HELPER] WhatsApp Admin Notification Error:', waAdminData.error)
                    } else {
                        console.log(`[VOICE HELPER] Admin WhatsApp notification sent successfully. Message ID: ${waAdminData.messages?.[0]?.id}`)
                    }
                }
            } else {
                console.warn('[VOICE HELPER] WhatsApp credentials not configured. Skipping confirmations.')
            }
        } catch (waErr: any) {
            console.error('[VOICE HELPER] WhatsApp double-send exception:', waErr.message || waErr)
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

/**
 * Automatically dispatches the next call in sequence for a user's phone line.
 * Prioritizes scheduled calls over campaign calls.
 * Ensures only one call is active at any time.
 */
export async function dispatchNextCall(supabaseAdmin: any, userId: string): Promise<any> {
    console.log(`[CALL DISPATCHER] Dispatching next call for user ${userId}...`);

    // 1. Check if there is already an active call in progress for this user (respecting voice_concurrency_limit)
    const { data: userProfile } = await supabaseAdmin
        .from('profiles')
        .select('voice_concurrency_limit')
        .eq('id', userId)
        .single()
    const maxConcurrent = userProfile?.voice_concurrency_limit || 1

    const { data: activeLeads } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('user_id', userId)
        .eq('voice_call_status', 'calling');

    if (activeLeads && activeLeads.length >= maxConcurrent) {
        console.log(`[CALL DISPATCHER] Call deferred: User ${userId} has reached max concurrent channels (${activeLeads.length}/${maxConcurrent}).`);
        return { deferred: true, activeLeadId: activeLeads[0].id };
    }

    // Loop to dial the next available lead. If one fails to trigger (e.g. invalid phone/credits), 
    // it loops to the next immediately to prevent the bulk campaign from getting stuck.
    while (true) {
        // 2. Priority 1: Check for scheduled calls whose reminder time has come
        const nowUtc = new Date().toISOString();
        const { data: scheduledLeads } = await supabaseAdmin
            .from('leads')
            .select('id, name')
            .eq('user_id', userId)
            .not('voice_call_scheduled_at', 'is', null)
            .lte('voice_call_scheduled_at', nowUtc)
            .neq('voice_call_status', 'calling')
            .neq('voice_call_status', 'failed')
            .neq('calling_enabled', false)
            .not('pipeline_stage', 'in', '("Won", "Appointment booked")')
            .order('voice_call_scheduled_at', { ascending: true })
            .limit(1);

        if (scheduledLeads && scheduledLeads.length > 0) {
            const targetLead = scheduledLeads[0];
            console.log(`[CALL DISPATCHER] Prioritizing scheduled call for lead: ${targetLead.name} (ID: ${targetLead.id})`);
            
            // Clear scheduled time first to prevent double-calls
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_scheduled_at: null })
                .eq('id', targetLead.id);

            const callRes = await triggerOutboundCall(supabaseAdmin, targetLead.id, userId, true);
            if (callRes.success) {
                return { dispatched: true, type: 'scheduled', leadId: targetLead.id, success: true };
            }
            console.log(`[CALL DISPATCHER] Scheduled call failed to initiate for ${targetLead.name}. Retrying next in loop...`);
            continue;
        }

        // 3. Check for campaign calls
        // Find any voice campaigns for this user that are currently 'running'
        const { data: runningCampaigns } = await supabaseAdmin
            .from('voice_campaigns')
            .select('id, name')
            .eq('user_id', userId)
            .eq('status', 'running')
            .limit(1);

        if (runningCampaigns && runningCampaigns.length > 0) {
            const activeCampaign = runningCampaigns[0];
            console.log(`[CALL DISPATCHER] Active campaign found: ${activeCampaign.name} (ID: ${activeCampaign.id})`);

            // Find the next lead in this campaign that needs to be called (fresh or due retries)
            const nowUtc = new Date().toISOString();
            const { data: campaignLeads } = await supabaseAdmin
                .from('leads')
                .select('id, name')
                .eq('user_id', userId)
                .eq('voice_campaign_id', activeCampaign.id)
                .or(`voice_call_status.is.null,voice_call_status.eq.not_called,and(voice_call_status.eq.scheduled_retry,voice_call_scheduled_at.lte.${nowUtc})`)
                .order('created_at', { ascending: false })
                .limit(1);

            if (campaignLeads && campaignLeads.length > 0) {
                const nextLead = campaignLeads[0];
                console.log(`[CALL DISPATCHER] Dialing campaign lead: ${nextLead.name} (ID: ${nextLead.id})`);
                const callRes = await triggerOutboundCall(supabaseAdmin, nextLead.id, userId, false, activeCampaign.id);
                if (callRes.success) {
                    return { dispatched: true, type: 'campaign', leadId: nextLead.id, success: true };
                }
                console.log(`[CALL DISPATCHER] Campaign call failed to initiate for ${nextLead.name}. Retrying next in loop...`);
                continue;
            } else {
                // Check if any leads in this campaign are still pending future retries, callbacks, or active calling
                const { data: pendingLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('voice_campaign_id', activeCampaign.id)
                    .in('voice_call_status', ['scheduled_retry', 'scheduled_callback', 'calling'])
                    .limit(1);

                if (!pendingLeads || pendingLeads.length === 0) {
                    console.log(`[CALL DISPATCHER] Campaign ${activeCampaign.name} completed all calls and retries.`);
                    await supabaseAdmin
                        .from('voice_campaigns')
                        .update({ status: 'completed' })
                        .eq('id', activeCampaign.id);
                } else {
                    console.log(`[CALL DISPATCHER] Campaign ${activeCampaign.name} waiting for scheduled retries/callbacks.`);
                }
            }
        }

        break;
    }

    console.log(`[CALL DISPATCHER] No calls to dispatch at this time.`);
    return { dispatched: false };
}

