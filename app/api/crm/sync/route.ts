import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchFacebookLeads } from '@/utils/external-apis'
import { logToFile } from '@/app/api/meta-ads/launch-campaign/route'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    logToFile("--- CRM SYNC START ---");
    // Read body for specific form ID
    const body = await request.json().catch(() => ({}))
    const { formId } = body // Optional

    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_page_token, selected_page_id')
      .eq('id', user.id)
      .single()

    if (!profile?.selected_page_token || !profile?.selected_page_id) {
        return NextResponse.json({ error: 'Page not connected' }, { status: 400 })
    }

    // Pass formId to the helper
    const leads = await fetchFacebookLeads(
        profile.selected_page_token, 
        profile.selected_page_id,
        formId
    );
    console.log(`Retrieved ${leads.length} leads from Meta API`);

    let newCount = 0;
    for (const lead of leads) {
        const { error } = await supabase.from('leads').upsert({
            user_id: user.id,
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
        }, { onConflict: 'facebook_lead_id' })
        
        if (error) {
            console.error("Supabase upsert error:", error);
        } else {
            newCount++;
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