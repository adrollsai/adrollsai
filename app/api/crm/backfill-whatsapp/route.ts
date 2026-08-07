import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const { impersonateId } = body

    const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single()
    let targetUserId = user.id

    if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
        targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string
    }

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
        targetUserId = impersonateId
    }

    // 1. Fetch all WhatsApp leads for target account
    const { data: waLeads } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', targetUserId)
        .or('source.ilike.%whatsapp%,source.ilike.%wa%');

    // 2. Fetch whatsapp chats for target account
    const { data: waChats } = await supabase
        .from('whatsapp_chats')
        .select('*')
        .eq('user_id', targetUserId);

    // 3. Fetch user inventory properties
    const { data: userProps } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', targetUserId);

    let updatedCount = 0;

    if (waLeads && waLeads.length > 0) {
        for (const lead of waLeads) {
            const leadPhoneDigits = lead.phone ? lead.phone.replace(/\D/g, '').slice(-10) : '';
            const matchingChat = waChats?.find(c => {
                const cPhoneDigits = c.phone_number ? c.phone_number.replace(/\D/g, '').slice(-10) : '';
                return c.lead_id === lead.id || (leadPhoneDigits && cPhoneDigits && leadPhoneDigits === cPhoneDigits);
            });

            let cf = lead.custom_fields || {};
            if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }

            let origin = cf?.meta_ad_origin || matchingChat?.flow_answers?.meta_ad_origin;

            // If no origin yet, match property by title or user's properties
            if (!origin && userProps && userProps.length > 0) {
                const searchStr = `${lead.name || ''} ${lead.ad_name || ''} ${JSON.stringify(cf)}`.toLowerCase();
                const matchedProp = userProps.find(p => p.title && searchStr.includes(p.title.toLowerCase().trim())) || userProps[0];
                if (matchedProp) {
                    origin = {
                        ad_name: `${matchedProp.title} Meta Campaign`,
                        campaign_name: 'WhatsApp CTWA Ad',
                        headline: matchedProp.title,
                        product_name: matchedProp.title,
                        product_id: matchedProp.id,
                        image_url: matchedProp.image_url,
                        video_url: matchedProp.video_url,
                        source_url: 'https://www.facebook.com/ads/library/'
                    };
                }
            }

            if (origin) {
                cf = { ...cf, meta_ad_origin: origin };
                const adName = origin.ad_name || origin.headline || origin.product_name;

                await supabase
                    .from('leads')
                    .update({
                        source: 'WhatsApp Ad',
                        ad_name: adName || lead.ad_name || 'WhatsApp CTWA Ad',
                        property_id: lead.property_id || origin.product_id || origin.property_id || null,
                        custom_fields: cf
                    })
                    .eq('id', lead.id);
                updatedCount++;
            }
        }
    }

    // 4. Sync reopened_count from lead_history
    const { data: reopenHistory } = await supabase
        .from('lead_history')
        .select('lead_id')
        .eq('action_type', 'REOPENED');

    if (reopenHistory && reopenHistory.length > 0) {
        const countsMap: Record<string, number> = {};
        reopenHistory.forEach(h => {
            if (h.lead_id) countsMap[h.lead_id] = (countsMap[h.lead_id] || 0) + 1;
        });

        for (const [leadId, cnt] of Object.entries(countsMap)) {
            await supabase
                .from('leads')
                .update({ reopened_count: cnt })
                .eq('id', leadId);
        }
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (err: any) {
    console.error("Backfill WhatsApp leads error:", err)
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 })
  }
}
