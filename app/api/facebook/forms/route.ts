import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchLeadForms } from '@/utils/external-apis'

export async function GET(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get Page Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id')
    .eq('id', user.id)
    .single()

  if (!profile?.selected_page_token || !profile?.selected_page_id) {
    return NextResponse.json({ error: 'Page not connected' }, { status: 400 })
  }

  try {
    const forms = await fetchLeadForms(profile.selected_page_token, profile.selected_page_id)
    return NextResponse.json({ forms })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}