import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// 1. Force dynamic context to prevent static generation caching
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
    return handleRemindPost(request);
}

export async function POST(request: Request) {
    return handleRemindPost(request);
}

async function handleRemindPost(request: Request) {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    // Enforce security verification using our global environment CRON_SECRET if configured
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { fetch: fetch }
      }
    )

    // Define UTC boundaries for the current day
    const startOfToday = new Date()
    startOfToday.setUTCHours(0, 0, 0, 0)
    const startOfTodayIso = startOfToday.toISOString()

    // 1. Fetch active push subscribers in the system
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('user_id')
      .not('user_id', 'is', null)

    if (subError) throw subError;

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ 
        success: true, 
        processed: 0, 
        message: "No push subscribers found in database"
      })
    }

    // Resolve unique list of subscriber user IDs
    const uniqueUserIds = Array.from(new Set(subscriptions.map(s => s.user_id).filter(Boolean))) as string[];
    
    let processedReminders = 0;
    const remindedUsers: string[] = [];

    // 2. Query each active subscriber's post record for today
    for (const userId of uniqueUserIds) {
      const { data: postsToday, error: postsError } = await supabaseAdmin
        .from('posts')
        .select('id')
        .eq('user_id', userId)
        .gte('created_at', startOfTodayIso)
        .limit(1)

      if (postsError) {
        console.error(`[Remind Post Cron] Error scanning posts for user ${userId}:`, postsError)
        continue
      }

      // If they haven't shared any updates today, trigger the push reminder
      if (!postsToday || postsToday.length === 0) {
        try {
          await sendPushNotification(
            userId,
            "Share an Update Today! 🚀",
            "Keep your catalog active! You haven't posted your daily marketing update or ad creative today.",
            "/dashboard/feed",
            "post_reminder"
          )
          processedReminders++
          remindedUsers.push(userId)
        } catch (pushErr) {
          console.error(`[Remind Post Cron] Push failed for user ${userId}:`, pushErr)
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      processed: processedReminders, 
      remindedUserIds: remindedUsers 
    })

  } catch (error: any) {
    console.error("[Remind Post Cron] Fatal Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
