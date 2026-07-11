import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: fetch }
  }
)

export async function GET(request: Request) {
  return handleEodReportDispatcher(request)
}

export async function POST(request: Request) {
  return handleEodReportDispatcher(request)
}

async function handleEodReportDispatcher(request: Request) {
  try {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

    console.log('[EOD Report Dispatcher] Triggered...')

    // Enforce security verification using our global environment CRON_SECRET if configured
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn('[EOD Report Dispatcher] Unauthorized access attempt.')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all main profiles with active email addresses (ignore agent roles)
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, enable_eod_report, role')
      .neq('role', 'agent')

    if (profileError) throw profileError

    // Filter profiles that have email and haven't explicitly disabled the EOD report
    const activeProfiles = profiles?.filter(p => p.email && p.enable_eod_report !== false) || []

    if (activeProfiles.length === 0) {
      return NextResponse.json({ success: true, processedCount: 0, message: 'No profiles scheduled for EOD report.' })
    }

    console.log(`[EOD Report Dispatcher] Queueing reports for ${activeProfiles.length} profiles...`)

    const qstashToken = process.env.QSTASH_TOKEN
    if (!qstashToken) {
      console.error('[EOD Report Dispatcher] QSTASH_TOKEN environment variable is not configured.')
      return NextResponse.json({ error: 'QStash not configured' }, { status: 500 })
    }

    // Construct the destination worker URL dynamically
    const workerUrl = `${url.origin}/api/cron/eod-report/worker`
    const publishPromises = activeProfiles.map(async (prof) => {
      const qstashPublishUrl = `https://qstash.upstash.io/v2/publish/${workerUrl}`;
      
      const res = await fetch(qstashPublishUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
        },
        body: JSON.stringify({ id: prof.id })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[EOD Report Dispatcher] Failed to queue profile ${prof.id}:`, errText);
      }
    });

    await Promise.all(publishPromises);
    console.log(`[EOD Report Dispatcher] Successfully queued ${activeProfiles.length} tasks in QStash.`);

    return NextResponse.json({ success: true, queuedCount: activeProfiles.length })
  } catch (error: any) {
    console.error('[EOD Report Dispatcher] Fatal Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
