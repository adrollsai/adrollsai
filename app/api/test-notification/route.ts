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
    const result = await sendPushNotification(
        user.id,
        "Test Successful! 🚀",
        "Your push notifications are working perfectly on this device.",
        "/dashboard/crm"
    )

    if (!result?.success || result?.count === 0) {
      return NextResponse.json({
        error: 'No active devices found for this account. Please tap Enable to register this device.'
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: `Notification sent successfully to ${result.count} active device(s)`
    })
    
  } catch (error: any) {
    console.error("Test API Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}