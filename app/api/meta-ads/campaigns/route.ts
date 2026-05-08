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
  const { data: profile } = await supabase
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('id', user.id)
    .single()

  if (!profile?.facebook_token || !profile?.ad_account_id) {
    return NextResponse.json({ campaigns: [] }) // Return empty if not connected
  }

  try {
    // 3. Fetch Campaigns from Meta
    // fields=effective_status fetches ACTIVE, PAUSED, ARCHIVED, etc.
    const url = `${FB_GRAPH_URL}/${profile.ad_account_id}/campaigns?fields=id,name,status,effective_status,objective,start_time&filtering=[{"field":"objective","operator":"IN","value":["OUTCOME_LEADS","LEAD_GENERATION"]}]&limit=20&access_token=${profile.facebook_token}`;
    
    const response = await fetch(url);
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