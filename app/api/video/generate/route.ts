import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask } from '@/utils/external-apis';
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

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getTrimmedReferenceVideo(avatarUrl: string, userId: string): Promise<string> {
    const cacheKey = `generated/${userId}/trimmed_ref_${crypto.createHash('md5').update(avatarUrl).digest('hex')}.mp4`;
    const cachedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${cacheKey}`;
    
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
        const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 15 -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${outputPath}"`;
        
        await new Promise<void>((resolve, reject) => {
            exec(cmd, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
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
    const cachedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${cacheKey}`;
    
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
                if (err) reject(err);
                else resolve();
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
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { 
            propertyId, 
            script, // The Hinglish script object { title, dialogue, visuals, finalCaption, refImages }
            images, // Reference images (up to 4)
            imageDescriptions,
            useCharacterVideo = true
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

        const url = new URL(request.url)
        const impersonateId = url.searchParams.get('impersonate')

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
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
            await checkLimitAndIncrement(targetUserId, 'ai_creatives');
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

        const { data: targetProfile } = await supabase
            .from('profiles')
            .select('business_name, mission_statement, custom_prompt, character_url, character_description')
            .eq('id', targetUserId)
            .single();

        if (useCharacterVideo !== false && (!targetProfile || !targetProfile.character_url)) {
            return NextResponse.json({ 
                error: 'Please upload a character photo in your profile settings first before generating videos.' 
            }, { status: 400 });
        }

        let profile: any = targetProfile || {};

        // Self-heal: If character_url is present but character_description is null, analyze it on-the-fly!
        if (useCharacterVideo !== false && profile?.character_url && !profile.character_description) {
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

        // Prepare physical image descriptions
        const descriptionsText = (imageDescriptions || script.imageDescriptions || [])
            .map((desc: string, i: number) => `- Reference Image ${i + 1} description: "${desc}"`)
            .join('\n') || 'No detailed image descriptions provided. Describe the images based on standard product expectations.';

        // 2. Use custom uploaded profile avatar (checked and guaranteed to exist when useCharacterVideo is true)
        let avatarUrl = useCharacterVideo !== false ? profile.character_url : null;
        let isCharacterVideo = avatarUrl && (/\.(mp4|webm|mov|avi|wmv)/i.test(avatarUrl) || avatarUrl.includes('video'));
        let referenceAudioUrl = "";
        
        if (avatarUrl) {
            console.log(`[Video Generate] Using custom uploaded character ${isCharacterVideo ? 'video' : 'photo'} from profile: ${avatarUrl}`);
            if (isCharacterVideo) {
                try {
                    const rendererUrl = process.env.REMOTION_RENDERER_URL || 'http://127.0.0.1:8080';
                    console.log(`[Video Generate] Delegating avatar processing to Cloud Run: ${rendererUrl}/process-avatar`);
                    const response = await fetch(`${rendererUrl.replace(/\/$/, '')}/process-avatar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            avatarUrl,
                            userId: targetUserId
                        })
                    });
                    
                    if (response.ok) {
                        const resData = await response.json();
                        if (resData.success && resData.videoUrl && resData.audioUrl) {
                            avatarUrl = resData.videoUrl;
                            referenceAudioUrl = resData.audioUrl;
                            console.log(`[Video Generate] Cloud Run delegation success! Video: ${avatarUrl}, Audio: ${referenceAudioUrl}`);
                        } else {
                            throw new Error("Cloud Run returned incomplete data");
                        }
                    } else {
                        const errText = await response.text();
                        throw new Error(`Cloud Run returned status ${response.status}: ${errText}`);
                    }
                } catch (delegateErr: any) {
                    console.warn(`[Video Generate] Cloud Run delegation failed, falling back to local Vercel execution:`, delegateErr.message);
                    
                    console.log(`[Video Generate] Reference video detected. Invoking getTrimmedReferenceVideo...`);
                    avatarUrl = await getTrimmedReferenceVideo(avatarUrl, targetUserId);
                    console.log(`[Video Generate] Using trimmed reference video URL: ${avatarUrl}`);
                    
                    console.log(`[Video Generate] Extracting audio from reference video...`);
                    referenceAudioUrl = await extractReferenceAudio(avatarUrl, targetUserId);
                    console.log(`[Video Generate] Using extracted reference audio URL: ${referenceAudioUrl}`);
                }
            }
        } else {
            console.log(`[Video Generate] Speaker reference is disabled (useCharacterVideo=false). Using generic presenter.`);
        }

        // Prepend the custom character avatar to the reference images (only if it's a photo, not a video)
        const combinedRefImages = (avatarUrl && !isCharacterVideo) ? [avatarUrl, ...refImages] : [...refImages];
        
        // If the character is a video, build the reference_video_urls array for Kie.ai Seedance 2.0
        const referenceVideoUrls = (avatarUrl && isCharacterVideo) ? [avatarUrl] : [];

        // 3. Synthesize structured prompts for each scene using Gemini or use provided prompts
        let prompts: string[] = [];
        const scenes = script.scenes || [{ dialogue: script.dialogue, visuals: script.visuals }];
        
        if (body.prompts && Array.isArray(body.prompts) && body.prompts.length > 0) {
            console.log(`[Video Generate] Using user-provided custom prompts (length: ${body.prompts.length})`);
            prompts = body.prompts;
        } else {
            // Extrapolate ethnicity based on where the business is based
            const extrapolatedEthnicity = extrapolateEthnicity(profile, property, customInstructions);
            
            // Character description — fed directly to Gemini
            const characterDescription = (useCharacterVideo !== false && profile?.character_url)
                ? (profile?.character_description || `a stunningly beautiful, highly attractive, charismatic ${extrapolatedEthnicity} female UGC content creator with a fair complexion, smiling warmly`)
                : `a stunningly beautiful, highly charismatic ${extrapolatedEthnicity} female UGC content creator, smiling warmly and speaking directly to the camera`;

            for (let i = 0; i < scenes.length; i++) {
                const scene = scenes[i];

                const p1Instruction = isCharacterVideo
                    ? "Use the reference video only for the character's appearance and use the attached reference audio for cloning the voice. Keep the same face and the same voice as in the reference video and audio respectively without the reverb and echo."
                    : "Use the reference photo only for the character's appearance. Keep the same face and character appearance.";

                const synthesisPrompt = `You are a professional Prompt Engineer for Video Generative AI.
Translate the following specific scene from a script into a simple, high-performing generative prompt for Bytedance Seedance 2.0.

Scene Number: ${i + 1} of ${scenes.length}
Scene Dialogue: "${scene.dialogue}"
Scene Visuals: "${scene.visuals || ''}"
Business name: "${businessName}"
Product context: "${productInfo}"
User's brand style: "${brandGuidelines}"
Custom instructions: "${customInstructions || 'None'}"

CREATOR CHARACTER:
- Description: "${characterDescription}"
- Reference Video Available: ${isCharacterVideo ? 'Yes (Reference Video is provided)' : 'No (Reference Photo Image 1 is provided)'}

YOUR INSTRUCTIONS:
1. Generate a simple, natural, and direct generative video prompt. Do NOT use complex markdown headers, brackets, or structured blocks like "[Aesthetic]", "[Characters]", "[Environment]", "[Action Sequence]", etc. Keep the description highly concise and minimal, following the exact structure below.
2. You MUST output the final prompt structured into EXACTLY 5 distinct paragraphs separated by double newlines (\\n\\n), following this exact template format:

[Paragraph 1 - Character & Voice Reference]
${p1Instruction}

[Paragraph 2 - Reference Images Preference]
also use the reference images(if there are any) where ever suitable

[Paragraph 3 - Setting, Attire & Camera Rules]
keep the attire of the character and setting of the scene according to the video. keep the character shots closer to the camera.

[Paragraph 4 - Text Suppression Rule]
DO NOT ADD ANY TEXT, SUBTITLES, OR ON-SCREEN CAPTIONS IN THE GENERATED VIDEO. THE FRAME MUST BE COMPLETELY CLEAN OF ANY TEXT GRAPHICS.

[Paragraph 5 - Dialogue Block]
Dialogue:
"[Precise scene dialogue to be spoken]"

3. Do NOT include any code block formatting wrappers (like \`\`\` or \`\`\`text) or conversational text outside of the prompt content itself. Output only the prompt text.`;

                let finalPrompt = "";
                try {
                    console.log(`[Generate API] Generating prompt for scene ${i + 1} with primary model: gemini-3.5-flash`);
                    const { text } = await generateText({
                        model: google('gemini-3.5-flash'),
                        prompt: synthesisPrompt,
                    });
                    finalPrompt = text.trim();
                } catch (e: any) {
                    console.warn(`[Generate API] Primary prompt synthesis failed for scene ${i + 1}, trying gemini-3-flash-preview fallback:`, e.message);
                    try {
                        const { text } = await generateText({
                            model: google('gemini-3-flash-preview'),
                            prompt: synthesisPrompt,
                        });
                        finalPrompt = text.trim();
                    } catch (fallbackErr: any) {
                        console.error(`[Generate API] Fallback prompt synthesis also failed for scene ${i + 1}:`, fallbackErr);
                        // Fallback prompt using exact working 5-paragraph structure
                        finalPrompt = `${p1Instruction}

also use the reference images(if there are any) where ever suitable

keep the attire of the character and setting of the scene according to the video. keep the character shots closer to the camera.

DO NOT ADD ANY TEXT, SUBTITLES, OR ON-SCREEN CAPTIONS IN THE GENERATED VIDEO. THE FRAME MUST BE COMPLETELY CLEAN OF ANY TEXT GRAPHICS.

Dialogue:
"${scene.dialogue}"`;
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

        // 4. Create Placeholder Asset (Spinning Card) in Supabase
        const { data: newAsset, error: newAssetError } = await supabaseAdmin
            .from('assets')
            .insert({
                user_id: targetUserId,
                property_id: propertyId || null,
                type: 'video',
                status: 'Processing',
                url: 'https://designs.adrolls.in/processing', // Temporary URL
                caption: script.finalCaption || `${script.title}\n\n${script.dialogue}`
            })
            .select()
            .single();

        if (newAssetError || !newAsset) {
            console.error("Placeholder creation failed:", newAssetError);
            await refundLimit(targetUserId, 'ai_creatives');
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

        // 5. Launch Bytedance Seedance 2.0 Fast tasks in parallel
        const taskIds: string[] = [];
        const launchErrors: string[] = [];
        
        const launchPromises = prompts.map(async (promptText, index) => {
            const payload: any = {
                model: "bytedance/seedance-2-fast",
                callBackUrl: callbackUrl,
                input: {
                    prompt: promptText,
                    aspect_ratio: "9:16",
                    duration: 15,
                    generate_audio: true,
                    resolution: "480p",
                    nsfw_checker: true,
                    web_search: false
                }
            };
            
            if (combinedRefImages.length > 0) {
                payload.input.reference_image_urls = combinedRefImages.slice(0, 9);
            }
            
            // If character is a video, pass it via reference_video_urls (Seedance 2.0 spec)
            if (referenceVideoUrls.length > 0) {
                payload.input.reference_video_urls = referenceVideoUrls;
                console.log(`[Video Generate] Passing character video reference: ${referenceVideoUrls[0]}`);
            }

            // Pass the extracted reference audio URL. If extraction failed (e.g. on Vercel serverless), fall back to the reference video URL itself.
            const audioUrlToPass = referenceAudioUrl || (referenceVideoUrls.length > 0 ? referenceVideoUrls[0] : null);
            if (audioUrlToPass) {
                payload.input.reference_audio_urls = [audioUrlToPass];
                console.log(`[Video Generate] Passing character audio reference: ${audioUrlToPass}`);
            }
            
            console.log(`[Video Generate] Launching Kie task for Scene ${index + 1}...`);
            const { taskId, error: kieError } = await createKieTask(payload);
            if (kieError || !taskId) {
                launchErrors.push(kieError || `Scene ${index + 1} task failed to launch`);
            } else {
                taskIds[index] = taskId;
                console.log(`[Video Generate] Launched Kie task for Scene ${index + 1}: ${taskId}`);
            }
        });
        
        await Promise.all(launchPromises);
        
        if (launchErrors.length > 0 || taskIds.filter(Boolean).length !== prompts.length) {
            // Delete placeholder and refund credit if any task failed to start
            await supabaseAdmin.from('assets').delete().eq('id', newAsset.id);
            await refundLimit(targetUserId, 'ai_creatives');
            return NextResponse.json({ error: launchErrors.join(', ') || "Failed to start parallel video generations" }, { status: 500 });
        }

        // 6. Record state in video_tasks (parallel records sharing the same asset_id)
        const insertPromises = taskIds.map((taskId, index) => {
            return supabaseAdmin
                .from('video_tasks')
                .insert({
                    id: crypto.randomUUID(),
                    user_id: targetUserId,
                    property_id: propertyId || null,
                    asset_id: newAsset.id,
                    prompts: prompts, // Store the prompts array
                    current_index: index, // Scene index (0 for Scene 1, 1 for Scene 2)
                    last_task_id: taskId,
                    last_successful_task_id: avatarUrl, // Store avatarUrl here for retry consistency!
                    aspect_ratio: "9:16",
                    status: 'Processing',
                    final_caption: script.finalCaption || null
                });
        });
        
        const insertResults = await Promise.all(insertPromises);
        for (const res of insertResults) {
            if (res.error) {
                console.error("DB Error saving video task record:", res.error);
            }
        }

        return NextResponse.json({ 
            success: true, 
            assetId: newAsset.id,
            taskIds, 
            message: `${prompts.length}-clip parallel Seedance 2.0 Fast video generation started.` 
        });

    } catch (error: any) {
        console.error("Video Generate Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
