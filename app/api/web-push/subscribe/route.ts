import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { endpoint, keys } = await request.json()

    const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
    }, { onConflict: 'endpoint' })

    if (error) throw error;

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Push Subscribe Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}