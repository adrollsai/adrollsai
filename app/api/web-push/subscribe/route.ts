import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    // 1. Authenticate normally
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        console.error("Push Auth Error:", authError)
        return NextResponse.json({ error: 'Unauthorized - User session not found' }, { status: 401 })
    }

    const body = await request.json()
    const subData = body.subscription || body;

    const endpoint = subData.endpoint;
    const p256dh = subData.keys?.p256dh;
    const auth = subData.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
        return NextResponse.json({ error: 'Malformed push payload missing required keys' }, { status: 400 })
    }

    // 2. Use Admin Client to bypass RLS 403 Forbidden error
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // CRITICAL FIX: Delete by 'endpoint' instead of 'user_id'
    // If you log into a different test account on the same browser, the browser uses the same endpoint.
    // Deleting by endpoint prevents Postgres unique constraint crashes!
    await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint)

    // Forcefully insert the new token
    const { error } = await supabaseAdmin.from('push_subscriptions').insert({
        user_id: user.id,
        endpoint: endpoint,
        p256dh: p256dh,
        auth: auth
    })

    if (error) {
        console.error("DB Insert Error:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Push Subscribe Exception:", error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}