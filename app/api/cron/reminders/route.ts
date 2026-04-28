// app/api/cron/reminders/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    console.log("Starting cron job for reminders...");

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Calculate the current UTC time
    const now = new Date().toISOString()
    console.log("Current Server Time (UTC):", now);

    // Fetch leads where the followup time is in the past
    const { data: leadsToRemind, error } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, name, phone, next_followup')
      .not('next_followup', 'is', null)
      .lte('next_followup', now)

    if (error) {
        console.error("Database fetch error:", error);
        throw error;
    }

    console.log(`Query returned ${leadsToRemind?.length || 0} leads to process.`);

    if (!leadsToRemind || leadsToRemind.length === 0) {
        return NextResponse.json({ 
            success: true, 
            processed: 0, 
            message: "No reminders due right now.",
            currentTimeTested: now
        })
    }

    let successfulPushes = 0;

    // Process sequentially to avoid overwhelming the push service
    for (const lead of leadsToRemind) {
      console.log(`Processing lead ${lead.id} scheduled for ${lead.next_followup}`);

      try {
          // 1. Send the push notification safely
          await sendPushNotification(
              lead.user_id,
              "Follow-Up Reminder ⏰",
              `Time to follow up with ${lead.name} ${lead.phone ? `(${lead.phone})` : ''}`,
              `/dashboard/crm/${lead.id}`, 
              "reminder"
          )

          // 2. Clear the reminder from DB
          const { error: updateError } = await supabaseAdmin
              .from('leads')
              .update({ next_followup: null })
              .eq('id', lead.id)

          if (updateError) {
              console.error(`Failed to clear DB reminder for ${lead.id}:`, updateError);
          } else {
              successfulPushes++;
          }
      } catch (pushError) {
          // Isolate failures so one bad token doesn't stop the whole cron job
          console.error(`Failed to process lead ${lead.id}:`, pushError);
      }
    }

    return NextResponse.json({ 
        success: true, 
        processed: successfulPushes,
        totalFound: leadsToRemind.length
    })

  } catch (error: any) {
    console.error("Cron Fatal Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}