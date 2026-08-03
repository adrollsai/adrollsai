import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask, createGrokVideoTask, createGeminiTTS, queryKieTask } from '@/utils/external-apis';
import { createCollageImages } from '@/utils/collage-generator';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import crypto from 'crypto';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ensureJpegImage } from '@/utils/image-converter';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getTrimmedReferenceVideo(avatarUrl: string, userId: string): Promise<string> {
    let hash = crypto.createHash('md5').update(avatarUrl).digest('hex');
    try {
        const headRes = await fetch(avatarUrl, { method: 'HEAD' });
        const contentLength = headRes.headers.get('content-length') || '';
        const lastModified = headRes.headers.get('last-modified') || '';
        const eTag = headRes.headers.get('etag') || '';
        hash = crypto.createHash('md5').update(`${avatarUrl}_${contentLength}_${lastModified}_${eTag}`).digest('hex');
        console.log(`[Trim Video] Dynamic cache hash generated from HEAD headers: ${hash}`);
    } catch (e) {
        console.warn(`[Trim Video] HEAD request failed, using fallback hash for URL string: ${hash}`);
    }
    
    const cacheKey = `generated/${userId}/trimmed_ref_v2_${hash}.mp4`;
    const cachedUrl = `${R2_PUBLIC_URL}/${cacheKey}`;
    
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey
        }));
        console.log(`[Trim Video Cache] Found cached trimmed reference video: ${cachedUrl}`);
        return cachedUrl;
    } catch (e) {
        console.log(`[Trim Video Cache] No cache found. Starting download and trim for: ${avatarUrl}`);
    }

    // Call Cloud Run microservice first if configured
    const rendererUrl = process.env.REMOTION_RENDERER_URL;
    if (rendererUrl) {
        try {
            console.log(`[Trim Video] Calling Cloud Run renderer microservice to trim/scale: ${rendererUrl}/process-avatar`);
            const trimRes = await fetch(`${rendererUrl.replace(/\/$/, '')}/process-avatar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ avatarUrl, userId })
            });
            if (trimRes.ok) {
                const data = await trimRes.json();
                if (data.success && data.videoUrl) {
                    console.log(`[Trim Video] Cloud Run successfully processed video: ${data.videoUrl}`);
                    return data.videoUrl;
                }
            } else {
                console.error(`[Trim Video] Cloud Run returned non-ok status: ${trimRes.status} ${trimRes.statusText}`);
            }
        } catch (microserviceErr: any) {
            console.error(`[Trim Video] Cloud Run process-avatar call failed, falling back to local:`, microserviceErr.message);
        }
    }

    const tempDir = path.join(os.tmpdir(), `trim_${userId}_${Date.now()}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, 'input.mp4');
        const outputPath = path.join(tempDir, 'output.mp4');
        
        // 1. Download
        const res = await fetch(avatarUrl);
        if (!res.ok) throw new Error(`Failed to download reference video: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);
        
        // 2. Trim with FFmpeg
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const scaleFilter = "scale='trunc(min(iw\\,iw*sqrt(2000000/(iw*ih)))/2)*2':-2";
        const cmdTemplate = `FFMPEG_CMD -y -i "${inputPath}" -t 14 -vf "${scaleFilter}" -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${outputPath}"`;
        
        const executeFFmpegWithFallback = async (commandTemplate: string) => {
            const primaryCmd = commandTemplate.replace("FFMPEG_CMD", `"${ffmpegBinary}"`);
            try {
                await new Promise<void>((resolve, reject) => {
                    exec(primaryCmd, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } catch (primaryErr: any) {
                console.warn(`[Trim Video] Primary FFmpeg command failed. Retrying with global 'ffmpeg'... Error: ${primaryErr.message}`);
                const fallbackCmd = commandTemplate.replace("FFMPEG_CMD", "ffmpeg");
                await new Promise<void>((resolve, reject) => {
                    exec(fallbackCmd, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
        };

        try {
            await executeFFmpegWithFallback(cmdTemplate);
        } catch (err) {
            console.warn(`[Trim Video] Standard trim failed (likely due to corrupt audio stream). Retrying with silent video (-an)...`);
            const silentCmdTemplate = `FFMPEG_CMD -y -i "${inputPath}" -t 14 -vf "${scaleFilter}" -c:v libx264 -an -preset superfast -movflags +faststart "${outputPath}"`;
            await executeFFmpegWithFallback(silentCmdTemplate);
        }
        
        // 3. Upload to R2
        const trimmedBuffer = fs.readFileSync(outputPath);
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey,
            Body: trimmedBuffer,
            ContentType: 'video/mp4'
        }));
        
        console.log(`[Trim Video] Reference video successfully trimmed and uploaded: ${cachedUrl}`);
        return cachedUrl;
    } catch (err: any) {
        console.error("[Trim Video Error] Failed to trim, falling back to original URL:", err);
        return avatarUrl;
    } finally {
        // Clean up
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (err) {}
    }
}

async function extractReferenceAudio(videoUrl: string, userId: string): Promise<string> {
    const cacheKey = `generated/${userId}/ref_audio_${crypto.createHash('md5').update(videoUrl).digest('hex')}.mp3`;
    const cachedUrl = `${R2_PUBLIC_URL}/${cacheKey}`;
    
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey
        }));
        console.log(`[Extract Audio Cache] Found cached reference audio: ${cachedUrl}`);
        return cachedUrl;
    } catch (e) {
        console.log(`[Extract Audio Cache] No cache found. Starting download and audio extraction for: ${videoUrl}`);
    }

    const tempDir = path.join(os.tmpdir(), `audio_ext_${userId}_${Date.now()}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const inputPath = path.join(tempDir, 'input.mp4');
        const outputPath = path.join(tempDir, 'output.mp3');
        
        // 1. Download
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`Failed to download video: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(inputPath, buffer);
        
        // 2. Extract audio with FFmpeg
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules', 
            'ffmpeg-static', 
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -vn -c:a libmp3lame -q:a 2 "${outputPath}"`;
        
        await new Promise<void>((resolve, reject) => {
            exec(cmd, (err) => {
                if (err) {
                    console.warn(`[Extract Audio] Audio extraction failed (likely no audio track). Generating silent MP3 fallback...`);
                    const silentAudioCmd = `"${ffmpegBinary}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 14 -c:a libmp3lame -q:a 2 "${outputPath}"`;
                    exec(silentAudioCmd, (silentErr) => {
                        if (silentErr) reject(silentErr);
                        else resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
        
        // 3. Upload to R2
        const audioBuffer = fs.readFileSync(outputPath);
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: cacheKey,
            Body: audioBuffer,
            ContentType: 'audio/mpeg'
        }));
        
        console.log(`[Extract Audio] Reference audio successfully extracted and uploaded: ${cachedUrl}`);
        return cachedUrl;
    } catch (err: any) {
        console.error("[Extract Audio Error] Failed to extract audio, returning empty string:", err);
        return "";
    } finally {
        // Clean up
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (err) {}
    }
}

function extrapolateEthnicity(profile: any, property: any, customInstructions?: string): string {
    const textToSearch = [
        profile?.business_name,
        profile?.mission_statement,
        profile?.business_info,
        profile?.custom_prompt,
        property?.title,
        property?.description,
        property?.address,
        customInstructions
    ].filter(Boolean).join(' ').toLowerCase();

    if (textToSearch.includes('india') || textToSearch.includes('mohali') || textToSearch.includes('chandigarh') || textToSearch.includes('zirakpur') || textToSearch.includes('delhi') || textToSearch.includes('mumbai') || textToSearch.includes('bangalore') || textToSearch.includes('gurgaon') || textToSearch.includes('punjab') || textToSearch.includes('panchkula')) {
        return "Indian";
    }
    if (textToSearch.includes('dubai') || textToSearch.includes('uae') || textToSearch.includes('abudhabi') || textToSearch.includes('middle east') || textToSearch.includes('saudi') || textToSearch.includes('qatar') || textToSearch.includes('sharjah') || textToSearch.includes('marina') || textToSearch.includes('downtown')) {
        return "Arab/Middle Eastern";
    }
    if (textToSearch.includes('singapore') || textToSearch.includes('malaysia') || textToSearch.includes('china') || textToSearch.includes('japan') || textToSearch.includes('asia') || textToSearch.includes('hong kong')) {
        return "East Asian";
    }
    if (textToSearch.includes('spain') || textToSearch.includes('mexico') || textToSearch.includes('colombia') || textToSearch.includes('latam') || textToSearch.includes('brazil') || textToSearch.includes('spanish') || textToSearch.includes('argentina') || textToSearch.includes('chile')) {
        return "Hispanic/Latina";
    }
    if (textToSearch.includes('usa') || textToSearch.includes('america') || textToSearch.includes('uk') || textToSearch.includes('london') || textToSearch.includes('canada') || textToSearch.includes('australia') || textToSearch.includes('europe')) {
        return "Caucasian";
    }
    return "Indian";
}

export async function POST(request: Request) {
    let creditsDeductedSuccess = false;
    let totalCreditsRequired = 0;
    let targetUserId = '';
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { 
            propertyId, 
            script, // The script object { title, dialogue, visuals, finalCaption, refImages }
            images, // Reference images (up to 4)
            imageDescriptions,
            useCharacterVideo = true,
            language = 'hinglish',
            useUploadedAudio = true
        } = body;

        // Auto-extract and propagate custom instructions to all scene generations
        const customInstructions = body.customInstructions || script.concept?.description || script.concept?.visualConcept || 'None';

        if (!script || !script.dialogue) {
            return NextResponse.json({ error: 'Invalid script provided' }, { status: 400 });
        }

        // Clean dialogue to ensure no phone numbers or digits sequence get spoken
        if (script.dialogue) {
            script.dialogue = script.dialogue.replace(/\b\d{4,}\b/g, 'get in touch');
        }

        // Replace English spelling of Indian cities and proper nouns with Devanagari equivalents when in Hinglish/Hindi mode (prevents mispronunciation by TTS)
        if (language !== 'english') {
            const cityReplacements: { [key: string]: string } = {
                'Mohali': 'मोहाली',
                'Mohaali': 'मोहाली',
                'Chandigarh': 'चंडीगढ़',
                'New Chandigarh': 'न्यू चंडीगढ़',
                'Noida': 'नोएडा',
                'Gurgaon': 'गुड़गांव',
                'Gurugram': 'गुरुग्राम',
                'Delhi': 'दिल्ली',
                'Mumbai': 'मुंबई',
                'Bangalore': 'बेंगलुरु',
                'Bengaluru': 'बेंगलुरु',
                'Pune': 'पुणे',
                'Hyderabad': 'हैदराबाद',
                'Chennai': 'चेन्नई',
                'Kolkata': 'कोलकाता',
                'Zirakpur': 'ज़िरकपुर',
                'Panchkula': 'पंचकुला',
                'Ludhiana': 'लुधियाना',
                'Amritsar': 'अमृतसर',
                'Lucknow': 'लखनऊ',
                'Jaipur': 'जयपुर',
                'Goa': 'गोवा',
                'Ghaziabad': 'गाजियाबाद',
                'Faridabad': 'फरीदाबाद',
                'Rayat Bahra': 'रयात बहरा',
                'Rayat': 'रयात',
                'Bahra': 'बहरा',
                'Chitkara': 'चितकारा',
                'Amayra Sky City': 'अमायरा स्काई सिटी',
                'Amayra Sky': 'अमायरा स्काई',
                'Amayra': 'अमायरा',
                'Sky City': 'स्काई सिटी',
                'Kharar': 'खरड़',
                'University': 'यूनिवर्सिटी'
            };

            const replaceIndianCities = (text: string) => {
                if (!text) return text;
                let processed = text;
                const sortedCities = Object.keys(cityReplacements).sort((a, b) => b.length - a.length);
                for (const city of sortedCities) {
                    const regex = new RegExp(`\\b${city}\\b`, 'gi');
                    processed = processed.replace(regex, cityReplacements[city]);
                }
                return processed;
            };

            if (script.dialogue) {
                script.dialogue = replaceIndianCities(script.dialogue);
            }
            if (script.scenes && Array.isArray(script.scenes)) {
                script.scenes = script.scenes.map((scene: any) => {
                    if (scene.dialogue) {
                        scene.dialogue = replaceIndianCities(scene.dialogue);
                    }
                    if (scene.visuals) {
                        scene.visuals = replaceIndianCities(scene.visuals);
                    }
                    return scene;
                });
            }
        }

        const url = new URL(request.url)
        const impersonateId = url.searchParams.get('impersonate')

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
        targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
          ? (currentProfile.agency_id || currentProfile.parent_id) 
          : user.id

        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    const isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId);
                    const { data: subAccount } = await supabase
                      .from('profiles')
                      .select('id')
                      .eq('id', impersonateId)
                      .eq('agency_id', currentProfile?.agency_id || user.id)
                      .single()

                    if (isParent || subAccount) {
                        targetUserId = impersonateId
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
                    }
                } else {
                    targetUserId = impersonateId
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
            }
        }

        // --- QUOTA CHECK ---
        try {
            await checkLimitAndIncrement(targetUserId, 'videos');
        } catch (limitErr: any) {
            return NextResponse.json({ error: limitErr.message }, { status: 403 });
        }

        // 1. Fetch context details for Prompt synthesis
        let property: any = null;
        if (propertyId) {
            const { data } = await supabase
                .from('properties')
                .select('*')
                .eq('id', propertyId)
                .single();
            property = data;
        }

        let targetProfile: any = null;
        const selectWithAvatars = await supabase
            .from('profiles')
            .select('business_name, mission_statement, custom_prompt, character_url, character_description, character_audio_url, avatar_url, avatar_description, avatar_audio_url')
            .eq('id', targetUserId)
            .single();

        if (selectWithAvatars.error) {
            console.warn("[Video Generate] Failed to select with avatar_audio_url, retrying without it:", selectWithAvatars.error.message);
            const selectWithAvatarsOnly = await supabase
                .from('profiles')
                .select('business_name, mission_statement, custom_prompt, character_url, character_description, character_audio_url, avatar_url, avatar_description')
                .eq('id', targetUserId)
                .single();
            
            if (selectWithAvatarsOnly.error) {
                console.warn("[Video Generate] Failed to select with avatar columns, retrying without them:", selectWithAvatarsOnly.error.message);
                const selectWithoutAvatars = await supabase
                    .from('profiles')
                    .select('business_name, mission_statement, custom_prompt, character_url, character_description, character_audio_url')
                    .eq('id', targetUserId)
                    .single();
                targetProfile = selectWithoutAvatars.data;
            } else {
                targetProfile = selectWithAvatarsOnly.data;
            }
        } else {
            targetProfile = selectWithAvatars.data;
        }

        const videoModel = body.videoModel || 'seedance';
        const presenterType = body.presenterType || (useCharacterVideo ? 'video' : 'none');

        if (videoModel !== 'grok') {
            if (presenterType === 'video' && (!targetProfile || !targetProfile.character_url)) {
                return NextResponse.json({ 
                    error: 'Please upload a reference video in your Profile settings or Creation tab first before generating videos.' 
                }, { status: 400 });
            }

            if (presenterType === 'avatar' && (!targetProfile || !targetProfile.avatar_url)) {
                return NextResponse.json({ 
                    error: 'Please upload an avatar photo in your Profile settings or Creation tab first before generating videos.' 
                }, { status: 400 });
            }
        }

        let profile: any = targetProfile || {};

        // Self-heal: If character_url is present but character_description is null, analyze it on-the-fly!
        if (presenterType === 'video' && profile?.character_url && !profile.character_description) {
            try {
                console.log(`[Self-Healing] Character URL is present but description is null. Performing on-the-fly vision analysis for: ${profile.character_url}`);
                const imageRes = await fetch(profile.character_url);
                if (imageRes.ok) {
                    const buffer = Buffer.from(await imageRes.arrayBuffer());
                    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';
                    
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY!);
                    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
                    
                    const visionPrompt = "You are a casting director. Analyze this profile character photo and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.";
                    
                    const result = await model.generateContent([
                        visionPrompt,
                        {
                            inlineData: {
                                data: buffer.toString('base64'),
                                mimeType
                            }
                        }
                    ]);
                    
                    const desc = result.response.text()?.trim();
                    if (desc) {
                        console.log(`[Self-Healing] On-the-fly vision analysis success: "${desc}"`);
                        
                        // Update Supabase using a service role client to bypass client RLS rules
                        const { createClient: createAdminClient } = require('@supabase/supabase-js');
                        const supabaseAdmin = createAdminClient(
                            process.env.NEXT_PUBLIC_SUPABASE_URL!,
                            process.env.SUPABASE_SERVICE_ROLE_KEY!
                        );
                        await supabaseAdmin
                            .from('profiles')
                            .update({ character_description: desc })
                            .eq('id', targetUserId);
                        
                        // Update current object in memory
                        profile.character_description = desc;
                    }
                }
            } catch (visionErr) {
                console.error("[Self-Healing] Vision analysis failed:", visionErr);
            }
        }

        // Self-heal: If avatar_url is present but avatar_description is null, analyze it on-the-fly!
        if (presenterType === 'avatar' && profile?.avatar_url && !profile.avatar_description) {
            try {
                console.log(`[Self-Healing] Avatar URL is present but description is null. Performing on-the-fly vision analysis for: ${profile.avatar_url}`);
                const imageRes = await fetch(profile.avatar_url);
                if (imageRes.ok) {
                    const buffer = Buffer.from(await imageRes.arrayBuffer());
                    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';
                    
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY!);
                    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
                    
                    const visionPrompt = "You are a casting director. Analyze this profile character photo and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.";
                    
                    const result = await model.generateContent([
                        visionPrompt,
                        {
                            inlineData: {
                                data: buffer.toString('base64'),
                                mimeType
                            }
                        }
                    ]);
                    
                    const desc = result.response.text()?.trim();
                    if (desc) {
                        console.log(`[Self-Healing] Avatar on-the-fly vision analysis success: "${desc}"`);
                        
                        // Update Supabase using a service role client to bypass client RLS rules
                        const { createClient: createAdminClient } = require('@supabase/supabase-js');
                        const supabaseAdmin = createAdminClient(
                            process.env.NEXT_PUBLIC_SUPABASE_URL!,
                            process.env.SUPABASE_SERVICE_ROLE_KEY!
                        );
                        await supabaseAdmin
                            .from('profiles')
                            .update({ avatar_description: desc })
                            .eq('id', targetUserId);
                        
                        // Update current object in memory
                        profile.avatar_description = desc;
                    }
                }
            } catch (visionErr) {
                console.error("[Self-Healing] Avatar vision analysis failed:", visionErr);
            }
        }

        const productInfo = property ? `Product: ${property.title}. Description: ${property.description}` : 'Generic product promotion';
        const businessName = profile?.business_name || 'Your Business';
        const brandGuidelines = profile?.custom_prompt || 'Natural UGC style';

        // Extract reference images (max 4) - Filter out invalid placeholders/empty strings
        let rawImages: string[] = [];
        if (images && Array.isArray(images) && images.length > 0) {
            rawImages = images;
        } else if (script.refImages && Array.isArray(script.refImages) && script.refImages.length > 0) {
            rawImages = script.refImages;
        } else if (property) {
            if (property.images && Array.isArray(property.images) && property.images.length > 0) {
                rawImages = property.images;
            } else if (property.image_url) {
                rawImages = [property.image_url];
            }
        }

        const refImages = rawImages
            .filter(img => img && typeof img === 'string' && img.startsWith('http') && !img.includes('placeholder') && !img.includes('placehold') && img !== 'null' && img !== 'undefined')
            .slice(0, 8);

        // Prepare physical image descriptions (will be built dynamically below based on final image array mapping)

        // 2. Use custom uploaded profile avatar / reference video based on presenterType
        let avatarUrl = presenterType === 'video' ? profile.character_url : (presenterType === 'avatar' ? profile.avatar_url : null);
        let isCharacterVideo = presenterType === 'video';
        let isAvatarPhoto = presenterType === 'avatar';
        let referenceAudioUrl = (isCharacterVideo || isAvatarPhoto) && useUploadedAudio
            ? (isCharacterVideo ? (profile.character_audio_url || "") : (profile.avatar_audio_url || ""))
            : "";
        
        if (avatarUrl) {
            console.log(`[Video Generate] Using custom uploaded character ${isCharacterVideo ? 'video' : 'photo'} from profile: ${avatarUrl}`);
            if ((isCharacterVideo || isAvatarPhoto) && useUploadedAudio) {
                // Ensure they have uploaded a voice sample first
                if (!referenceAudioUrl) {
                    return NextResponse.json({ 
                        error: `Please upload a voice sample (up to 15s MP3/WAV) in your Profile Settings to enable voice cloning for your ${isCharacterVideo ? 'video character' : 'avatar character'}.` 
                    }, { status: 400 });
                }

                if (isCharacterVideo) {
                    try {
                        // Always use local Vercel trimming to guarantee scaling down to 1080p max width (Kie.ai limit)
                        avatarUrl = await getTrimmedReferenceVideo(avatarUrl, targetUserId);
                    } catch (delegateErr: any) {
                        console.error("[Video Generate] Local video trimming failed:", delegateErr.message);
                    }
                }
                
                console.log(`[Video Generate] Using uploaded voice sample directly: ${referenceAudioUrl}`);
            } else if (isCharacterVideo) {
                // Still trim the video reference even if not cloning voice
                try {
                    avatarUrl = await getTrimmedReferenceVideo(avatarUrl, targetUserId);
                } catch (delegateErr: any) {
                    console.error("[Video Generate] Local video trimming failed:", delegateErr.message);
                }
            }
        } else {
            console.log(`[Video Generate] Speaker reference is disabled (presenterType=none). Using generic presenter.`);
        }

        // Prepend the custom character avatar to the reference images (only if it's a photo, not a video)
        const combinedRefImages = (avatarUrl && !isCharacterVideo) ? [avatarUrl, ...refImages] : [...refImages];
        
        // Ensure all reference images are in JPEG format for Kie.ai compatibility
        console.log(`[Video Generate] Ensuring all reference images are JPEG format for user: ${targetUserId}`);
        const convertedRefImages = await Promise.all(
            combinedRefImages.map(imgUrl => ensureJpegImage(imgUrl, targetUserId))
        );
        
        // If the character is a video, build the reference_video_urls array for Kie.ai Seedance 2.0
        const referenceVideoUrls = (avatarUrl && isCharacterVideo) ? [avatarUrl] : [];

        // 3. Synthesize structured prompts for each scene using Gemini or use provided prompts
        let prompts: string[] = [];
        const scenes = script.scenes || [{ dialogue: script.dialogue, visuals: script.visuals }];
        
        // Prepare precise image mapping instructions to prevent any ambiguity for Kie.ai Seedance 2.0
        let preciseImageMapping = [];
        let currentIndex = 1;
        if (avatarUrl && !isCharacterVideo) {
            preciseImageMapping.push(`Image_1 (reference_image_urls[0]): Presenter Avatar Photo (used ONLY for character face/identity consistency, NOT for scenes background)`);
            currentIndex = 2;
        }
        
        const listingDescriptions = imageDescriptions || script.imageDescriptions || [];
        for (let i = 0; i < refImages.length; i++) {
            const desc = listingDescriptions[i] || `Property photo showing scene/features`;
            preciseImageMapping.push(`Image_${currentIndex} (reference_image_urls[${currentIndex - 1}]): Property Listing Image ${i + 1} - Description: "${desc}"`);
            currentIndex++;
        }
        
        const descriptionsText = preciseImageMapping.join('\n') || 'No detailed image descriptions provided.';

        if (body.prompts && Array.isArray(body.prompts) && body.prompts.length > 0) {
            console.log(`[Video Generate] Using user-provided custom prompts (length: ${body.prompts.length})`);
            prompts = body.prompts;
        } else if (videoModel !== 'grok') {
            // Extrapolate ethnicity based on where the business is based
            const extrapolatedEthnicity = extrapolateEthnicity(profile, property, customInstructions);
            
            const profileDesc = presenterType === 'video' ? profile.character_description : (presenterType === 'avatar' ? profile.avatar_description : null);

            // Character description — fed directly to Gemini
            const characterDescription = presenterType !== 'none'
                ? (profileDesc || `a stunningly beautiful, highly attractive, charismatic ${extrapolatedEthnicity} female UGC content creator with a fair complexion, smiling warmly`)
                : `a stunningly beautiful, highly charismatic ${extrapolatedEthnicity} female UGC content creator, smiling warmly and speaking directly to the camera`;

            for (let i = 0; i < scenes.length; i++) {
                const scene = scenes[i];

                const characterAppearanceText = isCharacterVideo
                     ? `Use reference video ONLY for character facial appearance and identity consistency.\n\n${referenceAudioUrl ? "Use reference audio ONLY for voice characteristics.\n\n" : ""}Duration: 15 seconds\nAspect Ratio: 9:16`
                     : `Use reference image ONLY for character facial appearance and identity consistency.\n\n${referenceAudioUrl ? "Use reference audio ONLY for voice characteristics.\n\n" : ""}Duration: 15 seconds\nAspect Ratio: 9:16`;

                const synthesisPrompt = `You are a video generation prompt engineer for Bytedance/Kie.ai Seedance 2.0.
Your task is to write a highly cohesive, concise prompt (around 120-150 words) for a 15-second UGC talking-head video scene.

CREATOR CHARACTER:
- Description: "${characterDescription}"

SCENE DETAILS:
- Dialogue: "${scene.dialogue}"
- Visuals/Camera: "${scene.visuals || 'closeup tracking shot looking directly at the camera'}"

Write the prompt following this exact structure and length:
1. Cloning: "Use the reference video to faithfully clone both the person's face and voice. Preserve the person's identity, facial features, hairstyle, skin tone, clothing style, body language, facial expressions, and speaking style exactly as seen in the reference. Clone the voice with the same accent, tone, pitch, pacing, pronunciation, and emotional delivery."
2. Setting/Camera/Actions: Describe the scene setting and actions. You MUST strictly base this description on the scene visuals instruction: "${scene.visuals || 'closeup tracking shot'}". Do NOT make up default settings or generic offices if "${scene.visuals || ''}" specifies walking, a highstreet, B-rolls, or specific movements. Make the presenter walk, gesturate, or sit exactly as "${scene.visuals || ''}" describes, matching the character style.
3. Video specifications: "There should be no text captions on screen. Generate a highly photorealistic talking-head video with accurate lip synchronization. The speaker should maintain direct eye contact with the camera, use natural blinking, subtle head movements, and realistic hand gestures. Deliver the dialogue confidently and naturally like a professional advisor. Keep the speech conversational, expressive, and human-like. Avoid robotic delivery or exaggerated acting."
4. Dialogue: Add a newline, then "Dialogue", then a newline, then print the exact dialogue wrapped in quotes.
For example:
Dialogue

"${scene.dialogue}"

Output ONLY the raw final prompt text. Do NOT wrap it in markdown code blocks or backticks.`;

                let finalPrompt = "";
                console.log(`[Generate API] Generating prompt for scene ${i + 1} with primary model: gemini-3.5-flash`);
                try {
                    const res = await generateText({
                        model: google('gemini-3.5-flash'),
                        prompt: synthesisPrompt,
                    });
                    finalPrompt = res.text.trim();
                } catch (e35: any) {
                    try {
                        const res = await generateText({
                            model: google('gemini-2.0-flash'),
                            prompt: synthesisPrompt,
                        });
                        finalPrompt = res.text.trim();
                    } catch (e20: any) {
                        try {
                            const res = await generateText({
                                model: google('gemini-1.5-flash'),
                                prompt: synthesisPrompt,
                            });
                            finalPrompt = res.text.trim();
                        } catch (fallbackErr: any) {
                            console.error(`[Generate API] Fallback prompt synthesis also failed for scene ${i + 1}:`, fallbackErr);
                            const targetImageLabel = (avatarUrl && !isCharacterVideo) ? "Image_2" : "Image_1";
                            const cleanFallbackDialogue = scene.dialogue;
                            finalPrompt = `${characterAppearanceText}\n\nThe video opens in a premium, warm real estate setting.\nA professional female UGC presenter stands in a detailed closeup shot looking directly into the camera.\nShe says:\n"${cleanFallbackDialogue}"\nThe camera slowly dollies toward the presenter's face.\nTransition to a wide scenic shot showing the product/property matching the supplied reference image 1 (${targetImageLabel}) from super far away so that no human face is visible or mutated.\nProfessional real estate home tour.\nPhotorealistic.\nUltra-realistic human motion.\nNatural body language.\nPerfect lip synchronization.\nLuxury property marketing video.\nSmooth steadycam movement.\nCinematic architectural videography.\nPremium lighting.\nNo AI artifacts.\nHigh-end commercial production quality.\n15-second continuous shot.`;
                        }
                    }
                }
                prompts.push(finalPrompt);
            }
        }

        // Return early if preview mode is requested
        if (body.preview === true) {
            console.log(`[Video Generate] Preview mode. Returning synthesized prompts without starting tasks.`);
            return NextResponse.json({
                success: true,
                prompts
            });
        }

        // --- CREDITS CHECK & DEDUCTION ---
        const totalDurationForCredits = videoModel === 'grok' ? (body.duration || 30) : (prompts.length * 15);
        const requiredClipCount = Math.max(1, Math.round(totalDurationForCredits / 15));
        totalCreditsRequired = requiredClipCount * 250;
        const { hasEnoughCredits, deductCredits, addCredits } = await import('@/utils/credits');
        const hasCredits = await hasEnoughCredits(supabaseAdmin, targetUserId, totalCreditsRequired);
        if (!hasCredits) {
            await refundLimit(targetUserId, 'videos');
            return NextResponse.json({ 
                error: `Insufficient credits. You need at least ${totalCreditsRequired} Nobo Credits to generate this ${prompts.length * 15}-second video.` 
            }, { status: 402 });
        }

        const creditsDeducted = await deductCredits(
            supabaseAdmin, 
            targetUserId, 
            totalCreditsRequired, 
            'ai_generation', 
            `AI Video Generation (${prompts.length} x 15s clips) - ${script.title || 'Video'}`
        );
        if (!creditsDeducted) {
            await refundLimit(targetUserId, 'videos');
            return NextResponse.json({ error: 'Failed to process credit deduction.' }, { status: 500 });
        }
        creditsDeductedSuccess = true;

        // 4. Create Placeholder Asset (Spinning Card) in Supabase
        const { data: newAsset, error: newAssetError } = await supabaseAdmin
            .from('assets')
            .insert({
                user_id: targetUserId,
                property_id: propertyId || null,
                type: 'video',
                status: 'Processing',
                url: 'https://designs.adrolls.in/processing', // Temporary URL
                caption: script.finalCaption || `${script.title}\n\n${script.dialogue}`,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (newAssetError || !newAsset) {
            console.error("Placeholder creation failed:", newAssetError);
            await refundLimit(targetUserId, 'videos');
            return NextResponse.json({ error: "Failed to initialize video asset" }, { status: 500 });
        }

        // --- BASE URL DETECTION FOR WEBHOOKS ---
        const forwardedHost = request.headers.get('x-forwarded-host');
        const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
        const requestOrigin = new URL(request.url).origin;
        const publicUrl = process.env.NEXT_PUBLIC_APP_URL;

        let baseUrl = requestOrigin;
        if (forwardedHost && !forwardedHost.includes('localhost')) {
            baseUrl = `${forwardedProto}://${forwardedHost}`;
        } else if (!requestOrigin.includes('localhost')) {
            baseUrl = requestOrigin;
        } else if (publicUrl && publicUrl.startsWith('http') && !publicUrl.includes('localhost')) {
            baseUrl = publicUrl;
        }

        const callbackUrl = `${baseUrl}/api/video/callback`;

        console.log(`[Video Generate] Source Origin: ${requestOrigin}, Selected Base: ${baseUrl}`);
        console.log(`[Video Generate] Using callback URL: ${callbackUrl}`);
        
        if (baseUrl.includes('localhost')) {
            console.warn("[Video Generate] WARNING: Using localhost for callback! Kie.ai will NOT be able to reach your server.");
        }

        const audioUrl = body.audioUrl || null;
        const selectedDuration = body.duration || 30;

        // 5. Launch Tasks based on Model (Seedance vs Grok)
        const taskIds: string[] = [];
        const launchErrors: string[] = [];

        if (videoModel === 'grok') {
            console.log(`[Video Generate] Running GROK IMAGINE 1.5 pipeline for target user ${targetUserId}...`);

            // Generate TTS voiceover task asynchronously from script dialogue (without blocking HTTP response)
            let grokAudioUrl: string | null = audioUrl;
            if (!grokAudioUrl && script.dialogue && script.dialogue.trim().length > 10) {
                try {
                    console.log(`[Video Generate] Launching asynchronous Gemini TTS task for Grok pipeline...`);
                    const { taskId: ttsTaskId } = await createGeminiTTS({
                        dialogueText: script.dialogue.trim(),
                        speakerName: body.grokVoice || 'Aoede',
                        style: '',
                        scene: 'Professional real estate commercial voiceover studio',
                        sampleContext: 'High converting luxury real estate marketing video'
                    });
                    if (ttsTaskId) {
                        console.log(`[Video Generate] Gemini TTS task launched: ${ttsTaskId}`);
                        // Store the TTS task ID format so callback can resolve audio URL if needed
                        grokAudioUrl = `tts:${ttsTaskId}`;
                        await supabaseAdmin.from('assets').update({ metadata: { audioUrl: grokAudioUrl } }).eq('id', newAsset.id);
                    }
                } catch (ttsErr: any) {
                    console.warn('[Video Generate] Asynchronous TTS voiceover launch warning:', ttsErr.message);
                }
            } else if (grokAudioUrl) {
                await supabaseAdmin.from('assets').update({ metadata: { audioUrl: grokAudioUrl } }).eq('id', newAsset.id);
            }

            let grokPrompts: string[] = [];
            let collageUrls: (string | undefined)[] = [];

            const requiredClips = Math.max(1, Math.round(selectedDuration / 15));
            console.log(`[Grok Pipeline] Video duration: ${selectedDuration}s -> Generating ${requiredClips} Grok scene clips...`);

            // Generate 9:16 collages if reference images are provided
            let generatedCollages: string[] = [];
            if (convertedRefImages.length > 0) {
                console.log(`[Grok Pipeline] Creating 9:16 collages for ${convertedRefImages.length} input image(s)...`);
                generatedCollages = await createCollageImages(convertedRefImages, targetUserId);
                console.log(`[Grok Pipeline] Created ${generatedCollages.length} collages:`, generatedCollages);
            }

            for (let i = 0; i < requiredClips; i++) {
                const hasImageForClip = i < generatedCollages.length;
                let colUrl: string | undefined = hasImageForClip ? generatedCollages[i] : undefined;

                const currentSceneObj = scenes[i % scenes.length];
                const sceneDialogue = currentSceneObj?.dialogue || script.dialogue || '';
                const sceneVisuals = currentSceneObj?.visuals || script.visuals || script.concept?.visualConcept || '';
                const productTitle = script.title || property?.title || 'Featured Product/Business';
                const productContext = property?.description || script.finalCaption || '';

                console.log(`[Grok Pipeline] Synthesizing Master Multi-Cut Grok prompt for Scene ${i + 1}/${requiredClips}...`);

                const scenePromptGen = `You are an elite commercial ad director specializing in high-converting, fast-paced commercial ads across all industries (Real Estate, SaaS, E-Commerce, Hospitality, Health, Fashion, Automotive, etc.).

Write an ultra-realistic 9:16 commercial video prompt for Scene ${i + 1} of ${requiredClips} for an AI video model (Grok Imagine 1.5).

PRODUCT / BRAND / INDUSTRY CONTEXT:
- Business/Product Title: "${productTitle}"
- Product Description & Context: "${productContext.slice(0, 400)}"

SCRIPT SCENE ${i + 1} DIRECTIVES:
- Visual Action: "${sceneVisuals}"
- Visual Concept Context: "${sceneDialogue}"

MASTER AD PROMPTING RULES:
1. SCENE START & DYNAMIC CUTS DIRECTIVE: The prompt MUST strictly begin with: "The scene starts immediately from second 0 with rapid, high-energy commercial cuts changing every 2 seconds where..."
2. MULTI-SHOT SEQUENCE STRUCTURE (Rapid Cuts Every 2 Seconds):
   - Shot 1 (0-2s): Instant macro detail or hero product shot highlighting key benefits of "${productTitle}".
   - Shot 2 (2-4s): Authentic human emotional reaction (e.g. customer gasping in delight, smiling warmly, nodding in approval, sharing a joyful moment, or experiencing relief).
   - Shot 3 (4-6s): Dynamic action shot showcasing the product in use or sweeping visual environment (${sceneVisuals}).
   - Shot 4 (6-8s+): Macro texture close-up or satisfying result sequence reflecting high value and satisfaction.
3. STRICT NO VOICEOVER / NO SPOKEN DIALOGUE RULE: The video must contain STRICTLY ZERO voiceover, NO spoken speech, NO spoken dialogue, NO actors speaking, NO voiceover narration, and NO talking heads. People in the video show real human emotions, genuine expressions, and physical interactions, but strictly NO talking to camera, NO speaking lips, and NO voiceover speech of any kind.
4. REFERENCE IMAGE INTEGRATION: ${hasImageForClip ? `"Reference 9:16 collage image as visual identity lock. Seamlessly integrate the colors, product design, architectural style, and visual aesthetics from the reference image across the fast-cut sequence."` : `"Create photorealistic 9:16 commercial visuals representing the product in action."`}
5. CINEMATOGRAPHY: 35mm anamorphic camera, cinematic lighting, 9:16 portrait aspect ratio, dynamic camera whip pans, macro focus transitions, upbeat background instrumental music track with ZERO voiceover.
6. NO ON-SCREEN TEXT: Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind.
7. SILENT VOICEOVER DIRECTIVE: Strictly specify: "Completely mute voiceover, zero spoken dialogue, zero speech, no talking heads. Pure visual commercial sequence."

Output ONLY the raw final prompt text in 3-4 vivid sentences (90-130 words). Do NOT use markdown code blocks or quotes.`;

                let finalGrokPrompt = "";
                try {
                    console.log(`[Grok Pipeline] Generating prompt for scene ${i + 1} with primary model: gemini-3.5-flash`);
                    let text = "";
                    try {
                        const res = await generateText({
                            model: google('gemini-3.5-flash'),
                            prompt: scenePromptGen
                        });
                        text = res.text;
                    } catch (e35: any) {
                        try {
                            const res = await generateText({
                                model: google('gemini-2.0-flash'),
                                prompt: scenePromptGen
                            });
                            text = res.text;
                        } catch (e20: any) {
                            const res = await generateText({
                                model: google('gemini-1.5-flash'),
                                prompt: scenePromptGen
                            });
                            text = res.text;
                        }
                    }
                    let synthesized = text.trim();
                    if (!synthesized.toLowerCase().includes('starts immediately from second 0') && !synthesized.toLowerCase().includes('starts from second 0')) {
                        synthesized = `The scene starts immediately from second 0 with rapid, high-energy commercial cuts changing every 2 seconds where... ${synthesized}`;
                    }
                    if (!synthesized.toLowerCase().includes('no voiceover') && !synthesized.toLowerCase().includes('zero voiceover')) {
                        synthesized += ` People show emotion but strictly NO voiceover, NO spoken dialogue, NO spoken audio, NO speech, and NO talking to camera.`;
                    }
                    finalGrokPrompt = synthesized;
                } catch (genErr) {
                    console.warn(`[Grok Pipeline] Gemini master prompt synthesis failed for scene ${i + 1}, using intelligent multi-cut fallback:`, genErr);
                    finalGrokPrompt = `The scene starts immediately from second 0 with rapid, high-energy commercial cuts changing every 2 seconds where an opening hero macro shot showcases "${productTitle}", cutting instantly to an delighted customer smiling warmly with genuine excitement, followed by a dynamic tracking shot of ${sceneVisuals || 'the featured product in action'}, ending on a sleek macro texture close-up. Cinematic 35mm anamorphic camera, dynamic lighting, 9:16 portrait aspect ratio, upbeat background instrumental music track. People show emotion but strictly NO voiceover, NO spoken dialogue, NO spoken audio, NO speech, and NO talking to camera. Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, or text overlays of any kind.`;
                }

                grokPrompts.push(finalGrokPrompt);
                collageUrls.push(colUrl);
            }

            const grokLaunchPromises = grokPrompts.map(async (promptText, index) => {
                const colUrl = collageUrls[index];
                console.log(`[Video Generate] Launching Grok Imagine task ${index + 1}/${grokPrompts.length}...`);

                const { taskId, error: grokError } = await createGrokVideoTask({
                    prompt: promptText,
                    collageImageUrl: colUrl,
                    aspectRatio: "9:16",
                    resolution: "480p",
                    duration: 15,
                    callBackUrl: callbackUrl
                });

                if (grokError || !taskId) {
                    launchErrors.push(grokError || `Grok Scene ${index + 1} task failed to launch`);
                } else {
                    taskIds[index] = taskId;
                    console.log(`[Video Generate] Launched Grok task ${index + 1}: ${taskId}`);
                }
            });

            await Promise.all(grokLaunchPromises);

            if (launchErrors.length > 0 || taskIds.filter(Boolean).length !== grokPrompts.length) {
                await supabaseAdmin.from('assets').delete().eq('id', newAsset.id);
                await refundLimit(targetUserId, 'videos');
                await addCredits(supabaseAdmin, targetUserId, totalCreditsRequired, 'ai_generation', `Refund: Grok Video Generation failed to launch`);
                creditsDeductedSuccess = false;

                return NextResponse.json({ error: launchErrors.join(', ') || "Failed to start Grok video generation" }, { status: 500 });
            }

            // Save records in video_tasks table
            const insertPromises = taskIds.map(async (taskId, index) => {
                const { error: insertErr } = await supabaseAdmin
                    .from('video_tasks')
                    .insert({
                        id: crypto.randomUUID(),
                        user_id: targetUserId,
                        property_id: propertyId || null,
                        asset_id: newAsset.id,
                        prompts: grokPrompts,
                        current_index: index,
                        last_task_id: taskId,
                        last_successful_task_id: collageUrls[index] || null,
                        aspect_ratio: "9:16",
                        status: 'Processing',
                        audio_url: grokAudioUrl || null,
                        final_caption: script.finalCaption || null
                    });
                if (insertErr) {
                    console.error(`[Video Generate] Failed to insert video_tasks row for scene ${index + 1}:`, insertErr);
                }
            });

            await Promise.all(insertPromises);

            return NextResponse.json({
                success: true,
                assetId: newAsset.id,
                taskIds,
                message: `${grokPrompts.length}-clip Grok Imagine 1.5 video generation started.`
            });

        } else {
            // 5. Launch Bytedance Seedance 2.0 Fast tasks in parallel
            const launchPromises = prompts.map(async (promptText, index) => {
                const payload: any = {
                    model: "bytedance/seedance-2-fast",
                    callBackUrl: callbackUrl,
                    input: {
                        prompt: `${promptText} Absolutely NO text, NO titles, NO on-screen captions, NO lower thirds, NO text overlays, or subtitles of any kind.`,
                        aspect_ratio: "9:16",
                        duration: 15,
                        generate_audio: true,
                        resolution: "480p",
                        nsfw_checker: true,
                        web_search: false
                    }
                };
                
                if (convertedRefImages.length > 0) {
                    payload.input.reference_image_urls = convertedRefImages.slice(0, 9);
                }
                
                if (referenceVideoUrls.length > 0) {
                    payload.input.reference_video_urls = referenceVideoUrls;
                }

                if ((isCharacterVideo || isAvatarPhoto) && useUploadedAudio) {
                    if (!referenceAudioUrl) {
                        throw new Error("Reference audio extraction failed. Please ensure your Cloud Run service is deployed and running, and that your uploaded presenter asset has a valid, audible voice sample.");
                    }
                    payload.input.reference_audio_urls = [referenceAudioUrl];
                }
                
                console.log(`[Video Generate] Launching Kie task for Scene ${index + 1}...`);
                const { taskId, error: kieError } = await createKieTask(payload);
                if (kieError || !taskId) {
                    launchErrors.push(kieError || `Scene ${index + 1} task failed to launch`);
                } else {
                    taskIds[index] = taskId;
                }
            });
            
            await Promise.all(launchPromises);
            
            if (launchErrors.length > 0 || taskIds.filter(Boolean).length !== prompts.length) {
                await supabaseAdmin.from('assets').delete().eq('id', newAsset.id);
                await refundLimit(targetUserId, 'videos');
                await addCredits(supabaseAdmin, targetUserId, totalCreditsRequired, 'ai_generation', `Refund: AI Video Generation failed to launch`);
                creditsDeductedSuccess = false;

                return NextResponse.json({ error: launchErrors.join(', ') || "Failed to start parallel video generations" }, { status: 500 });
            }

            const insertPromises = taskIds.map((taskId, index) => {
                return supabaseAdmin
                    .from('video_tasks')
                    .insert({
                        id: crypto.randomUUID(),
                        user_id: targetUserId,
                        property_id: propertyId || null,
                        asset_id: newAsset.id,
                        prompts: prompts,
                        current_index: index,
                        last_task_id: taskId,
                        last_successful_task_id: avatarUrl,
                        aspect_ratio: "9:16",
                        status: 'Processing',
                        final_caption: script.finalCaption || null
                    });
            });
            
            await Promise.all(insertPromises);

            return NextResponse.json({ 
                success: true, 
                assetId: newAsset.id,
                taskIds, 
                message: `${prompts.length}-clip parallel Seedance 2.0 Fast video generation started.` 
            });
        }

    } catch (error: any) {
        console.error("Video Generate Error:", error);
        if (creditsDeductedSuccess) {
            try {
                await refundLimit(targetUserId, 'videos');
                const { addCredits } = await import('@/utils/credits');
                await addCredits(supabaseAdmin, targetUserId, totalCreditsRequired, 'ai_generation', `Refund: AI Video Generation failed`);
            } catch (refundErr) {
                console.error("Failed to refund credit/limit in catch block:", refundErr);
            }
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
