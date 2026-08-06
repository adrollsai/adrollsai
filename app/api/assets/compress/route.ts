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
            : tempUrl.replace(`${R2_PUBLIC_URL}/`, '').replace(/^https?:\/\/[^\/]+\//, '').replace(/^\//, '')

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
                    console.warn(`[VideoCompress API] S3 GetObject failed for ${cleanTempKey}, trying clean fetch...`)
                }

                if (!downloaded) {
                    let response: Response | null = null
                    const cleanFetchUrl = tempUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/')
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            response = await fetch(cleanFetchUrl)
                            if (response && response.ok) break
                        } catch (e) {}
                        if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
                    }
                    if (response && response.ok) {
                        const arrayBuffer = await response.arrayBuffer()
                        const buffer = Buffer.from(arrayBuffer)
                        fs.writeFileSync(inputPath, buffer)
                        inputCreated = true
                        downloaded = true
                    }
                }

                if (downloaded && fs.existsSync(inputPath)) {
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
                        ContentType: 'video/mp4'
                    }
                    await r2.send(new PutObjectCommand(uploadParams))

                    // 4. Generate thumbnail
                    let thumbnailUrl = null
                    try {
                        thumbnailUrl = await generateAndUploadVideoThumbnail(outputPath, targetUserId, crypto.randomUUID())
                    } catch (thumbErr) {
                        console.error("[VideoCompress API] Thumbnail generation failed:", thumbErr)
                    }

                    // 5. Register in Supabase Assets
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

                    // Clean up raw video from temp R2
                    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: cleanTempKey })).catch(() => {})

                    return NextResponse.json({ success: true, asset: insertedAsset })
                } else {
                    shouldCompress = false
                }

            } catch (innerErr: any) {
                console.warn('[VideoCompress API] Compression failed, falling back to copying raw file:', innerErr)
                shouldCompress = false
            } finally {
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
                const keyCandidates = [
                    cleanTempKey,
                    `temp/raw-videos/${cleanName}`,
                    `adrolls-storage/${cleanTempKey}`
                ]

                for (const candKey of keyCandidates) {
                    try {
                        const copySource = `${R2_BUCKET}/${candKey}`
                        await r2.send(new CopyObjectCommand({
                            Bucket: R2_BUCKET,
                            CopySource: copySource,
                            Key: permanentKey
                        }))
                        copySuccess = true
                        console.log(`[VideoCompress API] CopyObjectCommand succeeded for candidate: ${candKey}`)
                        break
                    } catch (copyErr: any) {}
                }

                const rawPublicUrl = tempUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/')
                const finalUrlToSave = copySuccess ? finalPublicUrl : rawPublicUrl

                const { data: insertedAsset, error: insertError } = await supabase
                    .from('assets')
                    .insert({
                        user_id: targetUserId,
                        type: 'video',
                        url: finalUrlToSave,
                        status: 'Ready',
                        caption: `Uploaded: ${fileName}`,
                        property_id: propertyId || null,
                        created_at: new Date().toISOString(),
                        metadata: {
                            custom_instructions: customInstructions || null
                        }
                    })
                    .select()
                    .single()

                if (insertError) throw insertError

                if (copySuccess) {
                    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: cleanTempKey })).catch(() => {})
                }

                return NextResponse.json({ success: true, fallback: true, asset: insertedAsset })

            } catch (fallbackErr: any) {
                console.error('[VideoCompress API] Fallback copy failed, saving temp URL directly:', fallbackErr)
                // Ultimate Fallback: Register asset directly using original temp URL so upload NEVER fails for user
                const rawPublicUrl = tempUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/')
                const { data: insertedAsset } = await supabase
                    .from('assets')
                    .insert({
                        user_id: targetUserId,
                        type: 'video',
                        url: rawPublicUrl,
                        status: 'Ready',
                        caption: `Uploaded: ${fileName}`,
                        property_id: propertyId || null,
                        created_at: new Date().toISOString(),
                        metadata: {
                            custom_instructions: customInstructions || null
                        }
                    })
                    .select()
                    .single()

                return NextResponse.json({ success: true, fallback: true, asset: insertedAsset || { url: rawPublicUrl } })
            }
        }

    } catch (outerErr: any) {
        console.error('[VideoCompress API] Outer system failure:', outerErr)
        return NextResponse.json({ error: outerErr.message || 'System error.' }, { status: 500 })
    }
}
