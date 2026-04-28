import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendPushNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Dispatch immediately to avoid Vercel 504 Timeouts
    await sendPushNotification(
        user.id,
        "Test Successful! 🚀",
        "Your push notifications are working perfectly on this device.",
        "/dashboard/crm"
    )

    return NextResponse.json({ success: true, message: 'Notification sent successfully' })
    
  } catch (error: any) {
    console.error("Test API Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}