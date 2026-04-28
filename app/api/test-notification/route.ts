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

    // REMOVED the artificial 5-second delay. Dispatch immediately.
    await sendPushNotification(
        user.id,
        "System Check 🟢",
        "Your pipeline is active. Notifications are working.",
        "/dashboard/crm"
    )

    return NextResponse.json({ success: true, message: 'Notification dispatched instantly' })
    
  } catch (error: any) {
    console.error("Test API Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}