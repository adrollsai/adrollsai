import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask } from '@/utils/external-apis';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import crypto from 'crypto';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
            customInstructions,
            useCharacterVideo = true
        } = body;

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
        const avatarUrl = useCharacterVideo !== false ? profile.character_url : null;
        const isCharacterVideo = avatarUrl && (/\.(mp4|webm)/i.test(avatarUrl) || avatarUrl.includes('video'));
        
        if (avatarUrl) {
            console.log(`[Video Generate] Using custom uploaded character ${isCharacterVideo ? 'video' : 'photo'} from profile: ${avatarUrl}`);
        } else {
            console.log(`[Video Generate] Speaker reference is disabled (useCharacterVideo=false). Using generic presenter.`);
        }

        // Prepend the custom character avatar to the reference images (only if it's a photo, not a video)
        const combinedRefImages = (avatarUrl && !isCharacterVideo) ? [avatarUrl, ...refImages] : [...refImages];
        
        // If the character is a video, build the reference_video_urls array for Kie.ai Seedance 2.0
        const referenceVideoUrls = (avatarUrl && isCharacterVideo) ? [avatarUrl] : [];

        // 3. Synthesize structured prompts for each scene using Gemini
        const prompts: string[] = [];
        const scenes = script.scenes || [{ dialogue: script.dialogue, visuals: script.visuals }];
        
        // Character description — fed directly to Gemini, no regex gender detection needed
        const characterDescription = useCharacterVideo !== false
            ? (profile?.character_description || "a stunningly beautiful, highly attractive, charismatic Indian female UGC content creator with a fair complexion, smiling warmly")
            : "a highly professional, friendly, and charismatic UGC presenter speaking clearly and warmly to the camera";

        // Strict character video preservation instructions (only when using a video reference)
        const characterVideoConstraint = isCharacterVideo
            ? `\n\nCRITICAL CHARACTER VIDEO REFERENCE CONSTRAINT: A reference video of the creator character has been provided. This video serves TWO critical purposes:\n1. VOICE CLONING: You MUST clone and replicate the EXACT voice from the reference video — the same tone, pitch, accent, pace, cadence, emotional warmth, and natural delivery style. The generated video's spoken voice must sound IDENTICAL to the person speaking in the reference video. Do NOT use a generic or different voice — match it precisely.\n2. APPEARANCE PRESERVATION: Extract and preserve the character's exact physical looks (facial features, bodily build, skin tone, hair) from the reference video. The character must appear IDENTICAL in the generated video.\n\nDO NOT reuse, paste, or replay the reference video's actual frames, movements, actions, or background in the generated video. Only clone the voice and appearance. You SHOULD adjust their clothing/attire to look highly professional, presentable, and well-dressed for the specific ad scene context and product being advertised.`
            : '';

        for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i];

            const synthesisPrompt = `You are a professional Prompt Engineer for Video Generative AI.
Translate the following specific scene from a script into a highly structured generative prompt for Bytedance Seedance 2.0.

Scene Number: ${i + 1} of ${scenes.length}
Scene Dialogue: "${scene.dialogue}"
Scene Visuals: "${scene.visuals || ''}"
Business name: "${businessName}"
Product context: "${productInfo}"
User's brand style: "${brandGuidelines}"
Custom instructions: "${customInstructions || 'None'}"${characterVideoConstraint}

CREATOR CHARACTER (${isCharacterVideo ? 'Reference Video' : 'Reference Image 1'}):
"${characterDescription}"
This is the exact person who must appear in the video. Study this description carefully — their gender, appearance, ethnicity, hair, clothing, and style must be matched EXACTLY in every shot. Use the correct pronouns and gendered language that match this character naturally.

Reference Image Descriptions:
- Reference Image 1 (Creator Avatar): "${characterDescription}"
${descriptionsText.replace(/Reference Image (\d+)/g, (m: string, n: string) => `Reference Image ${parseInt(n) + 1}`)}

YOUR INSTRUCTIONS:
0. CRITICAL CUSTOM INSTRUCTIONS PRIORITIZATION RULE: You MUST strictly prioritize and adhere to the user's Custom Instructions: "${customInstructions || 'None'}". The generated prompt's action sequences, character visual presentation, expressions, and overall scene context must align perfectly with and follow these custom instructions first and foremost. Do not ignore them or generate default actions that do not reflect what the user has requested.
1. Generate a single highly detailed video prompt following the structure of the provided example exactly.
2. The video MUST look super natural, organic, and have a raw UGC look (direct UGC look, shallow depth of field, handheld camera motion, like a real person filmed it on their phone) by default.
3. CHARACTER IDENTITY RULE: The video MUST feature the exact same person described in the CREATOR CHARACTER section above (Reference Image 1). Their face, gender, build, hair, clothing, and overall appearance must perfectly match Reference Image 1. Use the correct pronouns (he/him/his or she/her) that match this character's gender naturally based on the description. Do NOT mismatch the gender — if the character is described as female, use she/her; if male, use he/him.
4. VOICE CLONING & QUALITY RULE: ${isCharacterVideo ? 'A reference video has been provided. You MUST clone the EXACT voice from the reference video — replicate the identical tone, pitch, accent, pace, cadence, emotional delivery, and speaking style. The generated voice must be indistinguishable from the voice in the reference video. Do NOT use a different or generic AI voice.' : 'The character\'s spoken voice must sound warm, natural, smooth, pleasing to listen to, and emotionally engaging.'} The voice must sound like a real UGC influencer or content creator having a genuine, casual conversation with their audience — warm, friendly, confident, with natural cadence and subtle emotional inflections. It should NOT sound robotic, monotone, synthetic, or overly polished. Think of a real person filming a casual Instagram Reel or TikTok in their room, talking naturally and passionately about something they love. The voice must match the character's gender perfectly.
5. NATURAL BODY LANGUAGE & GESTURES: The character must have highly natural, dynamic, and expressive body language throughout the video — real hand gestures while talking, subtle head tilts, natural eye contact shifts, relaxed posture changes, genuine smiling, leaning in/out, touching/pointing at products naturally. Their movements should feel organic and alive like a real person, NOT stiff, static, or robotic. Every shot must show the character actively moving and gesturing naturally.
5.1. CLOSE-UP CHARACTER SHOT CONSTRAINT (Prevents Face Mutation): Wherever the creator character is visible in a shot, you MUST strictly specify a close-up shot (e.g. "detailed close-up of the character's face", "close-up of the speaker"). Avoid medium, long, or wide shots of the character, as wider camera distances mutate or distort character features in AI video generation. Keep the focus close-up on the character's upper torso and face to ensure consistent, premium character features.
6. STRICT ENVIRONMENT CONSTRAINT (Prevents Hallucinations): Constrain all environment and visual action sequences strictly to the physical details actually visible in the reference images (Reference Image 2, 3, etc.). Do NOT invent, assume, or hallucinate rooms, structures, product features, or details that are not shown in the reference photos.
7. Make the scene highly dynamic: constantly moving, featuring dynamic shot changes, handheld camera motion, fluid panning, and different angles narrating dialogues along the way in a highly expressive way. Every shot must feature camera movement and expressive physical storytelling.
8. NO PHONE NUMBERS: Under no circumstances should the dialogue contain any digits or spoken phone numbers. Replace any phone numbers or digit blocks in the dialogue with the phrase "get in touch".
9. DO NOT use abstract image placeholders like "@Image 1", "@Image 2", "Image 1", or "Image 2" in the prompt. Instead, replace them by describing the actual visual content of the corresponding image description.
10. The video is a strict 15-second clip, so split the [Action Sequence] into SHOTs from 0:00 to 0:15 (e.g. SHOT 1 (0:00-0:03) ...).
11. The dialogue from the script MUST be mapped precisely to the dialogue in the SHOTs in the [Action Sequence] as spoken words by the creator.
12. CRITICAL ZERO TEXT ON SCREEN RULE: The generated video frame must contain ABSOLUTELY ZERO visual text of any kind — no subtitles, no captions, no watermarks, no logos, no lower thirds, no title cards, no on-screen words, no burned-in text, no floating text overlays, no speech-to-text transcription overlays, NOTHING. The screen must be 100% pristine and clean with only the visual scene and character visible. The creator speaks with audio-only — their dialogue is heard but NEVER displayed as text on screen. This is the single most important visual constraint.
13. The [Negative Prompt] section MUST explicitly list ALL of these negative text descriptors without exception: "text, logo, watermark, subtitles, captions, words, signature, letters, overlay, on-screen text, burned-in subtitles, gibberish text, lower-third titles, title card, speech-to-text, transcription, floating text, text overlay, any form of written words on screen".

OUTPUT FORMAT:
Provide the prompt output in the exact format shown below, starting with "[Aesthetic]" and concluding with the "[Negative Prompt]" section. Do not add any conversational text or formatting wrappers like markdown code blocks.

Example structure:
[Aesthetic] UGC style. Naturalistic warm lighting, handheld camera movement.
[Storyline] Part of an ad for ${businessName} demonstrating the product benefits.
[Characters] The exact same creator from ${isCharacterVideo ? 'the Reference Video' : 'Reference Image 1'} (${characterDescription}), speaking directly to camera. ${isCharacterVideo ? 'Voice MUST be cloned exactly from the reference video — same tone, pitch, accent, pace, and natural delivery. ' : ''}Warm, natural, smooth, pleasing UGC creator voice. The character speaks like a real person filming a casual Instagram Reel — genuine, passionate, conversational. Voice must match their gender perfectly. ABSOLUTELY NO text, subtitles, captions, or any written words visible anywhere on screen at any point.
[Environment] Modern clean setting showing [insert relevant image description here].
[Action Sequence]
SHOT 1 (0:00-0:03) The creator from Reference Image 1 holding the product, pointing naturally with relaxed hand gestures at the [insert image description here], speaking directly to camera with a warm, smooth, pleasing voice, audio-only speech, absolutely no on-screen text or subtitles overlay. DIALOGUE: "..."
SHOT 2 (0:03-0:07) Close up of the creator demonstrating the product [insert image description here], natural head tilts and expressive hand movements, handheld camera tilting, speaking with a warm, engaging voice, audio-only speech with no text overlay. DIALOGUE: "..."
SHOT 3 (0:07-0:11) The creator showcasing the [insert image description here] with enthusiastic natural hand gestures, leaning in with genuine excitement, dynamic track left movement, speaking with a warm, pleasing voice, audio-only speech, no burned-in text. DIALOGUE: "..."
SHOT 4 (0:11-0:15) The creator smiling warmly and naturally, waving, relaxed posture, camera panning back out, speaking with a warm, smooth voice, audio-only speech, pristine screen. DIALOGUE: "..."
[Production Brief] Shallow depth of field, subject sharp, UGC handheld shake, 4k, realistic texture. Absolutely zero text, subtitles, captions, or any form of written words on screen.
[Negative Prompt] text, logo, watermark, subtitles, captions, words, signature, letters, overlay, on-screen text, burned-in subtitles, gibberish text, lower-third titles, title card, speech-to-text, transcription, floating text, text overlay, any form of written words on screen, low quality, robotic motion, stiff posture.`;

            let finalPrompt = "";
            try {
                const { text } = await generateText({
                    model: google('gemini-3-flash-preview'),
                    prompt: synthesisPrompt,
                });
                finalPrompt = text.trim();
            } catch (e: any) {
                console.error(`Gemini prompt synthesis failed for scene ${i + 1}:`, e);
                // Fallback prompt
                const firstImageDesc = (imageDescriptions || script.imageDescriptions || [])[0] || 'the product';
                finalPrompt = `[Aesthetic] UGC style. Naturalistic warm lighting, handheld camera movement.
[Storyline] Product ad for ${businessName}.
[Characters] The exact same creator from ${isCharacterVideo ? 'the Reference Video' : 'Reference Image 1'} (${characterDescription}), speaking directly to camera. ${isCharacterVideo ? 'Voice MUST be cloned exactly from the reference video — same tone, pitch, accent, pace, and natural delivery. ' : ''}Warm, natural, smooth, pleasing UGC creator voice like a real person filming a casual Instagram Reel. ABSOLUTELY NO text, subtitles, or captions on screen.
[Environment] Modern clean setting showing ${firstImageDesc}.
[Action Sequence]
SHOT 1 (0:00-0:15) The creator holding the product and talking directly to camera with warm natural gestures, speaking with a smooth pleasing voice${isCharacterVideo ? ' cloned from reference video' : ''}, handheld moving shots, audio-only speech, absolutely zero text on screen. DIALOGUE: \"${scene.dialogue}\"
[Production Brief] Shallow depth of field, subject sharp, UGC handheld shake. Absolutely zero text on screen.
[Negative Prompt] text, logo, watermark, subtitles, captions, words, signature, letters, overlay, on-screen text, burned-in subtitles, gibberish text, lower-third titles, title card, speech-to-text, transcription, floating text, text overlay, any form of written words on screen, robotic motion, stiff posture.`;
            }
            prompts.push(finalPrompt);
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
                    reference_image_urls: combinedRefImages.slice(0, 9), // Send the avatar (if photo) + product/uploaded reference photos (up to 9 total)
                    aspect_ratio: "9:16",
                    duration: 15,
                    generate_audio: true,
                    resolution: "480p"
                }
            };
            
            // If character is a video, pass it via reference_video_urls (Seedance 2.0 spec)
            if (referenceVideoUrls.length > 0) {
                payload.input.reference_video_urls = referenceVideoUrls;
                payload.input['reference_video_urls '] = referenceVideoUrls; // Trailing-space variant for Kie.ai compat
                console.log(`[Video Generate] Passing character video reference: ${referenceVideoUrls[0]}`);
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
