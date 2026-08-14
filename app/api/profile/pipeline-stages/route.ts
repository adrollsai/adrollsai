import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { DEFAULT_PIPELINE_STAGES, PipelineStageConfig } from '@/utils/pipeline-stages'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createAdminClient(
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
    let targetUserId = user.id

    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, agency_id, custom_pipeline_stages')
      .eq('id', user.id)
      .single()

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
      targetUserId = impersonateId
    } else if (currentProfile?.parent_id || currentProfile?.agency_id) {
      targetUserId = currentProfile.parent_id || currentProfile.agency_id || user.id
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('custom_pipeline_stages')
      .eq('id', targetUserId)
      .single()

    let stages: PipelineStageConfig[] = DEFAULT_PIPELINE_STAGES
    if (targetProfile?.custom_pipeline_stages && Array.isArray(targetProfile.custom_pipeline_stages) && targetProfile.custom_pipeline_stages.length > 0) {
      stages = targetProfile.custom_pipeline_stages
    }

    return NextResponse.json({ success: true, stages })
  } catch (error: any) {
    console.error('[API Get Pipeline Stages Error]:', error)
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { stages, impersonateId } = body

    if (!Array.isArray(stages)) {
      return NextResponse.json({ error: 'Invalid stages payload' }, { status: 400 })
    }

    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, agency_id')
      .eq('id', user.id)
      .single()

    let targetUserId = user.id
    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
      targetUserId = impersonateId
    } else if (currentProfile?.parent_id || currentProfile?.agency_id) {
      targetUserId = currentProfile.parent_id || currentProfile.agency_id || user.id
    }

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ custom_pipeline_stages: stages })
      .eq('id', targetUserId)

    if (updateErr) {
      console.error('[API Save Pipeline Stages Error]:', updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, stages })
  } catch (error: any) {
    console.error('[API Save Pipeline Stages Error]:', error)
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
