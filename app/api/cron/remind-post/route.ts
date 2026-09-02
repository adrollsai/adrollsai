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
  const diagnostics: Record<string, any> = {
    step: 'start',
    timestamp: new Date().toISOString(),
    totalSubscriptions: 0,
    uniqueUsers: 0,
    checkedUsers: [],
    skippedAlreadyPosted: [],
    remindedUsers: [],
    errors: []
  };

  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    console.log(`[Remind Post Cron] Triggered at ${diagnostics.timestamp}`);

    // Enforce security verification using our global environment CRON_SECRET if configured
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn(`[Remind Post Cron] Unauthorized access attempt.`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    diagnostics.step = 'init_supabase';
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
    diagnostics.startOfToday = startOfTodayIso;

    // 1. Fetch active push subscribers in the system
    diagnostics.step = 'fetch_subscriptions';
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('user_id, catalog_owner_id')

    if (subError) throw subError;

    diagnostics.totalSubscriptions = subscriptions?.length || 0;
    console.log(`[Remind Post Cron] Found ${diagnostics.totalSubscriptions} subscriptions in db.`);

    if (!subscriptions || subscriptions.length === 0) {
      diagnostics.step = 'end_no_subscriptions';
      return NextResponse.json({ 
        success: true, 
        message: "No push subscribers found in database",
        diagnostics
      })
    }

    // Resolve unique list of user IDs to check (check both user_id and catalog_owner_id to be extremely thorough)
    const allUserIds = subscriptions.flatMap(s => [s.user_id, s.catalog_owner_id]).filter(Boolean) as string[];
    const uniqueUserIds = Array.from(new Set(allUserIds));
    
    diagnostics.uniqueUsers = uniqueUserIds.length;
    diagnostics.uniqueUserIds = uniqueUserIds;
    console.log(`[Remind Post Cron] Unique user IDs to check:`, uniqueUserIds);

    diagnostics.step = 'check_posts';
    
    // 2. Query each active subscriber's post record for today
    for (const userId of uniqueUserIds) {
      diagnostics.checkedUsers.push(userId);
      console.log(`[Remind Post Cron] Checking posts for user ${userId} since ${startOfTodayIso}...`);
      
      const { data: postsToday, error: postsError } = await supabaseAdmin
        .from('posts')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'social_published')
        .gte('created_at', startOfTodayIso)
        .limit(1)

      if (postsError) {
        const errStr = `Error scanning posts for user ${userId}: ${postsError.message}`;
        console.error(`[Remind Post Cron] ${errStr}`);
        diagnostics.errors.push(errStr);
        continue;
      }

      const hasSocialPost = postsToday && postsToday.length > 0;

      // If they have posted to socials today, skip them!
      if (hasSocialPost) {
        console.log(`[Remind Post Cron] User ${userId} has posted to socials today. Skipping.`);
        diagnostics.skippedAlreadyPosted.push(userId);
      } else {
        // Check if we ALREADY sent a post_reminder notification to this user today
        const { data: existingReminder } = await supabaseAdmin
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'post_reminder')
          .gte('created_at', startOfTodayIso)
          .limit(1)

        if (existingReminder && existingReminder.length > 0) {
          console.log(`[Remind Post Cron] User ${userId} already received a post_reminder today. Skipping.`);
          diagnostics.skippedAlreadyPosted.push(userId);
          continue;
        }

        // If they haven't received a reminder today, trigger the push reminder
        console.log(`[Remind Post Cron] User ${userId} has NOT posted today and NOT been reminded. Sending push notification...`);
        try {
          await sendPushNotification(
            userId,
            "Share an Update Today! 🚀",
            "Keep your catalog active! You haven't posted your daily marketing update or ad creative today.",
            "/dashboard/feed",
            "post_reminder"
          )
          diagnostics.remindedUsers.push(userId);
        } catch (pushErr: any) {
          const pushErrStr = `Push failed for user ${userId}: ${pushErr.message || pushErr}`;
          console.error(`[Remind Post Cron] ${pushErrStr}`);
          diagnostics.errors.push(pushErrStr);
        }
      }
    }

    diagnostics.step = 'completed';
    return NextResponse.json({ 
      success: true, 
      processed: diagnostics.remindedUsers.length, 
      diagnostics
    })

  } catch (error: any) {
    console.error("[Remind Post Cron] Fatal Error:", error)
    diagnostics.fatalError = error.message;
    return NextResponse.json({ error: error.message, diagnostics }, { status: 500 })
  }
}
