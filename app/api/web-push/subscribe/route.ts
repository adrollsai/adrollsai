import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    const body = await request.json()
    const { subscription, ownerId, fcmToken, platform } = body
    const { data: { user } } = await supabase.auth.getUser()

    if (!subscription && !fcmToken) {
      return NextResponse.json({ error: 'Invalid subscription or FCM token' }, { status: 400 })
    }

    let endpoint: string
    let p256dh: string | null = null
    let auth: string | null = null

    if (fcmToken) {
      endpoint = `fcm:${fcmToken}`
      p256dh = platform || 'android'
      auth = fcmToken
    } else {
      endpoint = subscription.endpoint
      p256dh = subscription.keys?.p256dh || null
      auth = subscription.keys?.auth || null
    }

    // Use Admin Client to bypass RLS for push_subscriptions table
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. DELETE: Remove this device from ANY other user/owner to prevent "Zombie" notifs
    await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint)

    // 2. INSERT: Assign device to current user OR catalog owner
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .insert({
        user_id: user?.id || null,
        catalog_owner_id: ownerId || null,
        endpoint,
        p256dh,
        auth
      })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Subscription error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}