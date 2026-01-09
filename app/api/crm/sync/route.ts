import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchFacebookLeads } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
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

    if (!leads || leads.length === 0) {
       return NextResponse.json({ success: true, count: 0, total: 0, message: "No leads found." })
    }

    // CRITICAL FIX: BULK UPSERT
    // Map leads to the database structure
    const leadsToUpsert = leads.map((lead: any) => ({
        user_id: user.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        source: 'Facebook',
        ad_name: lead.ad_name,
        facebook_lead_id: lead.facebook_lead_id,
        status: 'New', 
        pipeline_stage: 'New'
    }));

    // Perform a single database call instead of looping
    // onConflict: 'facebook_lead_id' ensures we don't create duplicates
    const { data: insertedData, error } = await supabase
        .from('leads')
        .upsert(leadsToUpsert, { onConflict: 'facebook_lead_id' })
        .select()

    if (error) throw error;

    return NextResponse.json({ 
        success: true, 
        count: insertedData?.length || 0, 
        total: leads.length 
    })

  } catch (error: any) {
    console.error("CRM Sync Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}