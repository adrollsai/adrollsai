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

    // 1. Ensure storage bucket exists
    const fileExt = file.name.split('.').pop() || 'm4a'
    const fileName = `call-recordings/${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
    const buffer = Buffer.from(await file.arrayBuffer())

    // Upload to Supabase storage bucket 'call-recordings' (fallback to 'public-assets' if bucket missing)
    let storageBucket = 'call-recordings'
    let { data: uploadData, error: uploadErr } = await supabase.storage
      .from(storageBucket)
      .upload(fileName, buffer, {
        contentType: file.type || 'audio/mpeg',
        upsert: true
      })

    if (uploadErr) {
      // Fallback to public-assets bucket
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

    // Get Public URL
    const { data: publicUrlData } = supabase.storage
      .from(storageBucket)
      .getPublicUrl(fileName)

    const recordingUrl = publicUrlData.publicUrl

    // 2. Link recordingUrl to call_logs if callLogId or phoneNumber provided
    if (callLogId) {
      await supabase
        .from('call_logs')
        .update({ recording_url: recordingUrl })
        .eq('id', callLogId)
    } else if (phoneNumber) {
      // Update most recent call log with matching phone
      const { data: recentLog } = await supabase
        .from('call_logs')
        .select('id')
        .eq('user_id', user.id)
        .eq('phone_number', phoneNumber)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recentLog) {
        await supabase
          .from('call_logs')
          .update({ recording_url: recordingUrl })
          .eq('id', recentLog.id)
      }

      // Also find the matching lead and add timeline entry
      const normalizedPhone = phoneNumber.replace(/[^0-9]/g, '')
      const last10 = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : normalizedPhone
      
      const { data: matchedLead } = await supabase
        .from('leads')
        .select('id, name')
        .eq('user_id', user.id)
        .or(`phone.ilike.%${last10},phone_raw.ilike.%${last10},whatsapp_number.ilike.%${last10}`)
        .limit(1)
        .maybeSingle()

      if (matchedLead) {
        await supabase
          .from('lead_history')
          .insert({
            lead_id: matchedLead.id,
            action_type: 'CALL_RECORDING',
            title: 'Call Recording Auto-Synced',
            description: `Call recording automatically attached from device (${file.name || 'audio'}).`,
            metadata: {
              recording_url: recordingUrl,
              uploader_id: user.id,
              call_log_id: recentLog?.id || null,
              auto_synced: true
            }
          })
      }
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
