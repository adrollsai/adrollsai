/* eslint-disable @typescript-eslint/no-explicit-any --
 * The generated supabase/database.types.ts is stale (it is missing tables and
 * columns this code legitimately uses), so typing these Supabase calls against
 * it would produce false errors. `any` is the same choice utils/credits.ts and
 * utils/voice-helper.ts make for the same reason.
 */import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTenantSite } from '@/lib/automation/site-builder'

/**
 * Website builder worker.
 *
 * Deliberately NOT long-running. The old generator called an LLM inside the
 * request, routinely exceeded its 60s budget, and left a self-refreshing
 * placeholder on the public URL forever.
 *
 * Here every unit of work is a durable row in `site_build_jobs`:
 *   tick -> claim_site_build_jobs() -> build (fast, template-based) -> mark done
 * A job takes milliseconds. If the platform kills the invocation, the lease
 * expires and the next tick retries it. Nothing depends on Vercel's budget.
 */

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/** Small batches keep each tick far inside any function limit. */
const BATCH = 5
const ENQUEUE_LIMIT = 500

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
    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'

    // 1. Top up the queue (idempotent; partial unique index prevents duplicates).
    let enqueued = 0
    const { data: enq, error: enqErr } = await supabaseAdmin
      .rpc('enqueue_missing_sites', { p_limit: ENQUEUE_LIMIT })
    if (enqErr) {
      console.warn('[Website Builder] enqueue failed:', enqErr.message)
    } else {
      enqueued = Number(enq) || 0
    }

    // 2. Claim a small batch with a lease.
    const { data: jobs, error: claimErr } = await supabaseAdmin
      .rpc('claim_site_build_jobs', { p_limit: BATCH })

    if (claimErr) throw claimErr

    const built: string[] = []
    const failed: Array<{ userId: string; error: string }> = []
    const skipped: Record<string, number> = {}

    for (const job of jobs || []) {
      try {
        const res = await ensureTenantSite(supabaseAdmin, job.user_id, { force })

        if (res.created) {
          built.push(job.user_id)
          await supabaseAdmin
            .from('site_build_jobs')
            .update({
              status: 'completed',
              locked_until: null,
              result: { bytes: res.bytes ?? null },
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
        } else {
          // Nothing to do (already exists / no name yet) — close the job so it
          // does not spin, and record why.
          skipped[res.skipped || 'unknown'] = (skipped[res.skipped || 'unknown'] || 0) + 1
          await supabaseAdmin
            .from('site_build_jobs')
            .update({
              status: 'completed',
              locked_until: null,
              result: { skipped: res.skipped },
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
        }
      } catch (err: any) {
        const message = err?.message || String(err)
        failed.push({ userId: job.user_id, error: message })
        console.error(`[Website Builder] job ${job.id} failed:`, message)

        // Leave the job open if attempts remain; the lease expiry makes it
        // eligible again on the next tick. Give up after max_attempts.
        const exhausted = Number(job.attempts) >= Number(job.max_attempts)
        await supabaseAdmin
          .from('site_build_jobs')
          .update({
            status: exhausted ? 'failed' : 'pending',
            locked_until: null,
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      }
    }

    if (built.length || failed.length) {
      console.log(`[Website Builder] enqueued=${enqueued} built=${built.length} failed=${failed.length} skipped=${JSON.stringify(skipped)}`)
    }

    return NextResponse.json({
      success: true,
      enqueued,
      claimed: (jobs || []).length,
      built: built.length,
      failed: failed.length,
      skipped,
    })
  } catch (err: any) {
    console.error('[Website Builder] Fatal:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
