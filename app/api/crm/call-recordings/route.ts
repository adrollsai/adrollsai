import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
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
    let { error: uploadErr } = await supabase.storage
      .from(storageBucket)
      .upload(fileName, buffer, {
        contentType: file.type || 'audio/mpeg',
        upsert: true
      })

    if (uploadErr) {
      storageBucket = 'public-assets'
      const fallbackRes = await supabase.storage
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

    const { data: publicUrlData } = supabase.storage
      .from(storageBucket)
      .getPublicUrl(fileName)

    const recordingUrl = publicUrlData.publicUrl

    // 2. Link recordingUrl to call_logs
    if (callLogId) {
      await supabase
        .from('call_logs')
        .update({ recording_url: recordingUrl })
        .eq('id', callLogId)
    } else if (phoneNumber) {
      const normalizedPhone = phoneNumber.replace(/[^0-9]/g, '')
      const last10 = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : normalizedPhone

      if (last10) {
        const { data: recentLog } = await supabase
          .from('call_logs')
          .select('id')
          .eq('user_id', user.id)
          .ilike('phone_number', `%${last10}%`)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (recentLog) {
          await supabase
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
        const { data: matchedLead } = await supabase
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

    // 4. Insert timeline history entry for matched lead
    if (matchedLeadId) {
      await supabase
        .from('lead_history')
        .insert({
          lead_id: matchedLeadId,
          action_type: 'CALL_RECORDING',
          title: '🎙️ Call Recording Auto-Attached',
          description: `Call recording automatically attached from device (${file.name || 'audio'}).`,
          metadata: {
            recording_url: recordingUrl,
            uploader_id: user.id,
            auto_synced: true
          }
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
