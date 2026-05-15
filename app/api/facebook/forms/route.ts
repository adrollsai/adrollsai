import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchLeadForms } from '@/utils/external-apis'
import { logToFile } from '@/utils/logger'

export async function GET(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // Get Page Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id')
    .eq('id', targetUserId)
    .single()

  if (!profile?.selected_page_token || !profile?.selected_page_id) {
    return NextResponse.json({ error: 'Target account has no Page connected' }, { status: 400 })
  }

  try {
    const forms = await fetchLeadForms(profile.selected_page_token, profile.selected_page_id)
    return NextResponse.json({ forms })
  } catch (error: any) {
    console.error("Fetch Forms Error:", error);
    logToFile("❌ Fetch Lead Forms Failed:", error.message || error);
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}