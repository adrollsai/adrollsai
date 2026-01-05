import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  const { subscription } = await request.json()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !subscription) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const { endpoint, keys } = subscription
    
    // 1. DELETE: Remove this device from ANY other user to prevent "Zombie" notifs
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)

    // 2. INSERT: Assign device to current user
    const { error } = await supabase
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