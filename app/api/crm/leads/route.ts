import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, form_name, next_followup, assigned_to, budget, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience, whatsapp_enabled'

export async function GET(req: Request) {
  try {
    let user: any = null
    const authHeader = req.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim()
      const { data: userData } = await supabaseAdmin.auth.getUser(token)
      if (userData?.user) user = userData.user
    }

    if (!user) {
      try {
        const supabase = await createClient()
        const { data: sessionData } = await supabase.auth.getUser()
        if (sessionData?.user) user = sessionData.user
      } catch (e) {}
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')
    const fetchAll = url.searchParams.get('all') === 'true'

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

    const applyFilters = (q: any) => {
      if (isTeamUser) {
        return q.or(`assigned_to.eq.${user.id},user_id.eq.${user.id}`)
      } else {
        const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',')
        return q.or(workspaceOrConditions)
      }
    }

    // 1. Execute count query and primary leads query concurrently
    const baseQuery = supabaseAdmin.from('leads').select(leadFields)
    const firstPagePromise = applyFilters(baseQuery)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 999)

    const countPromise = applyFilters(supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }))

    const [firstPageRes, countRes] = await Promise.all([firstPagePromise, countPromise])

    const totalCount = countRes.count || (firstPageRes.data?.length || 0)
    let allLeads: any[] = firstPageRes.data || []

    // If more than 1000 leads, fetch remaining pages in parallel
    if (totalCount > 1000) {
      const remainingPagesNeeded = Math.min(Math.ceil(totalCount / 1000) - 1, 10)
      const remainingPromises = Array.from({ length: remainingPagesNeeded }, (_, i) => {
        const pageIdx = i + 1
        const q = applyFilters(supabaseAdmin.from('leads').select(leadFields))
        return q
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(pageIdx * 1000, (pageIdx + 1) * 1000 - 1)
      })

      const remainingResults = await Promise.all(remainingPromises)
      for (const r of remainingResults) {
        if (r.data && r.data.length > 0) {
          allLeads = allLeads.concat(r.data)
        }
      }
    }

    // Parse custom_fields quickly
    const parsedLeads = allLeads.map(lead => {
      let cf = lead.custom_fields
      if (cf && typeof cf === 'string') {
        try {
          while (typeof cf === 'string') cf = JSON.parse(cf)
        } catch (e) {
          cf = {}
        }
      }
      return { ...lead, custom_fields: cf || {} }
    })

    return NextResponse.json({
      success: true,
      leads: parsedLeads,
      totalCount: totalCount
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    })
  } catch (error: any) {
    console.error('[API CRM Leads] Server error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
