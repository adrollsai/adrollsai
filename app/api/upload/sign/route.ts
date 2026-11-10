import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function POST(request: Request) {
  let supabase: any = await createClient()
  let user = (await supabase.auth.getUser()).data.user

  // Native clients (the Flutter app) hold no SSR cookies, so they send
  // `Authorization: Bearer <supabase access token>`. Additive: the cookie path
  // above is unchanged, and the bearer client carries the caller's own token so
  // RLS still applies.
  const authHeader = request.headers.get('authorization')
  if (!user && authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const bearerClient = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }
    )
    const { data } = await bearerClient.auth.getUser(token)
    if (data?.user) {
      user = data.user
      supabase = bearerClient as any
    }
  }

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileName, fileType, folder, impersonateId } = await request.json()

  const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
  let targetUserId = (currentProfile?.role === 'agent' && (currentProfile?.agency_id || currentProfile?.parent_id)) 
    ? (currentProfile.agency_id || currentProfile.parent_id) 
    : user.id

  if (impersonateId) {
      if (['super_admin', 'agency', 'admin', 'agent'].includes(currentProfile?.role || '')) {
          if (currentProfile?.role !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', currentProfile?.agency_id || user.id)
                .single()

              if (subAccount) {
                  targetUserId = impersonateId
              }
          } else {
              targetUserId = impersonateId
          }
      }
  }

  const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '')
  
  // 1. CLEAN KEY for Upload (Does NOT include 'adrolls-storage' as requested)
  const key = `${folder}/${targetUserId}/${Date.now()}-${cleanName}`

  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: fileType,
    })

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 300 })

    return NextResponse.json({ 
      signedUrl, 
      // 2. FIXED PUBLIC URL: Manually adding 'adrolls-storage' for fetching
      publicUrl: `${R2_PUBLIC_URL}/${key}` 
    })

  } catch (error: any) {
    console.error("R2 Signing Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}