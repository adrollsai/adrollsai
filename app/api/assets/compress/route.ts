import { NextResponse } from 'next/server'
import { PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import { createClient } from '@/utils/supabase/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'
import { generateAndUploadVideoThumbnail } from '@/utils/video-thumbnail-helper'
import crypto from 'crypto'

export const maxDuration = 300 // 5 minutes execution timeout
export const dynamic = 'force-dynamic'

const execPromise = promisify(exec)

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { tempUrl, fileName, fileType, fileSize, impersonateId, propertyId, customInstructions } = await request.json()
        if (!tempUrl) {
            return NextResponse.json({ error: 'No temporary video URL provided' }, { status: 400 })
        }

        console.log(`[VideoCompress API] Debug R2 - Bucket: ${R2_BUCKET}, tempUrl: ${tempUrl}`)

        // Resolve current profile and target user
        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
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
        const tempDir = os.tmpdir()
        const inputPath = path.join(tempDir, `raw-${Date.now()}-${cleanName}`)
        const outputPath = path.join(tempDir, `comp-${Date.now()}-${cleanName}`)

        let inputCreated = false
        let outputCreated = false

        const cleanTempKey = tempUrl.includes('/adrolls-storage/') 
            ? tempUrl.split('/adrolls-storage/')[1] 
            : tempUrl.replace(`${R2_PUBLIC_URL}/`, '').replace(/^\//, '')

        const permanentKey = `library/${targetUserId}/${Date.now()}-${cleanName}`
        const finalPublicUrl = `${R2_PUBLIC_URL}/${permanentKey}`

        let shouldCompress = true

        if (shouldCompress) {
            try {
                // 1. Download raw video using S3 SDK GetObject (with fallback to public HTTP fetch)
                console.log(`[VideoCompress API] Downloading raw video. Key: ${cleanTempKey}`)
                let downloaded = false

                try {
                    const getObjRes = await r2.send(new GetObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: cleanTempKey
                    }))
                    if (getObjRes.Body) {
                        const byteArray = await getObjRes.Body.transformToByteArray()
                        fs.writeFileSync(inputPath, Buffer.from(byteArray))
                        inputCreated = true
                        downloaded = true
                        console.log(`[VideoCompress API] S3 GetObject download successful (${(byteArray.length / (1024 * 1024)).toFixed(2)} MB)`)
                    }
                } catch (s3GetErr) {
                    console.warn(`[VideoCompress API] S3 GetObject failed for ${cleanTempKey}, trying prefix candidate...`)
                    try {
                        const getObjRes2 = await r2.send(new GetObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: `adrolls-storage/${cleanTempKey}`
                        }))
                        if (getObjRes2.Body) {
                            const byteArray = await getObjRes2.Body.transformToByteArray()
                            fs.writeFileSync(inputPath, Buffer.from(byteArray))
                            inputCreated = true
                            downloaded = true
                            console.log(`[VideoCompress API] S3 GetObject download successful with prefix candidate`)
                        }
                    } catch (s3GetErr2) {
                        console.warn(`[VideoCompress API] S3 GetObject failed with prefix too, trying HTTP fetch...`)
                    }
                }

                if (!downloaded) {
                    let response: Response | null = null
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            response = await fetch(tempUrl)
                            if (response && response.ok) break
                        } catch (e) {}
                        if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
                    }
                    if (!response || !response.ok) {
                        throw new Error(`Failed to download raw video from temp storage: HTTP ${response?.status || 'network_error'}`)
                    }
                    const arrayBuffer = await response.arrayBuffer()
                    const buffer = Buffer.from(arrayBuffer)
                    fs.writeFileSync(inputPath, buffer)
                    inputCreated = true
                    downloaded = true
                }

                // 2. Compress the video using FFmpeg
                const nodeModulesFfmpeg = path.join(
                    process.cwd(),
                    'node_modules',
                    'ffmpeg-static',
                    os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
                )
                const ffmpeg = fs.existsSync(nodeModulesFfmpeg) ? nodeModulesFfmpeg : (ffmpegPath || 'ffmpeg')
                const command = `"${ffmpeg}" -y -i "${inputPath}" -filter:v fps=30 -vsync cfr -c:v libx264 -pix_fmt yuv420p -crf 30 -preset ultrafast -c:a aac -b:a 128k "${outputPath}"`
                
                console.log(`[VideoCompress API] Compressing video. Command: ${command}`)
                await execPromise(command)
                outputCreated = true

                const compressedBuffer = fs.readFileSync(outputPath)
                console.log(`[VideoCompress API] Compression finished. Compressed size: ${(compressedBuffer.length / (1024 * 1024)).toFixed(2)} MB`)

                // 3. Upload compressed video to permanent R2 folder
                const uploadParams = {
                    Bucket: R2_BUCKET,
                    Key: permanentKey,
                    Body: compressedBuffer,
                    ContentType: fileType || 'video/mp4'
                }

                await r2.send(new PutObjectCommand(uploadParams))

                let thumbnailUrl = null
                try {
                    thumbnailUrl = await generateAndUploadVideoThumbnail(outputPath, targetUserId, crypto.randomUUID())
                } catch (thumbErr) {
                    console.error("[VideoCompress API] Thumbnail generation failed:", thumbErr)
                }

                // 4. Save asset in Supabase assets database
                const { data: insertedAsset, error: insertError } = await supabase
                    .from('assets')
                    .insert({
                        user_id: targetUserId,
                        type: 'video',
                        url: finalPublicUrl,
                        status: 'Ready',
                        caption: `Uploaded: ${fileName}`,
                        property_id: propertyId || null,
                        created_at: new Date().toISOString(),
                        metadata: {
                            ...(thumbnailUrl ? { thumbnailUrl } : {}),
                            custom_instructions: customInstructions || null
                        }
                    })
                    .select()
                    .single()

                if (insertError) throw insertError

                // 5. Delete raw video from temporary R2 folder to keep R2 clean
                console.log(`[VideoCompress API] Cleaning up raw video from temp R2: ${cleanTempKey}`)
                await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: cleanTempKey })).catch(() => {})
                await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: `adrolls-storage/${cleanTempKey}` })).catch(() => {})

                return NextResponse.json({ success: true, asset: insertedAsset })

            } catch (innerErr: any) {
                console.warn('[VideoCompress API] Compression failed, falling back to copying raw file:', innerErr)
                shouldCompress = false // triggers fallback below
            } finally {
                // Clean up local temp files
                if (inputCreated && fs.existsSync(inputPath)) {
                    try { fs.unlinkSync(inputPath) } catch (e) {}
                }
                if (outputCreated && fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath) } catch (e) {}
                }
            }
        }

        // FALLBACK: Copy raw file directly from temp to permanent library with dual key candidate check
        if (!shouldCompress) {
            try {
                console.log(`[VideoCompress API] Executing direct copy fallback. Clean tempKey: ${cleanTempKey}, Target: ${permanentKey}`)
                
                let copySuccess = false
                let lastCopyError: any = null

                const keyCandidates = [
                    cleanTempKey,
                    `adrolls-storage/${cleanTempKey}`
                ]

                for (const candKey of keyCandidates) {
                    try {
                        const copySourceEncoded = `${R2_BUCKET}/${encodeURIComponent(candKey)}`
                        console.log(`[VideoCompress API] Attempting CopyObjectCommand with CopySource: ${copySourceEncoded}`)
                        await r2.send(new CopyObjectCommand({
                            Bucket: R2_BUCKET,
                            CopySource: copySourceEncoded,
                            Key: permanentKey
                        }))
                        copySuccess = true
                        console.log(`[VideoCompress API] CopyObjectCommand succeeded for candidate: ${candKey}`)
                        break
                    } catch (copyErr: any) {
                        lastCopyError = copyErr
                        console.warn(`[VideoCompress API] CopyObjectCommand failed for candidate ${candKey}:`, copyErr?.message || copyErr)
                    }
                }

                if (!copySuccess) {
                    throw new Error(`R2 storage copy failed: ${lastCopyError?.message || 'The specified key does not exist.'}`)
                }

                let thumbnailUrl = null
                if (inputCreated && fs.existsSync(inputPath)) {
                    try {
                        thumbnailUrl = await generateAndUploadVideoThumbnail(inputPath, targetUserId, crypto.randomUUID())
                    } catch (thumbErr) {
                        console.error("[VideoCompress API] Fallback thumbnail generation failed:", thumbErr)
                    }
                }

                const { data: insertedAsset, error: insertError } = await supabase
                    .from('assets')
                    .insert({
                        user_id: targetUserId,
                        type: 'video',
                        url: finalPublicUrl,
                        status: 'Ready',
                        caption: `Uploaded: ${fileName} (Original)`,
                        property_id: propertyId || null,
                        created_at: new Date().toISOString(),
                        metadata: {
                            ...(thumbnailUrl ? { thumbnailUrl } : {}),
                            custom_instructions: customInstructions || null
                        }
                    })
                    .select()
                    .single()

                if (insertError) throw insertError

                // Clean up temp raw video
                await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: cleanTempKey })).catch(() => {})
                await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: `adrolls-storage/${cleanTempKey}` })).catch(() => {})

                return NextResponse.json({ success: true, fallback: true, asset: insertedAsset })

            } catch (fallbackErr: any) {
                console.error('[VideoCompress API] Fallback copy failed:', fallbackErr)
                return NextResponse.json({ error: fallbackErr.message || 'System copy failure.' }, { status: 500 })
            }
        }

    } catch (outerErr: any) {
        console.error('[VideoCompress API] Outer system failure:', outerErr)
        return NextResponse.json({ error: outerErr.message || 'System error.' }, { status: 500 })
    }
}
