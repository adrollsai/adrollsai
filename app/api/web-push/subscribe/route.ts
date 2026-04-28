import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    const body = await request.json()
    const { subscription } = body
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !subscription) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { endpoint, keys } = subscription

    // Use Admin Client to bypass RLS for push_subscriptions table
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. DELETE: Remove this device from ANY other user to prevent "Zombie" notifs
    await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint)

    // 2. INSERT: Assign device to current user
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .insert({
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Subscription error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}