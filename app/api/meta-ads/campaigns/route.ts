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

  let adAccountId = targetProfile?.ad_account_id;
  if (!adAccountId && (profile?.agency_id || profile?.parent_id)) {
      const { data: parentProfile } = await supabase
          .from('profiles')
          .select('ad_account_id')
          .eq('id', profile.agency_id || profile.parent_id)
          .single()
      adAccountId = parentProfile?.ad_account_id
  }

  logToFile(`[Campaigns API] Token Exists: ${!!token}, Ad Account: ${adAccountId}`);

  if (!token || !adAccountId) {
    logToFile(`[Campaigns API] Returning empty campaigns - missing token or ad account ID`);
    return NextResponse.json({ campaigns: [] }) // Return empty if not connected
  }

  // Format ad account ID with act_ prefix if needed
  const formattedAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  try {
    // 3. Fetch Campaigns from Meta including all statuses (IN_PROCESS, PENDING_REVIEW, ACTIVE, PAUSED, etc.)
    const effectiveStatuses = JSON.stringify([
      'ACTIVE',
      'PAUSED',
      'PENDING_REVIEW',
      'DISAPPROVED',
      'PREAPPROVED',
      'PENDING_BILLING_INFO',
      'CAMPAIGN_PAUSED',
      'ARCHIVED',
      'IN_PROCESS',
      'WITH_ISSUES'
    ]);

    const fbUrl = `${FB_GRAPH_URL}/${formattedAdAccountId}/campaigns?fields=id,name,status,effective_status,objective,start_time,created_time,daily_budget,lifetime_budget,budget_remaining&effective_status=${encodeURIComponent(effectiveStatuses)}&limit=150&access_token=${token}`;
    
    let response = await fetch(fbUrl);
    let data = await response.json();

    // Fallback without effective_status filter if error returned
    if (data.error) {
      logToFile(`[Campaigns API] Retrying with generic endpoint due to: ${data.error.message}`);
      const fallbackUrl = `${FB_GRAPH_URL}/${formattedAdAccountId}/campaigns?fields=id,name,status,effective_status,objective,start_time,created_time,daily_budget,lifetime_budget,budget_remaining&limit=150&access_token=${token}`;
      response = await fetch(fallbackUrl);
      data = await response.json();
    }

    if (data.error) {
      logToFile(`[Campaigns API] Meta API fetch error: ${JSON.stringify(data.error)}`);
      throw new Error(data.error.message);
    }

    const campaignList = data.data || [];
    // Sort by created_time descending so newly created campaigns show first
    campaignList.sort((a: any, b: any) => {
      const timeA = new Date(a.created_time || a.start_time || 0).getTime();
      const timeB = new Date(b.created_time || b.start_time || 0).getTime();
      return timeB - timeA;
    });

    logToFile(`[Campaigns API] Successfully fetched ${campaignList.length} campaigns`);
    return NextResponse.json({ campaigns: campaignList })

  } catch (error: any) {
    logToFile(`[Campaigns API] Catch block error: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}