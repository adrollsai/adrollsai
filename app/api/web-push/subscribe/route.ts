import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    // 1. Authenticate the user normally to ensure they are logged in
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const subData = body.subscription || body;
    
    const endpoint = subData.endpoint;
    const p256dh = subData.keys?.p256dh;
    const auth = subData.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
        console.error("Missing keys in payload:", body);
        return NextResponse.json({ error: 'Malformed subscription payload' }, { status: 400 })
    }

    // 2. Initialize the Admin Client to bypass the 403 RLS block
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 3. Forcefully save the iPhone's token to the database
    const { error } = await supabaseAdmin.from('push_subscriptions').upsert({
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