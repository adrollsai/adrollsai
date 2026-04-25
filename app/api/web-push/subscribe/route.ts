import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    // 1. Authenticate normally
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
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
    }

    // 2. Use Admin Client to bypass RLS 403 Forbidden error
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 3. Save the token
    const { error } = await supabaseAdmin.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: endpoint,
        p256dh: p256dh,
        auth: auth
    }, { onConflict: 'endpoint' })

    if (error) throw error;

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Push Subscribe Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}