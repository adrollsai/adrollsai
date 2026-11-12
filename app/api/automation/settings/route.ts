/* eslint-disable @typescript-eslint/no-explicit-any --
 * The generated supabase/database.types.ts is stale (it is missing tables and
 * columns this code legitimately uses), so typing these Supabase calls against
 * it would produce false errors. `any` is the same choice utils/credits.ts and
 * utils/voice-helper.ts make for the same reason.
 */import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * Automation settings for the signed-in tenant.
 *
 * `tenant_automations` is the single source of truth every cron reads. It is
 * default-ON for new accounts; this endpoint is what lets a tenant switch the
 * whole workflow off, or switch off individual features (e.g. "no videos").
 */

const BOOLEAN_FIELDS = [
  'master_enabled',
  'daily_creative',
  'video_reel',
  'weekly_whatsapp',
  'ai_calling',
  'website_autobuild',
  'bill_automation',
] as const

const NUMBER_FIELDS: Array<{ key: string; min: number; max: number }> = [
  { key: 'creative_hour_local', min: 0, max: 23 },
  { key: 'video_cadence_days', min: 1, max: 30 },
  { key: 'weekly_send_dow', min: 0, max: 6 },
  { key: 'call_window_start', min: 0, max: 23 },
  { key: 'call_window_end', min: 0, max: 23 },
  { key: 'call_max_attempts', min: 1, max: 60 },
  { key: 'call_tail_days', min: 1, max: 365 },
  { key: 'call_max_age_days', min: 1, max: 1095 },
]

const SELECT_COLS =
  'user_id, master_enabled, daily_creative, video_reel, weekly_whatsapp, ai_calling, website_autobuild, timezone, creative_hour_local, video_cadence_days, weekly_send_dow, call_window_start, call_window_end, call_cadence, call_max_attempts, call_tail_days, call_max_age_days, call_fresh_stages, bill_automation, updated_at'

async function resolveUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await resolveUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Row should exist (onboarding/provisioning creates it) — create defensively.
  const first = await admin
    .from('tenant_automations')
    .select(SELECT_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  const error = first.error
  let data = first.data

  if (!data && !error) {
    const { data: created } = await admin
      .from('tenant_automations')
      .insert({ user_id: user.id })
      .select(SELECT_COLS)
      .single()
    data = created
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Could not load automation settings' }, { status: 500 })

  // Surface whether WhatsApp is connected — a few features are inert without it.
  const { data: profile } = await admin
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_personal_number, contact_number, google_refresh_token, voice_twilio_number, voice_vobiz_number')
    .eq('id', user.id)
    .single()

  return NextResponse.json({
    settings: data,
    whatsappConnected: !!profile?.whatsapp_access_token && !!profile?.whatsapp_phone_number_id,
    deliveryNumber: profile?.whatsapp_personal_number || profile?.contact_number || null,
    googleConnected: !!profile?.google_refresh_token,
    telephonyConfigured: !!(profile?.voice_twilio_number || profile?.voice_vobiz_number),
  })
}

export async function PATCH(request: Request) {
  const user = await resolveUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: Record<string, any> = {}

  for (const f of BOOLEAN_FIELDS) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== 'boolean') {
        return NextResponse.json({ error: `${f} must be a boolean` }, { status: 400 })
      }
      patch[f] = body[f]
    }
  }

  for (const { key, min, max } of NUMBER_FIELDS) {
    if (body[key] !== undefined) {
      const n = Number(body[key])
      if (!Number.isFinite(n) || n < min || n > max) {
        return NextResponse.json({ error: `${key} must be a number between ${min} and ${max}` }, { status: 400 })
      }
      patch[key] = Math.round(n)
    }
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || body.timezone.length > 64) {
      return NextResponse.json({ error: 'timezone must be a string' }, { status: 400 })
    }
    patch.timezone = body.timezone
  }

  if (body.call_fresh_stages !== undefined) {
    if (!Array.isArray(body.call_fresh_stages) || body.call_fresh_stages.some((s: any) => typeof s !== 'string')) {
      return NextResponse.json({ error: 'call_fresh_stages must be an array of strings' }, { status: 400 })
    }
    patch.call_fresh_stages = body.call_fresh_stages.slice(0, 12)
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'No supported fields supplied' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Scoped to the caller's own row — never trust a user_id from the body.
  const { data, error } = await admin
    .from('tenant_automations')
    .update(patch)
    .eq('user_id', user.id)
    .select(SELECT_COLS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, settings: data })
}
