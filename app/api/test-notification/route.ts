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

    // 1. Await the 5-second delay so Vercel does NOT freeze the function
    await new Promise(resolve => setTimeout(resolve, 5000))

    // 2. Await the push notification 
    await sendPushNotification(
        user.id,
        "Test Successful! 🚀",
        "Your push notifications are working perfectly on this device.",
        "/dashboard/crm"
    )

    // 3. ONLY return the response after the push is actually sent
    return NextResponse.json({ success: true, message: 'Notification sent successfully' })
    
  } catch (error: any) {
    console.error("Test API Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}