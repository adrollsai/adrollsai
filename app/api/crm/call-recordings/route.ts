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
    }

    // 3. Link recordingUrl to lead_history timeline if leadId provided
    if (leadId) {
      await supabase
        .from('lead_history')
        .insert({
          lead_id: leadId,
          action_type: 'CALL_RECORDING',
          title: 'Human Call Recording Added',
          description: `Call recording uploaded (${file.name || 'audio'}).`,
          metadata: {
            recording_url: recordingUrl,
            uploader_id: user.id
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
