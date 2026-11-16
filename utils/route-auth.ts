import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

/**
 * Shared authentication / authorisation helpers for API routes.
 *
 * Why this exists: several routes on this project authenticated by *trusting a
 * user id supplied in the request body or query string* (or used the service-role
 * client with no check at all). That let any caller act as any tenant. Every
 * route that writes or reads tenant data must establish **who is calling** from
 * the session or a Bearer token, and then prove that caller may act for the
 * target id.
 *
 * The service-role client bypasses RLS, so it must never be handed an id that
 * the caller was allowed to choose without the checks below.
 */

export const ADMIN_ROLES = ['super_admin', 'agency', 'admin'] as const

export type RouteUser = { id: string; email?: string | null }

export function serviceAdmin() {
  return createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Resolve the calling user from the session cookie first, then a Bearer token.
 * Returns `null` when the caller is anonymous.
 *
 * Deliberately does NOT accept a body/query supplied id.
 */
export async function requireUser(req: Request): Promise<RouteUser | null> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return { id: user.id, email: user.email }

    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) return { id: session.user.id, email: session.user.email }
  } catch {
    /* fall through to bearer */
  }

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) {
      try {
        const { data } = await serviceAdmin().auth.getUser(token)
        if (data?.user) return { id: data.user.id, email: data.user.email }
      } catch {
        /* invalid token */
      }
    }
  }

  return null
}

/** Load just the fields needed to make authorisation decisions. */
export async function loadCallerProfile(userId: string): Promise<{
  id: string
  role: string | null
  agency_id: string | null
  parent_id: string | null
} | null> {
  const { data } = await serviceAdmin()
    .from('profiles')
    .select('id, role, agency_id, parent_id')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return null
  return data as any
}

/**
 * May `callerId` act on data owned by `targetId`?
 *
 * Allowed when: same user; caller is admin-like (super_admin always, agency/
 * admin for their own sub-accounts); or the target is a sub-account of the
 * caller (target.agency_id / parent_id === caller). Anything else is refused.
 */
export async function canActForUser(callerId: string, targetId: string): Promise<boolean> {
  if (!callerId || !targetId) return false
  if (callerId === targetId) return true

  const admin = serviceAdmin()
  const caller = await loadCallerProfile(callerId)
  const role = String(caller?.role || '').toLowerCase()

  if (role === 'super_admin') return true

  if (role === 'agency' || role === 'admin') {
    // The target must belong to this caller's workspace.
    const { data: target } = await admin
      .from('profiles')
      .select('id, agency_id, parent_id')
      .eq('id', targetId)
      .maybeSingle()
    if (!target) return false
    return target.agency_id === callerId || target.parent_id === callerId
  }

  return false
}

/**
 * Resolve the effective "acting as" user for a request that supports
 * admin-on-behalf-of (impersonation), and authorise it.
 *
 * Returns `{ ok: true, userId }` or `{ ok: false, response }` ready to return.
 */
export async function resolveActingUser(
  req: Request,
  requestedTargetId?: string | null
): Promise<{ ok: true; userId: string; caller: RouteUser } | { ok: false; response: NextResponse }> {
  const caller = await requireUser(req)
  if (!caller) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const target = requestedTargetId && requestedTargetId !== 'null' && requestedTargetId !== 'undefined'
    ? requestedTargetId
    : caller.id

  if (target === caller.id) return { ok: true, userId: caller.id, caller }

  if (!(await canActForUser(caller.id, target))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: you cannot act for this account.' },
        { status: 403 }
      ),
    }
  }

  return { ok: true, userId: target, caller }
}
