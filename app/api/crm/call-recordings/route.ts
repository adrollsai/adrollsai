import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    let user: any = null
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization')
    
    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // 1. Try Bearer token from header (for native Android HTTP uploads)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim()
      if (token) {
        const { data: userData } = await adminSupabase.auth.getUser(token)
        user = userData?.user || null
      }
    }

    // 2. Fallback to SSR cookie auth
    if (!user) {
      const supabase = await createServerClient()
      const { data: userData } = await supabase.auth.getUser()
      user = userData?.user || null
    }

    if (!user) {
      console.error('[Call Recording Upload] Unauthorized request - no valid session or Bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const leadId = formData.get('leadId') as string | null
    const callLogId = formData.get('callLogId') as string | null
    const phoneNumber = formData.get('phoneNumber') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No audio recording file provided' }, { status: 400 })
    }

    // 1. Storage bucket upload
    const fileExt = file.name.split('.').pop() || 'mp3'
    const fileName = `call-recordings/${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
    const buffer = Buffer.from(await file.arrayBuffer())

    let storageBucket = 'call-recordings'
    let { error: uploadErr } = await adminSupabase.storage
      .from(storageBucket)
      .upload(fileName, buffer, {
        contentType: file.type || 'audio/mpeg',
        upsert: true
      })

    if (uploadErr) {
      storageBucket = 'public-assets'
      const fallbackRes = await adminSupabase.storage
        .from(storageBucket)
        .upload(fileName, buffer, {
          contentType: file.type || 'audio/mpeg',
          upsert: true
        })
      uploadErr = fallbackRes.error
    }

    if (uploadErr) {
      console.error('[Call Recording Upload] Storage Error:', uploadErr)
      return NextResponse.json({ error: 'Failed to upload call recording file' }, { status: 500 })
    }

    const { data: publicUrlData } = adminSupabase.storage
      .from(storageBucket)
      .getPublicUrl(fileName)

    const recordingUrl = publicUrlData.publicUrl

    // 2. Link recordingUrl to call_logs
    if (callLogId) {
      await adminSupabase
        .from('call_logs')
        .update({ recording_url: recordingUrl })
        .eq('id', callLogId)
    } else if (phoneNumber) {
      const normalizedPhone = phoneNumber.replace(/[^0-9]/g, '')
      const last10 = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : normalizedPhone

      if (last10) {
        const { data: recentLog } = await adminSupabase
          .from('call_logs')
          .select('id')
          .eq('user_id', user.id)
          .ilike('phone_number', `%${last10}%`)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (recentLog) {
          await adminSupabase
            .from('call_logs')
            .update({ recording_url: recordingUrl })
            .eq('id', recentLog.id)
        }
      }
    }

    // 3. Find matching lead (by leadId OR by phone number last 10 digits)
    let matchedLeadId = leadId
    if (!matchedLeadId && phoneNumber) {
      const normalizedPhone = phoneNumber.replace(/[^0-9]/g, '')
      const last10 = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : normalizedPhone
      if (last10) {
        const { data: matchedLead } = await adminSupabase
          .from('leads')
          .select('id, name')
          .eq('user_id', user.id)
          .ilike('phone', `%${last10}%`)
          .limit(1)
          .maybeSingle()

        if (matchedLead) {
          matchedLeadId = matchedLead.id
        }
      }
    }

    // 4. Insert timeline history entry for matched lead using valid lead_history schema
    if (matchedLeadId) {
      await adminSupabase
        .from('lead_history')
        .insert({
          lead_id: matchedLeadId,
          user_id: user.id,
          action_type: 'CALL_RECORDING',
          description: `🎙️ Call Recording Attached: ${file.name || 'audio'}\n${recordingUrl}`,
          created_at: new Date().toISOString()
        })
    }

    return NextResponse.json({
      success: true,
      recordingUrl
    })

  } catch (error: any) {
    console.error('[Call Recording Upload API] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
