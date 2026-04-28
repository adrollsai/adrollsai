import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// 1. ABSOLUTE CACHE BUSTING (This fixes the missing notifications)
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { fetch: fetch } 
      }
    )

    // NO MORE TIMEZONE HACK. Use strict current UTC time.
    const nowUtcString = new Date().toISOString()

    // Fetch leads where the followup time is less than or equal to RIGHT NOW
    const { data: leadsToRemind, error } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, name, phone, next_followup')
      .not('next_followup', 'is', null)
      .lte('next_followup', nowUtcString)

    if (error) throw error;

    if (!leadsToRemind || leadsToRemind.length === 0) {
        return NextResponse.json({ 
            success: true, 
            processed: 0, 
            message: "No reminders due",
            timeSearched: nowUtcString
        })
    }

    let successfulPushes = 0;

    for (const lead of leadsToRemind) {
      try {
          await sendPushNotification(
              lead.user_id,
              "Follow-Up Reminder ⏰",
              `Time to follow up with ${lead.name} ${lead.phone ? `(${lead.phone})` : ''}`,
              `/dashboard/crm/${lead.id}`, 
              "reminder"
          )

          // Clear the reminder so it doesn't trigger again
          const { error: updateError } = await supabaseAdmin
              .from('leads')
              .update({ next_followup: null })
              .eq('id', lead.id)

          if (!updateError) successfulPushes++;
      } catch (pushError) {
          console.error(`Failed to process lead ${lead.id}:`, pushError);
      }
    }

    return NextResponse.json({ 
        success: true, 
        processed: successfulPushes,
        totalFound: leadsToRemind.length
    })

  } catch (error: any) {
    console.error("Cron Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}