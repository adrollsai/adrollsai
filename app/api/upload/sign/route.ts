import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileName, fileType, folder } = await request.json()

  const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '')
  
  // 1. CLEAN KEY for Upload
  const key = `${folder}/${user.id}/${Date.now()}-${cleanName}`

  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: fileType,
    })

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 300 })

    return NextResponse.json({ 
      signedUrl, 
      // 2. CLEAN PUBLIC URL (No 'adrolls-storage' here, so DB stays clean)
      publicUrl: `${R2_PUBLIC_URL}/${key}` 
    })

  } catch (error: any) {
    console.error("R2 Signing Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}