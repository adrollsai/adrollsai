import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')

    // Fetch current user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, agency_id')
      .eq('id', user.id)
      .single()

    const role = profile?.role?.toLowerCase() || 'admin'
    const isTeamUser = role === 'agent' || role === 'team_member'

    let targetOwnerId = user.id
    if (impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined' && impersonateId !== user.id) {
      targetOwnerId = impersonateId
    } else if (isTeamUser && (profile?.parent_id || profile?.agency_id)) {
      targetOwnerId = profile.parent_id || profile.agency_id || user.id
    }

    let workspaceTeamIds: string[] = [targetOwnerId]
    if (!isTeamUser) {
      const { data: teamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)

      if (teamProfiles && teamProfiles.length > 0) {
        workspaceTeamIds = Array.from(new Set(teamProfiles.map(p => p.id)))
      }
    }

    const limitParam = url.searchParams.get('limit')
    const requestedLimit = limitParam ? parseInt(limitParam, 10) : 0

    let allLeads: any[] = []
    let page = 0
    const PAGE_SIZE = 1000
    let hasMore = true

    while (hasMore && (requestedLimit === 0 || allLeads.length < requestedLimit) && page < 20) {
      let query = supabaseAdmin
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (isTeamUser) {
        query = query.or(`assigned_to.eq.${user.id},user_id.eq.${user.id}`)
      } else {
        const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',')
        query = query.or(workspaceOrConditions)
      }

      const { data: batch, error } = await query
      if (error) {
        console.error('[API CRM Leads] Fetch error:', error)
        break
      }

      if (!batch || batch.length === 0) {
        hasMore = false
      } else {
        allLeads = allLeads.concat(batch)
        page++
        if (batch.length < PAGE_SIZE) hasMore = false
      }
    }

    if (requestedLimit > 0 && allLeads.length > requestedLimit) {
      allLeads = allLeads.slice(0, requestedLimit)
    }

    // Parse custom_fields
    const parsedLeads = allLeads.map(lead => {
      let cf = lead.custom_fields
      if (cf && typeof cf === 'string') {
        try {
          while (typeof cf === 'string') cf = JSON.parse(cf)
        } catch (e) {
          cf = {}
        }
      }
      return { ...lead, custom_fields: cf }
    })

    return NextResponse.json({
      success: true,
      leads: parsedLeads,
      totalCount: parsedLeads.length
    })
  } catch (error: any) {
    console.error('[API CRM Leads] Server error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
