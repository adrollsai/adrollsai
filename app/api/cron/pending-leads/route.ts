import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
    return handlePendingLeads(request);
}

export async function POST(request: Request) {
    return handlePendingLeads(request);
}

async function handlePendingLeads(request: Request) {
  const diagnostics: Record<string, any> = {
    step: 'start',
    timestamp: new Date().toISOString(),
    totalSubscriptions: 0,
    uniqueUsers: 0,
    notifiedUsers: [],
    errors: []
  };

  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    console.log(`[Pending Leads Cron] Triggered at ${diagnostics.timestamp}`);

    // Enforce security verification using our global environment CRON_SECRET if configured
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn(`[Pending Leads Cron] Unauthorized access attempt.`);
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

    // 1. Fetch active push subscribers
    diagnostics.step = 'fetch_subscriptions';
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('user_id, catalog_owner_id')

    if (subError) throw subError;

    if (!subscriptions || subscriptions.length === 0) {
      diagnostics.step = 'end_no_subscriptions';
      return NextResponse.json({ 
        success: true, 
        processed: 0, 
        message: "No push subscribers found in database",
        diagnostics
      })
    }

    const allUserIds = subscriptions.flatMap(s => [s.user_id, s.catalog_owner_id]).filter(Boolean) as string[];
    const uniqueUserIds = Array.from(new Set(allUserIds));

    diagnostics.totalSubscriptions = subscriptions.length;
    diagnostics.uniqueUsers = uniqueUserIds.length;
    diagnostics.step = 'check_leads';

    let processedReminders = 0;

    // 2. Scan pending leads for each active subscriber
    for (const userId of uniqueUserIds) {
      // Get the profile to determine their role
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()

      if (profileError || !profile) {
        console.error(`[Pending Leads Cron] Could not find profile for ${userId}`);
        continue;
      }

      // Query leads assigned to this user
      const { data: assignedLeads, error: assignedError } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('assigned_to', userId)
        .eq('pipeline_stage', 'New')

      let totalNew = assignedLeads?.length || 0;
      let unassignedCount = 0;

      // If the user is an admin/agency, also check for unassigned leads in their workspace
      const isAdminRole = ['super_admin', 'agency', 'admin'].includes(profile.role);
      if (isAdminRole) {
        const { data: unassignedLeads, error: unassignedError } = await supabaseAdmin
          .from('leads')
          .select('id')
          .eq('user_id', userId)
          .is('assigned_to', null)
          .eq('pipeline_stage', 'New')

        unassignedCount = unassignedLeads?.length || 0;
        totalNew += unassignedCount;
      }

      // Send high-priority alert if they have pending new leads!
      if (totalNew > 0) {
        try {
          const title = isAdminRole
            ? `🔥 CRM Alert: ${totalNew} New Leads Awaiting Action!`
            : `🚨 Action Required: ${totalNew} New Leads Pending!`;

          const body = isAdminRole
            ? `You have ${totalNew} unassigned or new leads waiting in your CRM pipeline. Assign or contact them now to maintain a sub-5 minute response time!`
            : `You have ${totalNew} new leads assigned to you. Contact them immediately to maximize booking rate and conversion!`;

          await sendPushNotification(
            userId,
            title,
            body,
            "/dashboard/crm",
            "lead_alert"
          )

          processedReminders++;
          diagnostics.notifiedUsers.push({ userId, role: profile.role, count: totalNew });
          console.log(`[Pending Leads Cron] Sent high-priority push to user ${userId} (${totalNew} pending leads).`);
        } catch (pushErr: any) {
          console.error(`[Pending Leads Cron] Push failed for user ${userId}:`, pushErr);
          diagnostics.errors.push(`Push failed for ${userId}: ${pushErr.message || pushErr}`);
        }
      }
    }

    diagnostics.step = 'completed';
    return NextResponse.json({ 
      success: true, 
      processed: processedReminders, 
      diagnostics
    })

  } catch (error: any) {
    console.error("[Pending Leads Cron] Fatal Error:", error)
    diagnostics.fatalError = error.message;
    return NextResponse.json({ error: error.message, diagnostics }, { status: 500 })
  }
}
