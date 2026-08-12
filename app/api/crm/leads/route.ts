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
    const maxLeadsToFetch = limitParam ? parseInt(limitParam, 10) : 1000

    let leads1Query = supabaseAdmin.from('leads').select('*').order('created_at', { ascending: false }).limit(maxLeadsToFetch)
    let leads2Query = supabaseAdmin.from('leads').select('*').order('created_at', { ascending: false }).limit(maxLeadsToFetch)

    if (isTeamUser) {
      leads1Query = leads1Query.eq('assigned_to', user.id)
      leads2Query = leads2Query.eq('user_id', user.id)
    } else {
      leads1Query = leads1Query.in('user_id', workspaceTeamIds)
      leads2Query = leads2Query.in('assigned_to', workspaceTeamIds)
    }

    const [{ data: leads1 }, { data: leads2 }] = await Promise.all([leads1Query, leads2Query])

    const leadMap = new Map<string, any>()
    ;(leads1 || []).forEach(l => leadMap.set(l.id, l))
    ;(leads2 || []).forEach(l => leadMap.set(l.id, l))

    const allLeads = Array.from(leadMap.values())
    allLeads.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

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
