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
    // Extract keys properly from the subscription object
    const p256dh = subscription.keys.p256dh
    const auth = subscription.keys.auth
    const endpoint = subscription.endpoint

    // Upsert to avoid duplicates
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: user.id,
        endpoint,
        p256dh,
        auth
      }, { onConflict: 'user_id, endpoint' })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Subscription error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}