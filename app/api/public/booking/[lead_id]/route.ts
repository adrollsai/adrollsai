import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Public, capability-scoped booking lookup.
 *
 * WHY THIS EXISTS
 * Booking links are sent to end customers, so the booking pages are anonymous.
 * They used to read the `leads` table directly with the browser (anon) client,
 * which — together with the `USING (true)` RLS policies — let anyone holding the
 * public anon key dump every tenant's leads (39,112 rows at the time of writing).
 *
 * Instead of granting `anon` any access to `leads`, the pages now call this
 * service-role endpoint with the lead's UUID, which acts as an unguessable
 * capability token. Enumeration is no longer possible.
 */
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ lead_id: string }> }
) {
  const { lead_id } = await params

  if (!UUID_RE.test(lead_id || '')) {
    return NextResponse.json({ error: 'Invalid booking reference' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .maybeSingle()

  if (error) {
    console.error('[public/booking] lookup failed:', error.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(
    { lead: data },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
