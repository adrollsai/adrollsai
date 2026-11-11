import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureTenantSite } from '@/lib/automation/site-builder'

/**
 * Website builder cron.
 *
 * "Your website gets made once onboarding is done" was previously false:
 * onboarding never touched `landing_pages`, and the only writer was a manual
 * button whose LLM call often blew its 60s budget, leaving a self-refreshing
 * placeholder behind forever.
 *
 * This runs the deterministic builder (lib/automation/site-builder.ts) for every
 * tenant that has completed onboarding, has website_autobuild enabled, and has
 * no site yet. It never overwrites a page the tenant generated themselves.
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

const MAX_PER_RUN = 40

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

    const { data: policies, error: polErr } = await supabaseAdmin
      .from('tenant_automations')
      .select('user_id')
      .eq('master_enabled', true)
      .eq('website_autobuild', true)

    if (polErr) throw polErr

    const tenantIds = (policies || []).map((p) => p.user_id)
    if (!tenantIds.length) {
      return NextResponse.json({ success: true, built: 0, message: 'No tenants with website autobuild' })
    }

    // Only tenants who finished onboarding, and (unless forced) have no page yet.
    const { data: eligibleProfiles, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('id', tenantIds)
      .eq('onboarding_completed', true)
      .limit(MAX_PER_RUN)

    if (profErr) throw profErr

    const { data: withPages } = await supabaseAdmin
      .from('landing_pages')
      .select('user_id')
      .in('user_id', (eligibleProfiles || []).map((p) => p.id))
      .eq('slug', 'index')

    const hasPage = new Set((withPages || []).map((r: any) => r.user_id))

    const built: string[] = []
    const skipped: Record<string, number> = {}

    for (const p of eligibleProfiles || []) {
      if (!force && hasPage.has(p.id)) {
        skipped.already_exists = (skipped.already_exists || 0) + 1
        continue
      }
      const res = await ensureTenantSite(supabaseAdmin, p.id, { force })
      if (res.created) built.push(p.id)
      else if (res.skipped) skipped[res.skipped] = (skipped[res.skipped] || 0) + 1
    }

    console.log(`[Website Builder] built=${built.length} skipped=${JSON.stringify(skipped)}`)

    return NextResponse.json({
      success: true,
      candidates: (eligibleProfiles || []).length,
      built: built.length,
      skipped,
    })
  } catch (err: any) {
    console.error('[Website Builder] Fatal:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
