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

    let newCount = 0;
    for (const lead of leads) {
        const { error } = await supabase.from('leads').upsert({
            user_id: user.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            source: 'Facebook',
            ad_name: lead.ad_name,
            facebook_lead_id: lead.facebook_lead_id,
            status: 'New', 
            pipeline_stage: 'New'
        }, { onConflict: 'facebook_lead_id' })
        
        if (!error) newCount++;
    }

    return NextResponse.json({ success: true, count: newCount, total: leads.length })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}