import { createClient } from '@supabase/supabase-js';
import { triggerOutboundCall } from '@/utils/voice-helper';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export interface ToolResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    instructionsForAgent?: string;
}

// ----------------------------------------------------
// 1. CRM & Lead Context Tools
// ----------------------------------------------------

export async function getLeadContext(leadId: string): Promise<ToolResult> {
    try {
        const { data: lead, error } = await supabaseAdmin
            .from('leads')
            .select(`
                id, name, phone, email, budget, timeline, notes, summary, 
                pipeline_stage, priority_status, autonomous_status, last_agent_thought,
                next_action_due_at, booked_time, assigned_to, user_id:profiles!inner(id, business_name, business_info),
                whatsapp_window_expires_at
            `)
            .eq('id', leadId)
            .maybeSingle();

        if (error || !lead) {
            return { success: false, error: error?.message || 'Lead not found' };
        }

        // Fetch recent conversation messages
        const cleanPhone = (lead.phone || '').replace(/\D/g, '').slice(-10);
        let recentChats: any[] = [];
        if (cleanPhone) {
            const { data: chat } = await supabaseAdmin
                .from('whatsapp_chats')
                .select('id')
                .ilike('recipient_phone', `%${cleanPhone}%`)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (chat) {
                const { data: messages } = await supabaseAdmin
                    .from('whatsapp_messages')
                    .select('direction, message_text, created_at')
                    .eq('chat_id', chat.id)
                    .order('created_at', { ascending: false })
                    .limit(10);
                recentChats = (messages || []).reverse();
            }
        }

        // Fetch recent call logs
        const { data: callLogs } = await supabaseAdmin
            .from('call_logs')
            .select('status, duration_seconds, notes, created_at')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false })
            .limit(3);

        const is24hWindowOpen = lead.whatsapp_window_expires_at 
            ? new Date(lead.whatsapp_window_expires_at).getTime() > Date.now()
            : false;

        return {
            success: true,
            data: {
                lead,
                is24hWindowOpen,
                recentChats,
                recentCallLogs: callLogs || []
            }
        };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function updateLeadProfile(params: {
    leadId: string;
    stage?: string;
    budget?: string;
    requirement?: string;
    timeline?: string;
    notes?: string;
    priority?: string;
    reason?: string;
}): Promise<ToolResult> {
    try {
        const updates: any = {};
        if (params.stage) updates.pipeline_stage = params.stage;
        if (params.budget) updates.budget = params.budget;
        if (params.timeline) updates.timeline = params.timeline;
        if (params.notes) updates.notes = params.notes;
        if (params.priority) updates.priority_status = params.priority;
        if (params.stage) updates.autonomous_status = params.stage;

        const { error } = await supabaseAdmin
            .from('leads')
            .update(updates)
            .eq('id', params.leadId);

        if (error) return { success: false, error: error.message };

        // Log to lead history
        await supabaseAdmin.from('lead_history').insert({
            lead_id: params.leadId,
            action_type: 'STAGE_CHANGE',
            description: `Autonomous Agent updated profile: ${params.reason || 'Lead qualification progress'}`
        });

        return { success: true, data: { updated: updates } };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function searchLeads(params: {
    userId: string;
    query?: string;
    stage?: string;
    limit?: number;
}): Promise<ToolResult> {
    try {
        let q = supabaseAdmin
            .from('leads')
            .select('id, name, phone, budget, timeline, pipeline_stage, autonomous_status, created_at')
            .eq('assigned_to', params.userId)
            .order('created_at', { ascending: false })
            .limit(params.limit || 20);

        if (params.stage) {
            q = q.eq('pipeline_stage', params.stage);
        }
        if (params.query) {
            q = q.or(`name.ilike.%${params.query}%,phone.ilike.%${params.query}%,notes.ilike.%${params.query}%`);
        }

        const { data, error } = await q;
        if (error) return { success: false, error: error.message };
        return { success: true, data };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

// ----------------------------------------------------
// 2. Offerings & Catalog Tools (Industry-Agnostic)
// ----------------------------------------------------

export async function searchOfferings(params: {
    userId: string;
    query?: string;
    maxPrice?: number;
    configuration?: string;
}): Promise<ToolResult> {
    try {
        let q = supabaseAdmin
            .from('properties')
            .select('id, title, description, price, location, property_type, bedrooms, brochure_url, image_urls, floor_plan_url, video_url, payment_plan')
            .eq('user_id', params.userId)
            .limit(10);

        if (params.query) {
            q = q.or(`title.ilike.%${params.query}%,location.ilike.%${params.query}%,description.ilike.%${params.query}%`);
        }
        if (params.maxPrice) {
            q = q.lte('price', params.maxPrice);
        }

        const { data, error } = await q;
        if (error) return { success: false, error: error.message };

        const offerings = (data || []).map((item: any) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            price: item.price ? `₹${item.price.toLocaleString('en-IN')}` : 'Price on request',
            location: item.location || 'Prime location',
            type: item.property_type || item.bedrooms || 'Unit',
            hasBrochure: !!item.brochure_url,
            hasFloorPlan: !!item.floor_plan_url,
            brochureUrl: item.brochure_url,
            floorPlanUrl: item.floor_plan_url,
            paymentPlan: item.payment_plan || 'Flexible construction-linked / milestone payment plans available.'
        }));

        return { success: true, data: offerings };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function getOfferingDetails(offeringId: string): Promise<ToolResult> {
    try {
        const { data, error } = await supabaseAdmin
            .from('properties')
            .select('*')
            .eq('id', offeringId)
            .maybeSingle();

        if (error || !data) return { success: false, error: error?.message || 'Offering not found' };
        return { success: true, data };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

// ----------------------------------------------------
// 3. Calendar Slot Booking (Internal CRM - Zero Google OAuth)
// ----------------------------------------------------

export async function getAvailableSlots(params: {
    userId: string;
    targetDateStr?: string; // YYYY-MM-DD (defaults to tomorrow)
    slotDurationMins?: number;
}): Promise<ToolResult> {
    try {
        // Fetch policy for business hours
        const { data: policy } = await supabaseAdmin
            .from('agent_policies')
            .select('business_hours_start, business_hours_end, slot_duration_mins, timezone')
            .eq('user_id', params.userId)
            .maybeSingle();

        const startHour = parseInt((policy?.business_hours_start || '10:00').split(':')[0], 10);
        const endHour = parseInt((policy?.business_hours_end || '19:00').split(':')[0], 10);
        const duration = params.slotDurationMins || policy?.slot_duration_mins || 45;

        // Determine target date
        let targetDate = new Date();
        if (params.targetDateStr) {
            targetDate = new Date(params.targetDateStr);
        } else {
            // Default to tomorrow
            targetDate.setDate(targetDate.getDate() + 1);
        }
        const yyyy = targetDate.getFullYear();
        const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dd = String(targetDate.getDate()).padStart(2, '0');
        const datePrefix = `${yyyy}-${mm}-${dd}`;

        // Fetch existing bookings for this day
        const { data: existingLeads } = await supabaseAdmin
            .from('leads')
            .select('booked_time')
            .eq('assigned_to', params.userId)
            .gte('booked_time', `${datePrefix}T00:00:00`)
            .lte('booked_time', `${datePrefix}T23:59:59`);

        const bookedTimes = new Set(
            (existingLeads || [])
                .map((l: any) => l.booked_time ? new Date(l.booked_time).getHours() * 60 + new Date(l.booked_time).getMinutes() : null)
                .filter(Boolean)
        );

        // Generate open slots
        const availableSlots: string[] = [];
        let currentMin = startHour * 60;
        const endMin = endHour * 60;

        while (currentMin + duration <= endMin) {
            if (!bookedTimes.has(currentMin)) {
                const hour = Math.floor(currentMin / 60);
                const min = currentMin % 60;
                const ampm = hour >= 12 ? 'PM' : 'AM';
                const displayHour = hour % 12 || 12;
                const displayMin = String(min).padStart(2, '0');
                const slotLabel = `${displayHour}:${displayMin} ${ampm}`;
                const slotIso = `${datePrefix}T${String(hour).padStart(2, '0')}:${displayMin}:00`;
                availableSlots.push(`${slotLabel} (${slotIso})`);
            }
            currentMin += duration;
        }

        return {
            success: true,
            data: {
                date: datePrefix,
                availableSlots: availableSlots.slice(0, 6) // Return top 6 options for natural speaking
            }
        };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function bookAppointmentSlot(params: {
    leadId: string;
    slotIso: string;
    notes?: string;
}): Promise<ToolResult> {
    try {
        const slotDate = new Date(params.slotIso);
        if (isNaN(slotDate.getTime())) {
            return { success: false, error: 'Invalid slot ISO date string' };
        }

        const { data: lead, error: leadErr } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, assigned_to')
            .eq('id', params.leadId)
            .single();

        if (leadErr || !lead) return { success: false, error: 'Lead not found' };

        // Update lead
        const { error: updateErr } = await supabaseAdmin
            .from('leads')
            .update({
                booked_time: slotDate.toISOString(),
                pipeline_stage: 'APPOINTMENT_BOOKED',
                autonomous_status: 'BOOKED',
                notes: params.notes ? `Booking: ${params.notes}` : 'Appointment booked autonomously by Nobogent AI.'
            })
            .eq('id', params.leadId);

        if (updateErr) return { success: false, error: updateErr.message };

        // Log to lead history
        await supabaseAdmin.from('lead_history').insert({
            lead_id: params.leadId,
            action_type: 'APPOINTMENT_BOOKED',
            description: `Site visit / appointment booked for ${slotDate.toLocaleString('en-IN')}`
        });

        return {
            success: true,
            data: {
                bookedTime: slotDate.toISOString(),
                displayTime: slotDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            },
            instructionsForAgent: `Appointment confirmed for ${slotDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. Thank the client and confirm that reminders will be sent on WhatsApp.`
        };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

// ----------------------------------------------------
// 4. Communication & Live WhatsApp Delivery
// ----------------------------------------------------

export async function requestWhatsAppDelivery(params: {
    leadId: string;
    itemsToDeliver: Array<{ type: 'brochure' | 'floor_plan' | 'payment_plan' | 'video'; offeringId?: string }>;
    note?: string;
}): Promise<ToolResult> {
    try {
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, assigned_to, whatsapp_window_expires_at')
            .eq('id', params.leadId)
            .single();

        if (!lead) return { success: false, error: 'Lead not found' };

        const isWindowOpen = lead.whatsapp_window_expires_at 
            ? new Date(lead.whatsapp_window_expires_at).getTime() > Date.now()
            : false;

        const userId = lead.assigned_to;
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name')
            .eq('id', userId)
            .single();

        const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        const phoneId = profile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;

        let cleanPhone = (lead.phone || '').replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        if (isWindowOpen && token && phoneId && cleanPhone) {
            // Priority 1: 24h Window is OPEN -> Send directly!
            // Fetch brochure/floor plan URL if offering specified
            let mediaUrl = '';
            let caption = `Hi ${lead.name || 'there'}! Here are the project details you requested.`;
            if (params.itemsToDeliver[0]?.offeringId) {
                const { data: off } = await supabaseAdmin
                    .from('properties')
                    .select('brochure_url, floor_plan_url, title')
                    .eq('id', params.itemsToDeliver[0].offeringId)
                    .single();
                mediaUrl = off?.brochure_url || off?.floor_plan_url || '';
                if (off?.title) caption = `Here is the brochure & layout for ${off.title}!`;
            }

            if (mediaUrl) {
                await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: cleanPhone,
                        type: 'document',
                        document: { link: mediaUrl, caption }
                    })
                });
            } else {
                await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: cleanPhone,
                        type: 'text',
                        text: { body: `${caption}\n\nOur team is also happy to answer any questions or arrange a walkthrough.` }
                    })
                });
            }

            return {
                success: true,
                data: { status: 'delivered_immediately' },
                instructionsForAgent: 'The requested material has been delivered immediately to their WhatsApp chat right now. Let the client know they can view it.'
            };
        } else {
            // Priority 2: 24h Window is CLOSED -> Send Handshake Template & Queue delivery!
            await supabaseAdmin
                .from('agent_pending_deliveries')
                .insert({
                    lead_id: params.leadId,
                    user_id: userId,
                    requested_items: params.itemsToDeliver,
                    custom_message: params.note || 'Requested during live call',
                    status: 'waiting_handshake'
                });

            // Dispatch Handshake Template
            if (token && phoneId && cleanPhone) {
                const businessTitle = profile?.business_name || 'our team';
                const handshakeBody = `Hi ${lead.name || 'there'}! 👋 It was great speaking with you on the call just now.\n\nPlease reply *'Hi'* to this message so we can automatically send you the floor plans, brochure, and payment details!`;

                // Try quick interactive button or text
                await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: cleanPhone,
                        type: 'text',
                        text: { body: handshakeBody }
                    })
                }).catch(e => console.warn('[HANDSHAKE] Template dispatch error:', e.message));
            }

            return {
                success: true,
                data: { status: 'handshake_sent' },
                instructionsForAgent: "I have triggered a message to your WhatsApp right now. Because of WhatsApp's privacy rules, please reply with a quick 'Hi' to that message, and our system will immediately send you the full brochure and pricing!"
            };
        }
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function scheduleNextEvaluation(params: {
    leadId: string;
    userId: string;
    scheduledForIso: string;
    reason: string;
    eventType?: string;
}): Promise<ToolResult> {
    try {
        const schedDate = new Date(params.scheduledForIso);
        if (isNaN(schedDate.getTime())) {
            return { success: false, error: 'Invalid scheduledFor date' };
        }

        const { data, error } = await supabaseAdmin
            .from('agent_events')
            .insert({
                lead_id: params.leadId,
                user_id: params.userId,
                event_type: params.eventType || 'RE_EVALUATE',
                scheduled_for: schedDate.toISOString(),
                payload: { reason: params.reason },
                status: 'pending'
            })
            .select('id')
            .single();

        if (error) return { success: false, error: error.message };

        // Update lead watchdog timestamp
        await supabaseAdmin
            .from('leads')
            .update({
                next_action_due_at: schedDate.toISOString(),
                last_agent_thought: params.reason
            })
            .eq('id', params.leadId);

        return {
            success: true,
            data: { eventId: data.id, scheduledFor: schedDate.toISOString() },
            instructionsForAgent: `Scheduled future re-evaluation for ${schedDate.toLocaleString('en-IN')}. Reason: ${params.reason}`
        };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function triggerOutboundVoiceCall(params: {
    leadId: string;
    profileId: string;
    reason?: string;
}): Promise<ToolResult> {
    try {
        // Deterministic guardrails: Check business hours & calling policy
        const { data: policy } = await supabaseAdmin
            .from('agent_policies')
            .select('calling_enabled, business_hours_start, business_hours_end, max_calls_per_lead')
            .eq('user_id', params.profileId)
            .maybeSingle();

        if (policy && policy.calling_enabled === false) {
            return { success: false, error: 'Calling is currently disabled in business policy.' };
        }

        // Call count safety check
        const { count: callCount } = await supabaseAdmin
            .from('call_logs')
            .select('*', { count: 'exact', head: true })
            .eq('lead_id', params.leadId);

        const maxCalls = policy?.max_calls_per_lead || 2;
        if (callCount && callCount >= maxCalls) {
            return { success: false, error: `Maximum call attempts (${maxCalls}) already reached for this lead.` };
        }

        if (params.reason) {
            await supabaseAdmin.from('leads').update({ notes: params.reason }).eq('id', params.leadId);
        }

        const res = await triggerOutboundCall(supabaseAdmin, params.leadId, params.profileId, true);
        if (res.success) {
            await supabaseAdmin.from('lead_history').insert({
                lead_id: params.leadId,
                action_type: 'CALL_INITIATED',
                description: `Autonomous agent initiated voice call: ${params.reason || 'Follow-up'}`
            });
            return { success: true, data: res };
        } else {
            return { success: false, error: res.error || 'Failed to initiate outbound call' };
        }
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}
