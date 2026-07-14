import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logToFile } from '@/utils/logger'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export async function GET(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    logToFile("[Campaigns API] Unauthorized - No user session");
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Get Credentials
  const url = new URL(request.url)
  const impersonateId = url.searchParams.get('impersonate')

  // 1.5 Get User Profile for role/hierarchy
  const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single()
  
  logToFile(`[Campaigns API] Request by User: ${user.id} (${profile?.role}), Impersonating: ${impersonateId}`);

  let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
    ? (profile.agency_id || profile.parent_id) 
    : user.id

  if (impersonateId && impersonateId !== user.id) {
      // Security Check: Who is allowed to impersonate this ID?
      if (['super_admin', 'agency', 'admin', 'agent'].includes(profile?.role || '')) {
          if (profile?.role !== 'super_admin') {
              // 1. Is it their own agency owner? (For staff)
              const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
              
              // 2. Is it one of their clients?
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id) // Check if they share the same agency root
                .single()

              if (isParent || subAccount) {
                  targetUserId = impersonateId
              } else {
                  logToFile(`[Campaigns API] 403 Unauthorized impersonation (isParent: ${isParent}, subAccount: ${!!subAccount})`);
                  return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
              }
          } else {
              targetUserId = impersonateId
          }
      } else {
          logToFile(`[Campaigns API] 403 Unauthorized impersonation (User role ${profile?.role} not allowed)`);
          return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
      }
  }

  logToFile(`[Campaigns API] targetUserId resolved to: ${targetUserId}`);

  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('facebook_token, ad_account_id, agency_id, parent_id')
    .eq('id', targetUserId)
    .single()

  let token = targetProfile?.facebook_token
  if (!token) {
      token = profile?.facebook_token
  }

  if (!token && (profile?.agency_id || profile?.parent_id)) {
      const { data: parentProfile } = await supabase
          .from('profiles')
          .select('facebook_token')
          .eq('id', profile.agency_id || profile.parent_id)
          .single()
      token = parentProfile?.facebook_token
  }

  logToFile(`[Campaigns API] Token Exists: ${!!token}, Ad Account: ${targetProfile?.ad_account_id}`);

  if (!token || !targetProfile?.ad_account_id) {
    logToFile(`[Campaigns API] Returning empty campaigns - missing token or ad account ID`);
    return NextResponse.json({ campaigns: [] }) // Return empty if not connected
  }

  try {
    // 3. Fetch Campaigns from Meta
    // fields=effective_status fetches ACTIVE, PAUSED, ARCHIVED, etc.
    const fbUrl = `${FB_GRAPH_URL}/${targetProfile.ad_account_id}/campaigns?fields=id,name,status,effective_status,objective,start_time&filtering=[{"field":"objective","operator":"IN","value":["OUTCOME_LEADS","LEAD_GENERATION","OUTCOME_ENGAGEMENT"]}]&limit=100&access_token=${token}`;
    
    const response = await fetch(fbUrl);
    const data = await response.json();

    if (data.error) {
      logToFile(`[Campaigns API] Meta API fetch error: ${JSON.stringify(data.error)}`);
      throw new Error(data.error.message);
    }

    logToFile(`[Campaigns API] Successfully fetched ${data.data?.length || 0} campaigns`);
    return NextResponse.json({ campaigns: data.data || [] })

  } catch (error: any) {
    logToFile(`[Campaigns API] Catch block error: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}