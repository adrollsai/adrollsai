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
      .select('selected_page_token, selected_page_id')
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

    let newCount = 0;
    // Batch Upsert for Performance (200 at a time)
    const BATCH_SIZE = 200;
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        const chunk = leads.slice(i, i + BATCH_SIZE).map(lead => ({
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
            pipeline_stage: 'New'
        }));

        const { error } = await supabase.from('leads').upsert(chunk, { 
            onConflict: 'facebook_lead_id',
            ignoreDuplicates: true 
        });

        if (error) {
            console.error(`Batch upsert error at index ${i}:`, error);
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