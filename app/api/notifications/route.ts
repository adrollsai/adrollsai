import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

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

  // Check if current user is admin/super_admin or impersonating
  let targetId = user?.id

  if (impersonateId) {
    if (user) {
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .maybeSingle()

      if (callerProfile?.role === 'super_admin' || callerProfile?.role === 'agency' || callerProfile?.role === 'admin' || user.id === impersonateId) {
        targetId = impersonateId
      }
    } else {
      targetId = impersonateId
    }
  }

  return targetId || null
}

// GET: List notifications & unread count
export async function GET(request: Request) {
  try {
    const targetUserId = await getTargetUserId(request)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const type = url.searchParams.get('type') // optional filter
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)

    let query = supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (type && type !== 'all') {
      query = query.eq('type', type)
    }

    const { data: notifications, error } = await query

    if (error) throw error

    // Fetch unread count
    const { count: unreadCount, error: countErr } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', targetUserId)
      .eq('is_read', false)

    if (countErr) console.error('[Notifications GET unread count error]:', countErr)

    return NextResponse.json({
      success: true,
      notifications: notifications || [],
      unreadCount: unreadCount || 0
    })
  } catch (err: any) {
    console.error('[Notifications GET Error]:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

// PATCH / POST: Mark as read
export async function PATCH(request: Request) {
  try {
    const targetUserId = await getTargetUserId(request)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { notificationId, markAll = false } = body

    if (markAll) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', targetUserId)
        .eq('is_read', false)

      if (error) throw error

      return NextResponse.json({ success: true, message: 'All notifications marked as read' })
    }

    if (notificationId) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('user_id', targetUserId)

      if (error) throw error

      return NextResponse.json({ success: true, message: 'Notification marked as read' })
    }

    return NextResponse.json({ error: 'Missing notificationId or markAll flag' }, { status: 400 })
  } catch (err: any) {
    console.error('[Notifications PATCH Error]:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

// DELETE: Remove notification(s)
export async function DELETE(request: Request) {
  try {
    const targetUserId = await getTargetUserId(request)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const notificationId = url.searchParams.get('id')
    const clearAll = url.searchParams.get('clearAll') === 'true'

    if (clearAll) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('user_id', targetUserId)

      if (error) throw error

      return NextResponse.json({ success: true, message: 'All notifications cleared' })
    }

    if (notificationId) {
      const { error } = await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('id', notificationId)
        .eq('user_id', targetUserId)

      if (error) throw error

      return NextResponse.json({ success: true, message: 'Notification deleted' })
    }

    return NextResponse.json({ error: 'Missing id or clearAll param' }, { status: 400 })
  } catch (err: any) {
    console.error('[Notifications DELETE Error]:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
