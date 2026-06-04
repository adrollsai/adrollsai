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
    
    const cacheKey = `generated/${userId}/trimmed_ref_${hash}.mp4`;
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
        const scaleFilter = "scale='trunc(min(iw\\,iw*sqrt(2000000/(iw*ih)))/2)*2':-2";
        const cmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -vf "${scaleFilter}" -c:v libx264 -c:a aac -preset superfast -movflags +faststart "${outputPath}"`;
        
        await new Promise<void>((resolve, reject) => {
            exec(cmd, (err) => {
                if (err) {
                    console.warn(`[Trim Video] Standard trim failed (likely due to corrupt audio stream). Retrying with silent video (-an)...`);
                    const silentCmd = `"${ffmpegBinary}" -y -i "${inputPath}" -t 14 -vf "${scaleFilter}" -c:v libx264 -an -preset superfast -movflags +faststart "${outputPath}"`;
                    exec(silentCmd, (silentErr) => {
                        if (silentErr) reject(silentErr);
                        else resolve();
                    });
                } else {
                    resolve();
                }
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

        // Always replace 'Mohali' (case-insensitive) with Hindi script 'मोहाली' in dialogues to prevent mispronunciation
        const replaceMohali = (text: string) => {
            if (!text) return text;
            return text.replace(/\bMohali\b/gi, 'मोहाली');
        };

        if (script.dialogue) {
            script.dialogue = replaceMohali(script.dialogue);
        }
        if (script.scenes && Array.isArray(script.scenes)) {
            script.scenes = script.scenes.map((scene: any) => {
                if (scene.dialogue) {
                    scene.dialogue = replaceMohali(scene.dialogue);
                }
                if (scene.visuals) {
                    scene.visuals = replaceMohali(scene.visuals);
                }
                return scene;
            });
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

        const { data: targetProfile } = await supabase
            .from('profiles')
            .select('business_name, mission_statement, custom_prompt, character_url, character_description, character_audio_url')
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
        let referenceAudioUrl = useCharacterVideo !== false ? (profile.character_audio_url || "") : "";
        
        if (avatarUrl) {
            console.log(`[Video Generate] Using custom uploaded character ${isCharacterVideo ? 'video' : 'photo'} from profile: ${avatarUrl}`);
            if (isCharacterVideo) {
                // Ensure they have uploaded a voice sample first
                if (!referenceAudioUrl) {
                    return NextResponse.json({ 
                        error: 'Please upload a voice sample (up to 15s MP3/WAV) in your Profile Settings to enable voice cloning for your video character.' 
                    }, { status: 400 });
                }

                try {
                    // Always use local Vercel trimming to guarantee scaling down to 1080p max width (Kie.ai limit)
                    avatarUrl = await getTrimmedReferenceVideo(avatarUrl, targetUserId);
                } catch (delegateErr: any) {
                    console.error("[Video Generate] Local video trimming failed:", delegateErr.message);
                }
                
                console.log(`[Video Generate] Using uploaded voice sample directly: ${referenceAudioUrl}`);
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

                const characterAppearanceText = isCharacterVideo
                    ? "Use reference video only for character appearance.\nUse reference audio only for voice characteristics."
                    : "Use reference photo only for character appearance.";

                const synthesisPrompt = `You are a professional Prompt Engineer for Video Generative AI.
Translate the following specific scene from a script into a simple, high-performing generative prompt for Bytedance/Kie.ai Seedance 2.0.

Scene Number: ${i + 1} of ${scenes.length}
Scene Dialogue: "${scene.dialogue}"
Scene Visuals: "${scene.visuals || ''}"
Business name: "${businessName}"
Product context: "${productInfo}"
User's brand style: "${brandGuidelines}"
Custom instructions: "${customInstructions || 'None'}"

CREATOR CHARACTER:
- Description: "${characterDescription}"
- Reference Video Available: ${isCharacterVideo ? 'Yes' : 'No'}

REFERENCE IMAGES & DETAILS (Vision-analyzed descriptions of the reference images provided in this ad creation task):
${descriptionsText}

YOUR INSTRUCTIONS:
1. Generate a structured generative video prompt. Do NOT use markdown headers (like #, ##) or code blocks or bracketed blocks like [Action]. Follow the exact structure shown below.
2. Analyze the reference images description provided. See where they fit well in the video (e.g., background elements, products held in hand, or visually matching scene/product details) and prompt them accordingly in the "Action" or "Style" section of the output prompt.
3. CONTEXT-AWARE ATTIRE & ENVIRONMENT: Determine a highly specific, stylish, and premium attire/outfit and environment/setting for the character based on the business name, product context, brand guidelines, and script context (e.g., a beige linen blazer over a white tee in a modern corporate office, a premium casual smart shirt in a cozy warm living room, elegant premium wear in a luxury apartment, etc.). Never output generic text or bracketed placeholders like '[describe attire]'. You MUST output a concrete, detailed description of the clothing and setting.
4. HIGH-ENERGY & NATURAL GESTURES: Command the presenter's speech style to keep the energy exceptionally high, warm, engaging, and professional. The vocal delivery must have excellent projection and a natural UGC flow. Command the presenter's actions to use dynamic, natural hand gestures and warm, welcoming facial expressions to make it feel like a premium high-end video.
5. STRICT IMAGE FIDELITY (NO OVER-EXTENSION): When referencing or using the provided property/product images in the video actions, ensure that the video DOES NOT over-extend or hallucinate contents beyond the visible boundaries of the original reference images. Instruct the AI model to strictly only depict the real elements and spatial layouts that are visible in the image, ensuring 100% accuracy and zero mis-representation of the physical space/product.
6. DYNAMIC MULTI-SHOT COMPOSITION: The character shot must NOT be a continuous single-take shot. Explicitly specify a dynamic multi-shot setup where the camera cuts between different angles (e.g., medium close-up, medium shot) and includes the character in different positions, scenes, or alongside/inside different reference images to keep the pacing visually spectacular.
7. DEVANAGARI HINDI PRONUNCIATION: If the word "Mohali" (or "mohali", "MOHALI") appears in the Dialogue text, ALWAYS write it in Hindi script as "मोहाली" in the "Dialogue:" block of the generated prompt. Never write it in English/Latin characters, as doing so leads to mispronunciation by the text-to-speech engine. Keep all other words in their original script/Hinglish representation.
8. Output the prompt following this EXACT format (ensure correct line breaks and labels):

${characterAppearanceText}

Character maintains eye contact with camera throughout. He/She is wearing [describe appropriate attire here, replacing this with concrete details] in [describe appropriate location/setting here, replacing this with concrete details].

Dialogue:
"[dialogue text to be spoken]"

Speech Style:
[Describe delivery with rich personality, high-energy UGC style, exceptionally warm and welcoming tone, professional presentation, natural gestures, and excellent projection.]

Action:
[Describe the precise actions the character is performing. Instruct them to keep energy high and gestures natural. Specify dynamic cuts between multiple shots/scenes and include the character in different positions, scenes, or alongside/inside different reference images. Command the model to strictly respect the visible boundaries of the reference images and never over-extend them.]

Camera:
[Describe the camera perspective, e.g., "Dynamic multi-shot setup, switching from a detailed close-up shot to a medium shot, keeping face centered."]

Style:
[Describe the visual aesthetics and premium production quality, e.g., "Premium UGC video advertisement, realistic motion, high-end professional presentation, warm inviting lighting."]

Avoid:
No overlay Text, No overlay captions

9. Do NOT wrap the prompt in backticks or markdown code blocks. Output the pure text prompt only.`;

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
                        // Fallback prompt using the new structured template
                        finalPrompt = `${characterAppearanceText}

Character maintains eye contact with camera throughout. The character is wearing an elegant cream blazer over a structured premium shirt in a luxurious modern high-end setting.

Dialogue:
"${scene.dialogue}"

Speech Style:
High-energy UGC style, exceptionally warm, confident, and highly reassuring tone. Speaks at a natural, professional pace, displaying natural expressions.

Action:
Speaking directly to the viewer with high energy and natural hand gestures. Dynamic multi-shot setup cutting between medium close-ups and medium shots, showing the character in different positions. The video strictly maintains fidelity to the reference images, only depicting the real parts visible in the original photos without over-extending them.

Camera:
Dynamic multi-shot setup, switching between a detailed close-up shot and a medium tracking shot, keeping face centered.

Style:
Premium UGC advertisement, realistic motion, high-end professional presentation, warm inviting lighting.

Avoid:
No overlay Text, No overlay captions`;
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

            // Pass the extracted reference audio URL.
            // DO NOT fall back to passing the .mp4 video URL as the audio URL, as this breaks voice cloning.
            if (isCharacterVideo) {
                if (!referenceAudioUrl) {
                    throw new Error("Reference audio extraction failed. Please ensure your Cloud Run service is deployed and running, and that your uploaded profile video has a valid, audible sound track.");
                }
                payload.input.reference_audio_urls = [referenceAudioUrl];
                console.log(`[Video Generate] Passing character audio reference: ${referenceAudioUrl}`);
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
            await refundLimit(targetUserId, 'videos');
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
