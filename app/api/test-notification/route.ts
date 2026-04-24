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

    // Fire the notification asynchronously after 5 seconds.
    // We don't use 'await' on the timeout so the API can return a 200 OK immediately to the frontend.
    setTimeout(async () => {
        try {
            await sendPushNotification(
                user.id,
                "Test Successful! 🚀",
                "Your push notifications are working perfectly on this device.",
                "/dashboard/crm"
            );
        } catch (err) {
            console.error("Delayed push failed:", err);
        }
    }, 5000);

    return NextResponse.json({ success: true, message: 'Notification scheduled in 5 seconds' })
  } catch (error: any) {
    console.error("Test API Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}