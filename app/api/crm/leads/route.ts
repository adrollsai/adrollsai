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
    const parentId = profile?.parent_id || profile?.agency_id
    const isTeamUser = !!(parentId || role === 'agent' || role === 'team_member')

    let targetOwnerId = user.id
    if (impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined' && impersonateId !== user.id) {
      targetOwnerId = impersonateId
    } else if (isTeamUser && parentId) {
      targetOwnerId = parentId
    }

    const limitParam = url.searchParams.get('limit')
    const maxLeadsToFetch = limitParam ? parseInt(limitParam, 10) : 5000

    let allLeads: any[] = []
    let page = 0
    const PAGE_SIZE = 1000
    let hasMore = true

    while (hasMore && allLeads.length < maxLeadsToFetch) {
      let query = supabaseAdmin
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (role === 'agent' || role === 'team_member') {
        query = query.or(`assigned_to.eq.${user.id},user_id.eq.${user.id}`)
      } else {
        query = query.or(`user_id.eq.${targetOwnerId},assigned_to.eq.${targetOwnerId}`)
      }

      const { data: leadsBatch, error } = await query
      if (error) {
        console.error('[API CRM Leads] Fetch error:', error)
        break
      }

      if (!leadsBatch || leadsBatch.length === 0) {
        hasMore = false
      } else {
        allLeads = allLeads.concat(leadsBatch)
        page++
        if (leadsBatch.length < PAGE_SIZE) hasMore = false
      }
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
