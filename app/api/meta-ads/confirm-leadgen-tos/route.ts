import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logToFile } from '@/utils/logger'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { pageId, impersonateId } = body

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role, agency_id, parent_id, business_info, selected_page_id')
      .eq('id', user.id)
      .single()

    let targetUserId = user.id
    if (impersonateId && impersonateId !== user.id) {
      if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
        targetUserId = impersonateId
      }
    }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('id, business_info, selected_page_id')
      .eq('id', targetUserId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const effectivePageId = pageId || targetProfile.selected_page_id || ''

    let bi: Record<string, any> = {}
    if (targetProfile.business_info) {
      try {
        bi = typeof targetProfile.business_info === 'string'
          ? JSON.parse(targetProfile.business_info)
          : targetProfile.business_info
      } catch (e) {
        bi = {}
      }
    }

    bi.leadgen_tos_accepted = true
    bi.leadgen_tos_override = true
    bi.leadgen_tos_confirmed_at = new Date().toISOString()
    
    const pages = Array.isArray(bi.leadgen_tos_accepted_pages) ? bi.leadgen_tos_accepted_pages : []
    if (effectivePageId && !pages.includes(effectivePageId)) {
      pages.push(effectivePageId)
    }
    bi.leadgen_tos_accepted_pages = pages

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        business_info: JSON.stringify(bi)
      })
      .eq('id', targetUserId)

    if (updateErr) {
      logToFile(`[Confirm-TOS API] Failed to update profile: ${updateErr.message}`)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    logToFile(`[Confirm-TOS API] Successfully confirmed leadgen TOS for user ${targetUserId}, page: ${effectivePageId}`)

    return NextResponse.json({
      success: true,
      message: 'Lead Generation Terms marked as accepted successfully.',
      pageId: effectivePageId
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
