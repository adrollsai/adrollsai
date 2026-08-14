import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendMetaCapiEvent } from '@/utils/meta-capi'
import { DEFAULT_PIPELINE_STAGES, PipelineStageConfig } from '@/utils/pipeline-stages'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { leadId, stageName, impersonateId } = body

    if (!leadId || !stageName) {
      return NextResponse.json({ error: 'Missing leadId or stageName' }, { status: 400 })
    }

    // 1. Fetch Lead
    const { data: lead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('id, name, email, phone, user_id, value, custom_fields')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const ownerId = lead.user_id || impersonateId || user.id

    // 2. Fetch Owner Profile for Facebook Token, Pixel ID & Custom Stages Config
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, parent_id, agency_id, pixel_id, facebook_token, custom_pipeline_stages, raw_user_meta_data')
      .eq('id', ownerId)
      .single()

    let facebookToken = profile?.facebook_token
    let pixelId = profile?.pixel_id

    // If subaccount without direct credentials, check parent admin
    if ((!facebookToken || !pixelId) && (profile?.parent_id || profile?.agency_id)) {
      const parentId = profile.parent_id || profile.agency_id
      const { data: parentProf } = await supabaseAdmin
        .from('profiles')
        .select('pixel_id, facebook_token, custom_pipeline_stages')
        .eq('id', parentId)
        .single()

      if (parentProf?.facebook_token) facebookToken = parentProf.facebook_token
      if (parentProf?.pixel_id) pixelId = parentProf.pixel_id
    }

    if (!facebookToken || !pixelId) {
      return NextResponse.json({ success: false, reason: 'Meta Pixel or Facebook token not configured' })
    }

    // 3. Resolve Stages Config
    let stagesConfig: PipelineStageConfig[] = DEFAULT_PIPELINE_STAGES
    if (profile?.custom_pipeline_stages && Array.isArray(profile.custom_pipeline_stages) && profile.custom_pipeline_stages.length > 0) {
      stagesConfig = profile.custom_pipeline_stages
    }

    // 4. Check if current stage has CAPI enabled
    const matchedStage = stagesConfig.find(s => s.name.trim().toLowerCase() === stageName.trim().toLowerCase())
    if (!matchedStage || !matchedStage.enableCapi) {
      return NextResponse.json({ success: false, reason: `CAPI not enabled for stage "${stageName}"` })
    }

    const eventName = matchedStage.capiEventName || stageName

    // 5. Send CAPI event
    const capiResult = await sendMetaCapiEvent({
      eventName,
      lead,
      pixelId,
      facebookToken,
      customData: {
        stage: stageName,
        status: stageName
      }
    })

    return NextResponse.json({ success: true, eventName, capiResult })
  } catch (error: any) {
    console.error('[API CAPI Trigger Error]:', error)
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
