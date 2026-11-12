/* eslint-disable @typescript-eslint/no-explicit-any --
 * The generated supabase/database.types.ts is stale (it is missing tables and
 * columns this code legitimately uses), so typing these Supabase calls against
 * it would produce false errors. `any` is the same choice utils/credits.ts and
 * utils/voice-helper.ts make for the same reason.
 */import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncVideoTasksForUser } from '@/utils/video-sync-helper'

/**
 * Video watchdog.
 *
 * `syncVideoTasksForUser` already self-heals a task whose provider callback was
 * lost — but its only callers were dashboard page loads. So a video whose
 * callback never arrived stayed `Processing` forever and its asset stayed on
 * https://designs.adrolls.in/processing, invisible as a real video, until the
 * tenant happened to open the dashboard.
 *
 * This sweeps stale `Processing` tasks and runs the existing sync for each
 * affected tenant, so recovery no longer depends on a human visiting a page.
 */

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 120

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/** A task untouched for this long is presumed to have lost its callback. */
const STALE_MINUTES = 20
/** Tenants per invocation. */
const MAX_TENANTS = 5

export async function GET(request: Request) {
  return handle(request)
}
export async function POST(request: Request) {
  return handle(request)
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return process.env.NODE_ENV !== 'production'
  const header = request.headers.get('authorization') || ''
  const url = new URL(request.url)
  const provided = header.replace(/^Bearer\s+/i, '') || url.searchParams.get('cronSecret') || ''
  return provided === expected
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()

    const { data: stale, error } = await supabaseAdmin
      .from('video_tasks')
      .select('user_id, updated_at')
      .eq('status', 'Processing')
      .lt('updated_at', cutoff)
      .limit(200)

    if (error) throw error

    const tenants = Array.from(new Set((stale || []).map((t: any) => t.user_id))).filter(Boolean) as string[]

    const batch = tenants.slice(0, MAX_TENANTS)

    // syncVideoTasksForUser accepts an array of user ids and builds its own
    // admin client internally.
    let syncedCount = 0
    const failures: Array<{ tenant: string; error: string }> = []

    if (batch.length) {
      try {
        const result = await syncVideoTasksForUser(batch)
        syncedCount = result?.synced?.length ?? 0
      } catch (err: any) {
        const message = err?.message || String(err)
        console.error('[Video Watchdog] sync failed:', message)
        failures.push({ tenant: batch.join(','), error: message })
      }
    }

    if (tenants.length) {
      console.log(`[Video Watchdog] staleTasks=${stale?.length ?? 0} tenants=${tenants.length} synced=${syncedCount} failed=${failures.length}`)
    }

    return NextResponse.json({
      success: true,
      staleTasks: stale?.length ?? 0,
      tenants: tenants.length,
      synced: syncedCount,
      failed: failures.length,
      remaining: Math.max(0, tenants.length - batch.length),
    })
  } catch (err: any) {
    console.error('[Video Watchdog] Fatal:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
