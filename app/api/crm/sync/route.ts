import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchFacebookLeads } from '@/utils/external-apis'
import { logToFile } from '@/utils/logger'

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
      .select('selected_page_token, selected_page_id, enable_distribution')
      .eq('id', targetUserId)
      .single()

    if (!profile?.selected_page_token || !profile?.selected_page_id) {
        return NextResponse.json({ error: 'Target account has no Page connected' }, { status: 400 })
    }

    // Pass formId to the helper
    const leads = await fetchFacebookLeads(
        profile.selected_page_token, 
        profile.selected_page_id,
        formId
    );
    console.log(`Retrieved ${leads.length} leads from Meta API`);

    // 1. Fetch existing facebook_lead_ids to filter out duplicates in advance
    const incomingLeadIds = leads.map(l => l.facebook_lead_id).filter(Boolean);
    let trulyNewLeads = [...leads];
    
    if (incomingLeadIds.length > 0) {
        const { data: existingLeads } = await supabase
            .from('leads')
            .select('facebook_lead_id')
            .in('facebook_lead_id', incomingLeadIds);
            
        const existingSet = new Set(existingLeads?.map(l => l.facebook_lead_id) || []);
        trulyNewLeads = leads.filter(l => !existingSet.has(l.facebook_lead_id));
    }

    console.log(`Filtered out duplicates. Truly new leads to sync: ${trulyNewLeads.length}`);

    // 2. Setup round robin pool and start index if distribution is enabled
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

    let newCount = 0;
    // Batch Insert for Performance (200 at a time)
    const BATCH_SIZE = 200;
    for (let i = 0; i < trulyNewLeads.length; i += BATCH_SIZE) {
        const chunk = trulyNewLeads.slice(i, i + BATCH_SIZE).map(lead => {
            let assignedTo: string | null = null;
            if (agentIds.length > 0) {
                assignedTo = agentIds[currentAgentIndex];
                currentAgentIndex = (currentAgentIndex + 1) % agentIds.length;
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
                campaign_id: lead.campaign_id || null
            };
        });

        const { error } = await supabase.from('leads').insert(chunk);

        if (error) {
            console.error(`Batch insert error at index ${i}:`, error);
        } else {
            newCount += chunk.length;
        }
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