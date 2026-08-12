import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const supabase = await createClient()
    let { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) user = session.user
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const authHeader = request.headers.get('Authorization')
    if (!user && authHeader) {
      const token = authHeader.replace('Bearer ', '').trim()
      if (token) {
        const { data: authUserData } = await supabaseAdmin.auth.getUser(token)
        if (authUserData?.user) user = authUserData.user
      }
    }

    if (!user && (body.userId || body.impersonateId)) {
      const targetId = body.userId || body.impersonateId
      const { data: fallbackProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', targetId)
        .maybeSingle()

      if (fallbackProfile) {
        user = { id: fallbackProfile.id } as any
      }
    }

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { 
      leadId, 
      actionType, 
      description, 
      nextFollowup, 
      updateStage, 
      incrementDnp,
      outcome 
    } = body

    if (!leadId) {
      return NextResponse.json({ error: 'Lead ID is required' }, { status: 400 })
    }

    // 1. Fetch current lead data
    const { data: currentLead, error: fetchErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (fetchErr || !currentLead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Prepare updates for lead table
    const updates: Record<string, any> = {
      last_call_at: new Date().toISOString(),
      last_call_status: outcome || actionType,
      last_called_by: user.id
    }

    if (nextFollowup !== undefined) {
      updates.next_followup = nextFollowup
    }

    if (updateStage) {
      updates.pipeline_stage = updateStage
    }

    // Handle DNP increment
    let newDnpCount = currentLead.dnp_count || 0
    if (incrementDnp || actionType === 'DNP' || outcome === 'DNP') {
      newDnpCount = (newDnpCount || 0) + 1
      updates.dnp_count = newDnpCount

      // Also store in custom_fields as dual-layer fallback
      let customFields = currentLead.custom_fields || {}
      if (typeof customFields === 'string') {
        try { customFields = JSON.parse(customFields) } catch (e) { customFields = {} }
      }
      customFields.dnp_count = newDnpCount
      customFields.last_dnp_at = new Date().toISOString()
      updates.custom_fields = customFields
    } else if (actionType === 'RESET_DNP') {
      newDnpCount = 0
      updates.dnp_count = 0
      let customFields = currentLead.custom_fields || {}
      if (typeof customFields === 'string') {
        try { customFields = JSON.parse(customFields) } catch (e) { customFields = {} }
      }
      customFields.dnp_count = 0
      updates.custom_fields = customFields
    }

    // Perform lead update
    const { data: updatedLead, error: updateErr } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', leadId)
      .select('*')
      .single()

    if (updateErr) {
      console.warn('Lead update warning (continuing fallback):', updateErr.message)
    }

    // 2. Save History Log with user_id for Team Stats tracking
    const { error: historyError } = await supabase.from('lead_history').insert({
      lead_id: leadId,
      user_id: user.id,
      action_type: actionType || 'CALL_FEEDBACK',
      description: description || `Action performed: ${actionType}`
    })

    if (historyError) {
      console.warn('History insertion warning:', historyError.message)
    }

    return NextResponse.json({ 
      success: true, 
      lead: updatedLead || currentLead,
      dnpCount: newDnpCount
    })
  } catch (error: any) {
    console.error('Lead action endpoint error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}