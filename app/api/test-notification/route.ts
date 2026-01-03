import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Authenticate
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Get delay from body (default to 0)
  const { delay } = await request.json()

  // 3. Wait (Simulate background event)
  if (delay) {
      console.log(`Waiting ${delay} seconds...`)
      await new Promise(resolve => setTimeout(resolve, delay * 1000))
  }

  // 4. Send Notification
  console.log("Sending test notification now...")
  await sendNotification(
    supabase,
    user.id,
    "🔔 Background Test",
    "If you see this, your Service Worker is alive!",
    "system",
    "/dashboard"
  )

  return NextResponse.json({ success: true })
}