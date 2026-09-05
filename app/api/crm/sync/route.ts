import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchFacebookLeads } from '@/utils/external-apis'
import { logToFile } from '@/utils/logger'
import { matchesCampaignRule } from '@/utils/campaign-matcher'
import { ensureMetaPageSubscribed } from '@/utils/meta-subscription'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    logToFile("--- CRM SYNC START ---");
    // Read body for specific form ID
    const body = await request.json().catch(() => ({}))
    const { formId } = body // Optional

    // Resolve Target User ID
    const url = new URL(request.url);
    const impersonateId = url.searchParams.get('impersonate');
    const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
    let targetUserId = user.id;

    if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
        targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
    }

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
        if (ownProfile?.role !== 'super_admin') {
            const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single();
            if (subAccount) targetUserId = impersonateId;
            else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
        } else {
            targetUserId = impersonateId;
        }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_page_token, selected_page_id, facebook_token, enable_distribution, agency_id, parent_id')
      .eq('id', targetUserId)
      .single()

    if (!profile?.selected_page_token || !profile?.selected_page_id) {
        return NextResponse.json({ error: 'Target account has no Page connected' }, { status: 400 })
    }

    // Auto-heal Meta Page webhook subscription in background during sync
    ensureMetaPageSubscribed(supabase, {
      id: targetUserId,
      selected_page_id: profile.selected_page_id,
      selected_page_token: profile.selected_page_token,
      facebook_token: profile.facebook_token
    }).catch(() => {});

    // Pass formId to the helper
    const leads = await fetchFacebookLeads(
        profile.selected_page_token, 
        profile.selected_page_id,
        formId
    );
    console.log(`Retrieved ${leads.length} leads from Meta API`);

    // 1. Identify existing leads by facebook_lead_id and phone numbers
    const existingFbidMap = new Map<string, any>();
    const existingPhoneMap = new Map<string, any>();
    let offset = 0;
    while (true) {
        const { data: existingPage, error: pageErr } = await supabase
            .from('leads')
            .select('id, user_id, facebook_lead_id, phone, name, email, pipeline_stage, custom_fields')
            .eq('user_id', targetUserId)
            .range(offset, offset + 999);

        if (pageErr || !existingPage || existingPage.length === 0) break;
        existingPage.forEach(l => { 
            if (l.facebook_lead_id) existingFbidMap.set(l.facebook_lead_id, l);
            if (l.phone) {
                const digits = l.phone.replace(/\D/g, '').slice(-10);
                if (digits.length >= 7) existingPhoneMap.set(digits, l);
            }
        });
        if (existingPage.length < 1000) break;
        offset += 1000;
    }

    const trulyNewLeads: any[] = [];
    const duplicateLeadsToReopen: any[] = [];
    const processedFbIds = new Set<string>();

    leads.forEach(l => {
        if (!l) return;

        // 1. If this exact Facebook lead submission ID was already imported or processed in this batch, SKIP IT completely.
        if (l.facebook_lead_id && (existingFbidMap.has(l.facebook_lead_id) || processedFbIds.has(l.facebook_lead_id))) {
            return;
        }

        if (l.facebook_lead_id) {
            processedFbIds.add(l.facebook_lead_id);
        }

        // 2. Check if this is a NEW submission from an existing CRM contact (matching phone)
        let existing = null;
        if (l.phone) {
            const digits = l.phone.replace(/\D/g, '').slice(-10);
            if (digits.length >= 7 && existingPhoneMap.has(digits)) {
                existing = existingPhoneMap.get(digits);
            }
        }

        if (existing) {
            // Genuine Reopened Lead: existing contact submitting a brand new Facebook form
            duplicateLeadsToReopen.push({ lead: l, existing });
            if (l.facebook_lead_id) existingFbidMap.set(l.facebook_lead_id, existing);
        } else {
            // Truly new lead
            trulyNewLeads.push(l);
            if (l.facebook_lead_id) existingFbidMap.set(l.facebook_lead_id, l);
            if (l.phone) {
                const digits = l.phone.replace(/\D/g, '').slice(-10);
                if (digits.length >= 7) existingPhoneMap.set(digits, l);
            }
        }
    });

    console.log(`Filtered Meta Sync leads: ${trulyNewLeads.length} truly new, ${duplicateLeadsToReopen.length} genuine reopens to process.`);

    // Process duplicate lead submissions to reopen lead & log history
    if (duplicateLeadsToReopen.length > 0) {
        for (const item of duplicateLeadsToReopen) {
            try {
                const existingLead = item.existing;
                const newLead = item.lead;

                let cf: any = existingLead.custom_fields || {};
                if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) { cf = {}; } }
                
                const reopenedCount = (cf.reopened_count || 0) + 1;
                cf.reopened_count = reopenedCount;
                cf.last_reopened_at = new Date().toISOString();

                await supabase
                    .from('leads')
                    .update({
                        custom_fields: JSON.stringify(cf),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingLead.id);

                const reopenDesc = `The lead was reopened from Facebook Ad Submission\nLead Name : ${newLead.name || existingLead.name}\nContact no : ${newLead.phone || existingLead.phone}\nEmail : ${newLead.email || existingLead.email || 'N/A'}\nLead Source : Facebook\nSource Details : ${newLead.ad_name || newLead.form_name || 'Meta Ad'}\nLead Status : ${existingLead.pipeline_stage || 'New'}`;

                await supabase.from('lead_history').insert({
                    lead_id: existingLead.id,
                    user_id: targetUserId,
                    action_type: 'REOPENED',
                    description: reopenDesc,
                    created_at: new Date().toISOString()
                });
            } catch (err) {
                console.error('[CRM Sync Reopen Error]:', err);
            }
        }
    }

    // 2. Setup distribution: Group-Distribution automation rules first, then global round robin fallback
    // Fetch automations and DB campaigns
    const targetUserIds = Array.from(new Set([targetUserId, profile?.agency_id, profile?.parent_id].filter(Boolean)));
    const [{ data: groupAutomations }, { data: dbUserCampaigns }] = await Promise.all([
      supabase
        .from('automations')
        .select('*')
        .in('user_id', targetUserIds)
        .like('title', 'Group-Distribution:%')
        .eq('is_active', true),
      supabase
        .from('campaigns')
        .select('id, name')
        .in('user_id', targetUserIds)
    ]);

    const idToName: Record<string, string> = {};
    const nameToId: Record<string, string> = {};
    dbUserCampaigns?.forEach((c: any) => {
      if (c.id && c.name) {
        idToName[c.id] = c.name;
        nameToId[c.name] = c.id;
      }
    });
    const campaignsMap = { idToName, nameToId };

    const parsedGroupRules: any[] = [];
    if (groupAutomations && groupAutomations.length > 0) {
      for (const aut of groupAutomations) {
        try {
          const parsed = JSON.parse(aut.description || '{}');
          if (Array.isArray(parsed.members) && parsed.members.length > 0 && (Array.isArray(parsed.campaigns) || Array.isArray(parsed.campaign_ids))) {
            parsedGroupRules.push({
              id: aut.id,
              group_name: parsed.group_name || aut.title.replace('Group-Distribution:', '').trim(),
              members: parsed.members,
              campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
              campaign_ids: Array.isArray(parsed.campaign_ids) ? parsed.campaign_ids : [],
              form_ids: Array.isArray(parsed.form_ids) ? parsed.form_ids : [],
              last_assigned_user_id: parsed.last_assigned_user_id || null,
              rawDesc: parsed,
              isDirty: false
            });
          }
        } catch (e) {}
      }
    }

    let agentIds: string[] = [];
    let currentAgentIndex = 0;

    if (profile?.enable_distribution && trulyNewLeads.length > 0) {
        const { data: teamData } = await supabase
            .from('profiles')
            .select('id')
            .or(`agency_id.eq.${targetUserId},parent_id.eq.${targetUserId}`)
            .in('role', ['admin', 'agent'])
            .neq('id', targetUserId); // Exclude the owner

        if (teamData && teamData.length > 0) {
            agentIds = teamData.map(t => t.id);

            // Find the last assigned agent to continue the sequence
            const { data: lastAssignedLead } = await supabase
                .from('leads')
                .select('assigned_to')
                .in('assigned_to', agentIds)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const lastAssignedId = lastAssignedLead?.assigned_to;
            if (lastAssignedId) {
                const lastIdx = agentIds.indexOf(lastAssignedId);
                if (lastIdx !== -1) {
                    currentAgentIndex = (lastIdx + 1) % agentIds.length;
                }
            }
        }
    }

    const getAssignedAgentForLead = (lead: any) => {
      const leadCtx = {
        campaignId: lead.campaign_id,
        campaignName: lead.campaign_name,
        adName: lead.ad_name,
        formName: lead.form_name,
        formId: lead.form_id || null,
        adCampaignString: lead.ad_name
      };

      // Check Group-Distribution rules first
      for (const rule of parsedGroupRules) {
        const matchesById = (lead.campaign_id && rule.campaign_ids?.includes(String(lead.campaign_id))) ||
                            (lead.form_id && rule.form_ids?.includes(String(lead.form_id)));
        const matchesByRule = rule.campaigns?.length > 0 && rule.campaigns.some((gc: string) => matchesCampaignRule(gc, leadCtx, campaignsMap));
        const matches = matchesById || matchesByRule;

        if (matches) {
          const weightedPool: any[] = [];
          rule.members.forEach((m: any) => {
            for (let w = 0; w < Math.max(1, m.weight || 1); w++) {
              weightedPool.push(m);
            }
          });

          if (weightedPool.length > 0) {
            let nextIdx = 0;
            if (rule.last_assigned_user_id) {
              const lastIdx = weightedPool.findIndex((m: any) => m.userId === rule.last_assigned_user_id);
              if (lastIdx !== -1) {
                nextIdx = (lastIdx + 1) % weightedPool.length;
              }
            }
            const chosenMember = weightedPool[nextIdx];
            rule.last_assigned_user_id = chosenMember.userId;
            rule.rawDesc.last_assigned_user_id = chosenMember.userId;
            rule.rawDesc.last_assigned_user_name = chosenMember.name;
            rule.rawDesc.last_assigned_at = new Date().toISOString();
            rule.isDirty = true;
            return chosenMember.userId;
          }
        }
      }

      // Global Round Robin Fallback
      if (agentIds.length > 0) {
        const fallbackAgent = agentIds[currentAgentIndex];
        currentAgentIndex = (currentAgentIndex + 1) % agentIds.length;
        return fallbackAgent;
      }

      return null;
    };

    let newCount = 0;
    // Batch Insert for Performance (200 at a time)
    const BATCH_SIZE = 200;
    for (let i = 0; i < trulyNewLeads.length; i += BATCH_SIZE) {
        const chunk = trulyNewLeads.slice(i, i + BATCH_SIZE).map(lead => {
            const assignedTo = getAssignedAgentForLead(lead);

            let leadCreatedAt = new Date().toISOString();
            if (lead.facebook_created_at) {
                const parsedDate = isNaN(Number(lead.facebook_created_at)) 
                    ? Date.parse(lead.facebook_created_at) 
                    : Number(lead.facebook_created_at) * (Number(lead.facebook_created_at) < 1000000000000 ? 1000 : 1);
                if (!isNaN(parsedDate)) {
                    leadCreatedAt = new Date(parsedDate).toISOString();
                }
            }

            return {
                user_id: targetUserId,
                name: lead.name,
                email: lead.email,
                phone: lead.phone,
                source: 'Facebook',
                form_id: lead.form_id,
                form_name: lead.form_name,
                custom_fields: lead.custom_fields,
                ad_name: lead.ad_name,
                facebook_lead_id: lead.facebook_lead_id,
                facebook_created_at: lead.facebook_created_at,
                status: 'New', 
                pipeline_stage: 'New',
                assigned_to: assignedTo,
                campaign_id: lead.campaign_id || null,
                created_at: leadCreatedAt
            };
        });

        const { error } = await supabase.from('leads').insert(chunk);

        if (error) {
            console.error(`Batch insert error at index ${i}:`, error);
        } else {
            newCount += chunk.length;
        }
    }

    // Persist updated group automation states
    for (const rule of parsedGroupRules) {
      if (rule.isDirty) {
        try {
          await supabase
            .from('automations')
            .update({ description: JSON.stringify(rule.rawDesc) })
            .eq('id', rule.id);
        } catch (rErr) {
          console.error('[CRM Sync] Error updating automation rule state:', rErr);
        }
      }
    }

    // Retroactively backfill existing WhatsApp leads with meta_ad_origin & property mapping
    try {
        const { data: waLeads } = await supabase
            .from('leads')
            .select('*')
            .eq('user_id', targetUserId)
            .ilike('source', '%whatsapp%');

        const { data: waChats } = await supabase
            .from('whatsapp_chats')
            .select('*')
            .eq('user_id', targetUserId);

        const { data: userProps } = await supabase
            .from('properties')
            .select('*')
            .eq('user_id', targetUserId);

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
                }
            }
        }
    } catch (backfillErr) {
        console.error("WhatsApp lead backfill error:", backfillErr);
    }

    return NextResponse.json({ success: true, count: newCount, total: leads.length })

  } catch (error: any) {
    console.error("CRM Sync Error:", error);
    logToFile("❌ CRM Sync Failed:", error.message || error);
    return NextResponse.json({ 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    }, { status: 500 })
  }
}