import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Helper to resolve effective user ID (supporting impersonation)
async function getEffectiveUserId(supabase: any, user: any, req: Request) {
  const url = new URL(req.url)
  const impersonateId = url.searchParams.get('impersonate')
  if (impersonateId && impersonateId !== user.id) {
    const { data: authProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const authRole = authProfile?.role?.toLowerCase() || ''
    if (['super_admin', 'agency', 'admin'].includes(authRole)) {
      return impersonateId
    }
  }
  return user.id
}

// GET: List all flows for workspace
export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const effectiveUserId = await getEffectiveUserId(supabase, user, req)

    const { data: rows, error } = await supabase
      .from('automations')
      .select('*')
      .eq('user_id', effectiveUserId)
      .like('title', 'Flow:%')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[FLOWS API GET Error]:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const flows = (rows || []).map(row => {
      let flowData: any = {}
      try {
        flowData = JSON.parse(row.description || '{}')
      } catch (e) {
        flowData = {}
      }

      let statsData: any = { runs: 0, completed: 0, lastTriggeredAt: null }
      try {
        if (row.stats) statsData = JSON.parse(row.stats)
      } catch (e) {}

      const cleanName = row.title.replace(/^Flow:\s*/, '')

      return {
        id: row.id,
        name: flowData.name || cleanName,
        description: flowData.description || '',
        icon: row.icon_name || flowData.icon || 'Workflow',
        isActive: row.is_active ?? true,
        createdAt: row.created_at,
        trigger: flowData.trigger || { type: 'meta_ad', label: 'Meta Ad Campaign' },
        nodes: flowData.nodes || [],
        edges: flowData.edges || [],
        settings: flowData.settings || {},
        stats: statsData
      }
    })

    return NextResponse.json({ success: true, flows })
  } catch (err: any) {
    console.error('[FLOWS API Fatal GET]:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

// POST: Create a new flow
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const effectiveUserId = await getEffectiveUserId(supabase, user, req)
    const body = await req.json()
    const { name, description, icon, isActive = true, trigger, nodes = [], edges = [], settings = {} } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Flow name is required' }, { status: 400 })
    }

    const payload = {
      name: name.trim(),
      description: description || '',
      icon: icon || 'Workflow',
      trigger: trigger || { type: 'meta_ad', label: 'Meta Ad Campaign' },
      nodes,
      edges,
      settings
    }

    const statsPayload = {
      runs: 0,
      completed: 0,
      lastTriggeredAt: null
    }

    const { data, error } = await supabase
      .from('automations')
      .insert({
        user_id: effectiveUserId,
        title: `Flow: ${name.trim()}`,
        description: JSON.stringify(payload),
        icon_name: icon || 'Workflow',
        is_active: isActive,
        stats: JSON.stringify(statsPayload),
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('[FLOWS API POST Error]:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      flow: {
        id: data.id,
        name: payload.name,
        description: payload.description,
        icon: data.icon_name,
        isActive: data.is_active,
        createdAt: data.created_at,
        trigger: payload.trigger,
        nodes: payload.nodes,
        edges: payload.edges,
        settings: payload.settings,
        stats: statsPayload
      }
    })
  } catch (err: any) {
    console.error('[FLOWS API Fatal POST]:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

// PUT: Update an existing flow
export async function PUT(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const effectiveUserId = await getEffectiveUserId(supabase, user, req)
    const body = await req.json()
    const { id, name, description, icon, isActive, trigger, nodes, edges, settings, stats } = body

    if (!id) {
      return NextResponse.json({ error: 'Flow ID is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: existing, error: fetchErr } = await supabase
      .from('automations')
      .select('*')
      .eq('id', id)
      .eq('user_id', effectiveUserId)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Flow not found or unauthorized' }, { status: 404 })
    }

    let existingPayload: any = {}
    try {
      existingPayload = JSON.parse(existing.description || '{}')
    } catch (e) {}

    const updatedPayload = {
      name: name !== undefined ? name.trim() : (existingPayload.name || existing.title.replace(/^Flow:\s*/, '')),
      description: description !== undefined ? description : existingPayload.description,
      icon: icon !== undefined ? icon : (existingPayload.icon || existing.icon_name),
      trigger: trigger !== undefined ? trigger : existingPayload.trigger,
      nodes: nodes !== undefined ? nodes : existingPayload.nodes,
      edges: edges !== undefined ? edges : existingPayload.edges,
      settings: settings !== undefined ? settings : existingPayload.settings
    }

    const updates: any = {
      title: `Flow: ${updatedPayload.name}`,
      description: JSON.stringify(updatedPayload)
    }

    if (icon !== undefined) updates.icon_name = icon
    if (isActive !== undefined) updates.is_active = Boolean(isActive)
    if (stats !== undefined) updates.stats = JSON.stringify(stats)

    const { data: updated, error: updateErr } = await supabase
      .from('automations')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) {
      console.error('[FLOWS API PUT Error]:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      flow: {
        id: updated.id,
        name: updatedPayload.name,
        description: updatedPayload.description,
        icon: updated.icon_name,
        isActive: updated.is_active,
        createdAt: updated.created_at,
        trigger: updatedPayload.trigger,
        nodes: updatedPayload.nodes,
        edges: updatedPayload.edges,
        settings: updatedPayload.settings,
        stats: stats || existing.stats
      }
    })
  } catch (err: any) {
    console.error('[FLOWS API Fatal PUT]:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

// DELETE: Delete a flow
export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const effectiveUserId = await getEffectiveUserId(supabase, user, req)
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Flow ID is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('automations')
      .delete()
      .eq('id', id)
      .eq('user_id', effectiveUserId)

    if (error) {
      console.error('[FLOWS API DELETE Error]:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Flow deleted successfully' })
  } catch (err: any) {
    console.error('[FLOWS API Fatal DELETE]:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
