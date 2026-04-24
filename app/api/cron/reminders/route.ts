import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// Forces Vercel to treat this as a dynamic route
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get exact current time
    const now = new Date().toISOString()

    // Query leads where a reminder is scheduled and the time has passed
    const { data: leadsToRemind, error } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, name, phone, next_followup')
      .not('next_followup', 'is', null)
      .lte('next_followup', now)

    if (error) throw error;
    if (!leadsToRemind || leadsToRemind.length === 0) {
        return NextResponse.json({ success: true, processed: 0, message: "No reminders due" })
    }

    for (const lead of leadsToRemind) {
      // 1. Send the push notification
      await sendPushNotification(
          lead.user_id,
          "⏰ Follow-Up Reminder",
          `It's time to follow up with ${lead.name} (${lead.phone || 'No phone'})`,
          `/dashboard/crm/${lead.id}`, // Redirect exactly to their profile
          "reminder"
      )

      // 2. Clear the reminder from DB so it doesn't fire again
      await supabaseAdmin
          .from('leads')
          .update({ next_followup: null })
          .eq('id', lead.id)
    }

    return NextResponse.json({ success: true, processed: leadsToRemind.length })

  } catch (error: any) {
    console.error("Cron Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}