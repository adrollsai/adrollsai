import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server' // User Client (for auth check only)
import { createAdminClient } from '@/utils/supabase/admin' // Admin Client (for sending)
import { sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check (Still check if user is logged in)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { delay } = await request.json()

  // 2. Wait
  if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay * 1000))
  }

  // 3. Send Notification using ADMIN client (Bypasses RLS)
  const adminSupabase = createAdminClient()
  
  await sendNotification(
    adminSupabase, // <--- Using Admin Client here
    user.id,
    "🔔 Background Test",
    "If you see this, your Service Worker is alive!",
    "system",
    "/dashboard"
  )

  return NextResponse.json({ success: true })
}