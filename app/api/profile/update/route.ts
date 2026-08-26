import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { exec } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'

async function processReferenceVideo(videoUrl: string, userId: string): Promise<{ trimmedVideoUrl: string; extractedAudioUrl: string }> {
  let hash = crypto.createHash('md5').update(videoUrl).digest('hex')
  try {
    const headRes = await fetch(videoUrl, { method: 'HEAD' })
    const contentLength = headRes.headers.get('content-length') || ''
    const lastModified = headRes.headers.get('last-modified') || ''
    const eTag = headRes.headers.get('etag') || ''
    hash = crypto.createHash('md5').update(`${videoUrl}_${contentLength}_${lastModified}_${eTag}`).digest('hex')
  } catch (e) {
    console.warn(`[Process Video] HEAD request failed, using fallback hash: ${hash}`)
  }

  const videoKey = `generated/${userId}/trimmed_ref_v2_${hash}.mp4`
  const audioKey = `generated/${userId}/ref_audio_v2_${hash}.mp3`
  const trimmedVideoUrl = `${R2_PUBLIC_URL}/${videoKey}`
  const extractedAudioUrl = `${R2_PUBLIC_URL}/${audioKey}`

  // Check R2 cache first
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: videoKey }))
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: audioKey }))
    console.log(`[Process Video Cache] Cache hit: ${trimmedVideoUrl} and ${extractedAudioUrl}`)
    return { trimmedVideoUrl, extractedAudioUrl }
  } catch (e) {
    console.log(`[Process Video Cache] Cache miss. Starting trim & audio extraction...`)
  }

  // Call Cloud Run microservice first if configured
  const rendererUrl = process.env.REMOTION_RENDERER_URL
  if (rendererUrl) {
    try {
      console.log(`[Process Video] Calling Cloud Run renderer microservice: ${rendererUrl}/process-avatar`)
      const trimRes = await fetch(`${rendererUrl.replace(/\/$/, '')}/process-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: videoUrl, userId })
      })
      if (trimRes.ok) {
        const data = await trimRes.json()
        if (data.success && data.videoUrl && data.audioUrl) {
          console.log(`[Process Video] Cloud Run processed successfully.`)
          return { trimmedVideoUrl: data.videoUrl, extractedAudioUrl: data.audioUrl }
        }
      }
    } catch (microserviceErr: any) {
      console.error(`[Process Video] Cloud Run call failed, falling back to local:`, microserviceErr.message)
    }
  }

  const tempDir = path.join(os.tmpdir(), `trim_${userId}_${Date.now()}`)
  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const inputPath = path.join(tempDir, 'input.mp4')
    const outputPath = path.join(tempDir, 'output.mp4')
    const audioPath = path.join(tempDir, 'output.mp3')

    // 1. Download
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`Failed to download reference video: ${res.statusText}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(inputPath, buffer)

    // 2. Trim & scale with FFmpeg (to first 13 seconds, keeping under 2,000,000 pixels)
    const ffmpegBinary = path.join(
      process.cwd(),
      'node_modules',
      'ffmpeg-static',
      os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    )
    const scaleFilter = "scale='trunc(min(iw\\,iw*sqrt(2000000/(iw*ih)))/2)*2':-2"
    const cmdTemplate = `FFMPEG_CMD -y -i "${inputPath}" -t 13 -vf "${scaleFilter}" -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${outputPath}"`

    const executeFFmpeg = async (commandTemplate: string) => {
      const cmd = commandTemplate.replace("FFMPEG_CMD", fs.existsSync(ffmpegBinary) ? `"${ffmpegBinary}"` : "ffmpeg")
      await new Promise<void>((resolve, reject) => {
        exec(cmd, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    try {
      await executeFFmpeg(cmdTemplate)
    } catch (err) {
      console.warn(`[Process Video] Standard trim failed, retrying with silent video (-an)...`)
      const silentCmd = `FFMPEG_CMD -y -i "${inputPath}" -t 13 -vf "${scaleFilter}" -c:v libx264 -an -preset superfast -movflags +faststart "${outputPath}"`
      await executeFFmpeg(silentCmd)
    }

    // 3. Extract audio
    const audioCmd = `FFMPEG_CMD -y -i "${outputPath}" -vn -c:a libmp3lame -q:a 2 "${audioPath}"`
    try {
      await executeFFmpeg(audioCmd)
    } catch (err) {
      console.warn(`[Process Video] Audio extraction failed. Generating silent MP3 fallback...`)
      const silentAudioCmd = `FFMPEG_CMD -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 13 -c:a libmp3lame -q:a 2 "${audioPath}"`
      await executeFFmpeg(silentAudioCmd)
    }

    // 4. Upload trimmed video to R2
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: videoKey,
      Body: fs.readFileSync(outputPath),
      ContentType: 'video/mp4'
    }))

    // 5. Upload audio to R2
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: audioKey,
      Body: fs.readFileSync(audioPath),
      ContentType: 'audio/mpeg'
    }))

    console.log(`[Process Video] Successfully trimmed video and extracted audio locally!`)
    return { trimmedVideoUrl, extractedAudioUrl }

  } catch (err: any) {
    console.error("[Process Video Error] Failed, returning original URL:", err)
    return { trimmedVideoUrl: videoUrl, extractedAudioUrl: "" }
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (e) {}
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    
    // 1. Authenticate user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { targetUserId, updates } = body

    if (!targetUserId || !updates) {
      return NextResponse.json({ error: 'Missing targetUserId or updates' }, { status: 400 })
    }

    // 2. Validate permissions of requester
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, agency_id, parent_id')
      .eq('id', user.id)
      .maybeSingle()

    let authorized = false

    // Check if updating own profile
    if (targetUserId === user.id) {
      authorized = true
    }

    // Check if staff/impersonation rights exist
    if (!authorized) {
      const currentAuthRole = profile?.role || 'admin'
      
      // If agency/admin/agent, verify the target is their sub-account
      if (['super_admin', 'agency', 'admin', 'agent'].includes(currentAuthRole)) {
        if (currentAuthRole !== 'super_admin') {
          const { data: subAccount } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', targetUserId)
            .eq('agency_id', profile?.agency_id || user.id)
            .maybeSingle()

          
          if (subAccount) {
            authorized = true
          }
        } else {
          // Super admin is authorized for everything
          authorized = true
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden: Unauthorized profile update' }, { status: 403 })
    }

    // Remove any fields that should not be updated via profile page
    const allowedUpdates = { ...updates }
    delete allowedUpdates.id
    delete allowedUpdates.created_at
    delete allowedUpdates.role
    delete allowedUpdates.agency_id
    delete allowedUpdates.parent_id

    // 3. Perform update using service role client to bypass RLS restrictions
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Check if character_url has changed and needs analysis
    if (updates.character_url !== undefined) {
      try {
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('character_url, character_description')
          .eq('id', targetUserId)
          .maybeSingle()

        if (!existingProfile || existingProfile.character_url !== updates.character_url) {
          console.log(`[Profile Update API] Character URL changed from "${existingProfile?.character_url || ''}" to "${updates.character_url}". Starting processing and Gemini Vision analysis...`)
          if (updates.character_url) {
            // Trim/scale the reference video and extract its audio track
            const { trimmedVideoUrl, extractedAudioUrl } = await processReferenceVideo(updates.character_url, targetUserId)
            
            allowedUpdates.character_url = trimmedVideoUrl
            allowedUpdates.character_audio_url = extractedAudioUrl

            const mediaRes = await fetch(trimmedVideoUrl)
            if (mediaRes.ok) {
              const buffer = Buffer.from(await mediaRes.arrayBuffer())
              const detectedMimeType = mediaRes.headers.get('content-type') || 'video/mp4'
              // Since it's processed, it's definitely a video
              const mimeType = detectedMimeType.startsWith('video/') ? detectedMimeType : 'video/mp4'

              console.log(`[Profile Update API] Processed video. Starting analysis...`)

              const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!)
              const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" })

              const prompt = `You are a casting director. Analyze this profile character video and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.`

              const result = await model.generateContent([
                prompt,
                {
                  inlineData: {
                    data: buffer.toString('base64'),
                    mimeType
                  }
                }
              ])

              const desc = result.response.text()?.trim()
              if (desc) {
                console.log(`[Profile Update API] Character analyzed successfully: ${desc}`)
                allowedUpdates.character_description = desc
              }
            } else {
              console.error(`[Profile Update API] Failed to fetch trimmed character media from ${trimmedVideoUrl}`)
            }
          } else {
            // If character_url was set to null/empty, clear the description and audio too
            allowedUpdates.character_description = null
            allowedUpdates.character_audio_url = null
          }
        }
      } catch (analysisError) {
        console.error("[Profile Update API] Character media analysis/processing failed:", analysisError)
      }
    }

    // Check if avatar_url has changed and needs analysis
    if (updates.avatar_url !== undefined) {
      try {
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('avatar_url, avatar_description')
          .eq('id', targetUserId)
          .maybeSingle()


        if (!existingProfile || existingProfile.avatar_url !== updates.avatar_url) {
          console.log(`[Profile Update API] Avatar URL changed from "${existingProfile?.avatar_url || ''}" to "${updates.avatar_url}". Starting Gemini Vision analysis...`)
          if (updates.avatar_url) {
            const mediaRes = await fetch(updates.avatar_url)
            if (mediaRes.ok) {
              const buffer = Buffer.from(await mediaRes.arrayBuffer())
              const detectedMimeType = mediaRes.headers.get('content-type') || 'image/jpeg'

              const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!)
              const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" })

              const prompt = `You are a casting director. Analyze this profile character photo and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.`

              const result = await model.generateContent([
                prompt,
                {
                  inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: detectedMimeType
                  }
                }
              ])

              const desc = result.response.text()?.trim()
              if (desc) {
                console.log(`[Profile Update API] Avatar analyzed successfully: ${desc}`)
                allowedUpdates.avatar_description = desc
              }
            } else {
              console.error(`[Profile Update API] Failed to fetch avatar media from ${updates.avatar_url}`)
            }
          } else {
            // If avatar_url was set to null/empty, clear the description too
            allowedUpdates.avatar_description = null
          }
        }
      } catch (analysisError) {
        console.error("[Profile Update API] Avatar media analysis failed:", analysisError)
      }
    }

    // Sync notification_email into business_info JSON for 100% fail-safe persistence
    if (updates.notification_email !== undefined) {
      try {
        let bInfo: any = {};
        if (allowedUpdates.business_info) {
          bInfo = typeof allowedUpdates.business_info === 'string' && allowedUpdates.business_info.startsWith('{')
            ? JSON.parse(allowedUpdates.business_info)
            : { bio: allowedUpdates.business_info };
        } else {
          const { data: curProf } = await supabaseAdmin.from('profiles').select('business_info').eq('id', targetUserId).maybeSingle();
          if (curProf?.business_info) {
            bInfo = typeof curProf.business_info === 'string' && curProf.business_info.startsWith('{')
              ? JSON.parse(curProf.business_info)
              : { bio: curProf.business_info };
          }
        }
        bInfo.notification_email = updates.notification_email ? updates.notification_email.trim() : null;
        allowedUpdates.business_info = JSON.stringify(bInfo);
      } catch (bErr) {
        console.warn("[Profile Update API] Failed to serialize notification_email into business_info:", bErr);
      }
    }

    let { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: targetUserId, ...allowedUpdates }, { onConflict: 'id' })
      .select()
      .maybeSingle()

    if (error) {
      // Self-healing database update retry: if missing custom columns, retry without them
      const isMissingCustomColumn = error.message?.includes('avatar_url') || 
                                    error.message?.includes('avatar_description') || 
                                    error.message?.includes('avatar_audio_url') || 
                                    error.message?.includes('timezone') ||
                                    error.message?.includes('notification_email')
      if (isMissingCustomColumn) {
        console.warn("[Profile Update API] Database is missing custom columns. Retrying update with safe columns...")
        const healedUpdates = { ...allowedUpdates }
        if (error.message?.includes('avatar_url')) delete healedUpdates.avatar_url
        if (error.message?.includes('avatar_description')) delete healedUpdates.avatar_description
        if (error.message?.includes('avatar_audio_url')) delete healedUpdates.avatar_audio_url
        if (error.message?.includes('timezone')) delete healedUpdates.timezone
        if (error.message?.includes('notification_email')) delete healedUpdates.notification_email

        // Also sync timezone and notification_email to user_metadata as persistent fallback
        const metaUpdates: any = {}
        if (allowedUpdates.timezone) metaUpdates.timezone = allowedUpdates.timezone
        if (allowedUpdates.notification_email) metaUpdates.notification_email = allowedUpdates.notification_email
        if (Object.keys(metaUpdates).length > 0) {
          try {
            await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
              user_metadata: metaUpdates
            })
          } catch (metaErr) {}
        }

        if (Object.keys(healedUpdates).length === 0) {
          const { data: currentProfile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', targetUserId)
            .maybeSingle()

          return NextResponse.json({ 
            success: true, 
            profile: { 
              ...currentProfile, 
              timezone: allowedUpdates.timezone || 'Asia/Kolkata',
              notification_email: allowedUpdates.notification_email || null
            }
          })
        }

        const retryResult = await supabaseAdmin
          .from('profiles')
          .upsert({ id: targetUserId, ...healedUpdates }, { onConflict: 'id' })
          .select()
          .maybeSingle()

        if (!retryResult.error) {
          return NextResponse.json({ 
            success: true, 
            profile: { 
              ...retryResult.data, 
              timezone: allowedUpdates.timezone || 'Asia/Kolkata',
              notification_email: allowedUpdates.notification_email || null
            }
          })
        }
        error = retryResult.error
      }

      console.error("[Profile Update API] Database update error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (allowedUpdates.timezone) {
      try {
        await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
          user_metadata: { timezone: allowedUpdates.timezone }
        })
      } catch (metaErr) {}
    }

    return NextResponse.json({ success: true, profile: data })

  } catch (error: any) {
    console.error("[Profile Update API] General error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
