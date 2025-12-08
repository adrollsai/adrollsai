// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/meta-ads/update-status/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { campaignId, newStatus } = await request.json()

  if (!campaignId || !newStatus) {
      return NextResponse.json({ error: 'Missing campaignId or status' }, { status: 400 })
  }

  // 2. Get Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('facebook_token')
    .eq('id', user.id)
    .single()

  if (!profile?.facebook_token) {
    return NextResponse.json({ error: 'No Facebook token found' }, { status: 400 })
  }

  try {
    // 3. Send Update to Meta
    const response = await fetch(`${FB_GRAPH_URL}/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status: newStatus, // 'ACTIVE' or 'PAUSED'
            access_token: profile.facebook_token
        })
    });

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message);
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("Update Status Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}