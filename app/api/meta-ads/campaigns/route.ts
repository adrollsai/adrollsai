// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/meta-ads/campaigns/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export async function GET(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Get Credentials
  const url = new URL(request.url)
  const impersonateId = url.searchParams.get('impersonate')

  let targetUserId = user.id

  if (impersonateId) {
      // Check if user is super_admin or agency/admin owner of this client
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
          if (profile?.role !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', user.id)
                .single()
              if (subAccount) targetUserId = impersonateId
              else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
          } else {
              targetUserId = impersonateId
          }
      } else {
          return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
      }
  }

  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('id', targetUserId)
    .single()

  if (!targetProfile?.facebook_token || !targetProfile?.ad_account_id) {
    return NextResponse.json({ campaigns: [] }) // Return empty if not connected
  }

  try {
    // 3. Fetch Campaigns from Meta
    // fields=effective_status fetches ACTIVE, PAUSED, ARCHIVED, etc.
    const fbUrl = `${FB_GRAPH_URL}/${targetProfile.ad_account_id}/campaigns?fields=id,name,status,effective_status,objective,start_time&filtering=[{"field":"objective","operator":"IN","value":["OUTCOME_LEADS","LEAD_GENERATION"]}]&limit=20&access_token=${targetProfile.facebook_token}`;
    
    const response = await fetch(fbUrl);
    const data = await response.json();

    if (data.error) {
      console.error("Meta Fetch Error:", data.error);
      throw new Error(data.error.message);
    }

    return NextResponse.json({ campaigns: data.data || [] })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}