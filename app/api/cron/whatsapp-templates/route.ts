import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { registerDefaultTemplates } from '@/utils/whatsapp/template-seeder'

/**
 * WhatsApp template backfill.
 *
 * Templates are normally submitted to Meta only when a tenant connects WhatsApp.
 * Tenants that connected before the daily-creative and weekly templates existed
 * therefore have neither — and since business-initiated messages MUST be
 * templates, their creative delivery and weekly message cannot be delivered.
 *
 * This walks connected WABAs and re-runs the (idempotent) seeder, which first
 * fetches the tenant's existing Meta templates and skips the ones already there.
 * Results are persisted so it is visible which templates Meta accepted.
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

/** WABAs per invocation — each tenant costs several Meta API round-trips. */
const BATCH = 3
/** Re-check a tenant at most weekly. */
const STALE_DAYS = 7

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
    const force = new URL(request.url).searchParams.get('force') === 'true'
    const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString()

    // Connected tenants only.
    const { data: connected, error: connErr } = await supabaseAdmin
      .from('profiles')
      .select('id, whatsapp_access_token, whatsapp_waba_id')
      .not('whatsapp_access_token', 'is', null)
      .not('whatsapp_waba_id', 'is', null)
      .limit(500)

    if (connErr) throw connErr

    const candidates = (connected || []).filter(
      (p) => String(p.whatsapp_access_token || '').length > 10 && String(p.whatsapp_waba_id || '').length > 5
    )

    const ids = candidates.map((c) => c.id)

    const { data: state } = await supabaseAdmin
      .from('whatsapp_template_seed_state')
      .select('user_id, seeded_at')
      .in('user_id', ids)

    const seededAt = new Map<string, string>((state || []).map((s: any) => [s.user_id, s.seeded_at]))

    const due = candidates.filter((c) => {
      if (force) return true
      const last = seededAt.get(c.id)
      return !last || last < staleBefore
    })

    const batch = due.slice(0, BATCH)
    const processed: any[] = []

    for (const tenant of batch) {
      try {
        const result = await registerDefaultTemplates(
          supabaseAdmin,
          tenant.id,
          String(tenant.whatsapp_access_token),
          String(tenant.whatsapp_waba_id)
        )

        const results = (result as any)?.results || []
        const failedNames = results.filter((r: any) => r && r.success === false).map((r: any) => r.name)

        await supabaseAdmin
          .from('whatsapp_template_seed_state')
          .upsert(
            {
              user_id: tenant.id,
              waba_id: String(tenant.whatsapp_waba_id),
              seeded_at: new Date().toISOString(),
              results: results,
              error: (result as any)?.success === false ? String((result as any)?.error || 'unknown') : null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )

        processed.push({ userId: tenant.id, ok: (result as any)?.success !== false, failed: failedNames })
      } catch (err: any) {
        const message = err?.message || String(err)
        console.error(`[Template Backfill] ${tenant.id} failed:`, message)
        await supabaseAdmin
          .from('whatsapp_template_seed_state')
          .upsert(
            { user_id: tenant.id, waba_id: String(tenant.whatsapp_waba_id), seeded_at: new Date().toISOString(), error: message, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          )
        processed.push({ userId: tenant.id, ok: false, error: message })
      }
    }

    if (processed.length) {
      console.log(`[Template Backfill] due=${due.length} processed=${processed.length}`)
    }

    return NextResponse.json({
      success: true,
      connected: candidates.length,
      due: due.length,
      processed: processed.length,
      details: processed,
      remaining: Math.max(0, due.length - processed.length),
    })
  } catch (err: any) {
    console.error('[Template Backfill] Fatal:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
