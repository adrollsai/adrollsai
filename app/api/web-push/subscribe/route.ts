import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    // Safely extract the subscription data, whether it's wrapped in a "subscription" key or not
    const subData = body.subscription || body;
    
    const endpoint = subData.endpoint;
    const p256dh = subData.keys?.p256dh;
    const auth = subData.keys?.auth;

    // Guard clause to prevent Supabase 400 errors if data is missing
    if (!endpoint || !p256dh || !auth) {
        console.error("Missing keys in payload:", body);
        return NextResponse.json({ error: 'Malformed subscription payload' }, { status: 400 })
    }

    const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: endpoint,
        p256dh: p256dh,
        auth: auth
    }, { onConflict: 'endpoint' })

    if (error) {
        console.error("Supabase DB Error:", error);
        throw error;
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Push Subscribe Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}