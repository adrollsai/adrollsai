import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  isUserAdminRole,
  normalizeUserPreferences,
  getDefaultPreferences,
  UserNotificationPreferences
} from '@/utils/notification-preferences'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getTargetUserId(request: Request) {
  const supabase = await createClient()
  let { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) user = session.user
  }

  const authHeader = request.headers.get('Authorization')
  if (!user && authHeader) {
    const token = authHeader.replace('Bearer ', '').trim()
    if (token) {
      const { data: authUserData } = await supabaseAdmin.auth.getUser(token)
      if (authUserData?.user) user = authUserData.user
    }
  }

  const url = new URL(request.url)
  const impersonateId = url.searchParams.get('impersonate')

  let targetId = user?.id

  if (impersonateId) {
    if (user) {
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .maybeSingle()

      if (
        callerProfile?.role === 'super_admin' ||
        callerProfile?.role === 'agency' ||
        callerProfile?.role === 'admin' ||
        user.id === impersonateId
      ) {
        targetId = impersonateId
      }
    } else {
      targetId = impersonateId
    }
  }

  return { targetUserId: targetId || null, authenticatedUser: user }
}

// GET: Fetch notification preferences & admin status
export async function GET(request: Request) {
  try {
    const { targetUserId } = await getTargetUserId(request)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, role, notification_preferences, email, full_name, business_name')
      .eq('id', targetUserId)
      .maybeSingle()

    if (error) throw error

    const isAdmin = isUserAdminRole(profile?.role)
    const preferences = normalizeUserPreferences(profile?.notification_preferences, isAdmin)

    return NextResponse.json({
      success: true,
      isAdmin,
      role: profile?.role || 'agent',
      preferences
    })
  } catch (err: any) {
    console.error('[Notification Preferences GET Error]:', err)
    return NextResponse.json({ error: err.message || 'Failed to load preferences' }, { status: 500 })
  }
}

// POST / PATCH: Save notification preferences
export async function POST(request: Request) {
  try {
    const { targetUserId } = await getTargetUserId(request)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { preferences, reset = false } = body

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', targetUserId)
      .maybeSingle()

    if (profileErr) throw profileErr

    const isAdmin = isUserAdminRole(profile?.role)

    let finalPreferences: UserNotificationPreferences

    if (reset) {
      finalPreferences = getDefaultPreferences(isAdmin)
    } else {
      // Normalize and strictly enforce that agents CANNOT enable WhatsApp
      finalPreferences = normalizeUserPreferences(preferences, isAdmin)
    }

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        notification_preferences: finalPreferences
      })
      .eq('id', targetUserId)

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      message: 'Notification preferences updated successfully',
      isAdmin,
      preferences: finalPreferences
    })
  } catch (err: any) {
    console.error('[Notification Preferences POST Error]:', err)
    return NextResponse.json({ error: err.message || 'Failed to update preferences' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  return POST(request)
}
