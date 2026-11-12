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

/** Hard ceiling on rows per response.
 *
 * WHY THIS EXISTS: this route used to ignore `page`/`limit` and assemble every
 * matching lead - for a workspace with 16k leads that was 11,000 rows and a
 * 19.05 MB JSON body. Vercel caps a function response at 4.5 MB, so the
 * response could not be delivered at all. Paging keeps every response small.
 */
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

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

    const limit = Math.min(
      parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT),
      MAX_LIMIT
    )
    const page = parsePositiveInt(url.searchParams.get('page'), 1)
    const from = (page - 1) * limit
    const to = from + limit - 1

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

    // One page of rows plus the exact total, concurrently.
    const pagePromise = applyFilters(supabaseAdmin.from('leads').select(leadFields))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    const countPromise = applyFilters(
      supabaseAdmin.from('leads').select('*', { count: 'exact', head: true })
    )

    const [pageRes, countRes] = await Promise.all([pagePromise, countPromise])

    if (pageRes.error) {
      console.error('[API CRM Leads] page query failed:', pageRes.error)
      return NextResponse.json({ error: pageRes.error.message || 'Query failed' }, { status: 500 })
    }

    const totalCount = countRes.count ?? pageRes.data?.length ?? 0

    // Parse custom_fields quickly
    const parsedLeads = (pageRes.data || []).map((lead: any) => {
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
      totalCount,
      page,
      limit,
      hasMore: to + 1 < totalCount,
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
