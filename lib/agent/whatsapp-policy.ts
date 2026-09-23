import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

/**
 * Checks if the 24-hour WhatsApp messaging window is currently active for a lead.
 */
export async function isWhatsAppWindowOpen(leadId: string): Promise<boolean> {
    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('whatsapp_window_expires_at')
        .eq('id', leadId)
        .maybeSingle();

    if (!lead?.whatsapp_window_expires_at) return false;
    return new Date(lead.whatsapp_window_expires_at).getTime() > Date.now();
}

/**
 * Marks the 24-hour WhatsApp window open when an inbound message arrives from a customer.
 */
export async function refreshWhatsAppWindow(leadId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
        .from('leads')
        .update({ whatsapp_window_expires_at: expiresAt })
        .eq('id', leadId);
}

/**
 * Fulfills any pending Call-to-WhatsApp deliveries waiting for a lead handshake.
 * When the lead sends an inbound message (e.g., "Hi" or taps a button), this sends the requested PDF/brochures!
 */
export async function fulfillPendingDeliveriesIfAny(leadId: string): Promise<{ fulfilled: boolean; count: number }> {
    try {
        const { data: pendingList } = await supabaseAdmin
            .from('agent_pending_deliveries')
            .select('*')
            .eq('lead_id', leadId)
            .eq('status', 'waiting_handshake');

        if (!pendingList || pendingList.length === 0) {
            return { fulfilled: false, count: 0 };
        }

        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, assigned_to')
            .eq('id', leadId)
            .single();

        if (!lead) return { fulfilled: false, count: 0 };

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name')
            .eq('id', lead.assigned_to)
            .single();

        const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        const phoneId = profile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;

        let cleanPhone = (lead.phone || '').replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        if (!token || !phoneId || !cleanPhone) return { fulfilled: false, count: 0 };

        for (const item of pendingList) {
            const requested = item.requested_items || [];
            for (const req of requested) {
                let mediaUrl = '';
                let title = 'Project Details';
                if (req.offeringId) {
                    const { data: off } = await supabaseAdmin
                        .from('properties')
                        .select('title, brochure_url, floor_plan_url')
                        .eq('id', req.offeringId)
                        .maybeSingle();
                    if (off) {
                        title = off.title;
                        mediaUrl = req.type === 'floor_plan' ? (off.floor_plan_url || off.brochure_url) : (off.brochure_url || off.floor_plan_url);
                    }
                }

                if (mediaUrl) {
                    await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messaging_product: 'whatsapp',
                            to: cleanPhone,
                            type: 'document',
                            document: {
                                link: mediaUrl,
                                caption: `📄 Here is the requested ${req.type?.replace('_', ' ') || 'brochure'} for ${title}.`
                            }
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
                            text: { body: `Here are the details for ${title} you requested on our recent call. Feel free to ask any questions here anytime!` }
                        })
                    });
                }
            }

            // Mark delivery completed
            await supabaseAdmin
                .from('agent_pending_deliveries')
                .update({ status: 'delivered', delivered_at: new Date().toISOString() })
                .eq('id', item.id);

            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                action_type: 'REMARK',
                description: `🤝 Call-to-WhatsApp Handshake unlocked! Dispatched ${requested.length} requested materials.`
            });
        }

        return { fulfilled: true, count: pendingList.length };
    } catch (err: any) {
        console.error('[WHATSAPP POLICY] Error fulfilling pending deliveries:', err);
        return { fulfilled: false, count: 0 };
    }
}
