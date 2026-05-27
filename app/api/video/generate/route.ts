import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createKieTask } from '@/utils/external-apis';
import { checkLimitAndIncrement, refundLimit } from '@/utils/subscription-server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import crypto from 'crypto';

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
            customInstructions 
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

        let profile = targetProfile;

        // Self-heal: If character_url is present but character_description is null, analyze it on-the-fly!
        if (profile?.character_url && !profile.character_description) {
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

        // Extract reference images (max 4)
        let refImages: string[] = [];
        if (images && Array.isArray(images) && images.length > 0) {
            refImages = images.slice(0, 4);
        } else if (script.refImages && Array.isArray(script.refImages) && script.refImages.length > 0) {
            refImages = script.refImages.slice(0, 4);
        } else if (property) {
            if (property.images && Array.isArray(property.images) && property.images.length > 0) {
                refImages = property.images.slice(0, 4);
            } else if (property.image_url) {
                refImages = [property.image_url];
            }
        }

        // Prepare physical image descriptions
        const descriptionsText = (imageDescriptions || script.imageDescriptions || [])
            .map((desc: string, i: number) => `- Reference Image ${i + 1} description: "${desc}"`)
            .join('\n') || 'No detailed image descriptions provided. Describe the images based on standard product expectations.';

        // 2. Generate Consistent Character Avatar Image or use uploaded profile avatar
        let avatarUrl = "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=640"; // Premium fallback URL
        if (profile?.character_url) {
            avatarUrl = profile.character_url;
            console.log(`[Video Generate] Using custom uploaded character avatar from profile: ${avatarUrl}`);
        } else {
            try {
                const basePrompt = profile?.character_description || "a highly attractive, charismatic, and gorgeous young Indian female UGC creator with a fair complexion, smiling warmly";
                const avatarPrompt = `Professional chest-up studio headshot of ${basePrompt}. Wearing elegant smart casual clothes, sleek hair, bright clean minimalist background, professional studio lighting, natural photorealistic texture, cinematic look.`;
                const imgPayload = {
                    model: "gpt-image-2-text-to-image",
                    input: {
                        prompt: avatarPrompt,
                        aspect_ratio: "1:1",
                        resolution: "1K",
                        output_format: "png"
                    }
                };
                
                console.log("[Video Generate] Initiating KIE avatar image generation...");
                const { taskId: imgTaskId, error: imgError } = await createKieTask(imgPayload);
                
                if (imgTaskId) {
                    console.log(`[Video Generate] Started character avatar generation task: ${imgTaskId}. Polling status synchronously...`);
                    // Poll up to 10 times, waiting 1.5 seconds each (15s total)
                    for (let attempt = 0; attempt < 10; attempt++) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        const checkRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${imgTaskId}`, {
                            method: 'GET',
                            headers: { 'Authorization': `Bearer ${process.env.KIE_API_KEY}` }
                        });
                        if (checkRes.ok) {
                            const checkData = await checkRes.json();
                            const status = checkData.status || checkData.data?.status || checkData.data?.state;
                            if (status === 'succeeded' || status === 'completed' || status === 'success') {
                                const result = checkData.result || checkData.data?.result || checkData.data;
                                const url = result?.image_url || result?.imageUrl || result?.url || result?.outputUrl || result?.output_url;
                                if (url && typeof url === 'string' && url.startsWith('http')) {
                                    avatarUrl = url;
                                    console.log(`[Video Generate] Avatar image generation succeeded: ${avatarUrl}`);
                                    break;
                                }
                            } else if (status === 'failed' || status === 'error') {
                                console.error(`[Video Generate] Avatar image generation failed: ${checkData.failMsg || checkData.msg}`);
                                break;
                            }
                        }
                    }
                } else {
                    console.error(`[Video Generate] Failed to start avatar image generation: ${imgError}`);
                }
            } catch (avatarErr) {
                console.error(`[Video Generate] Error during avatar image generation:`, avatarErr);
            }
        }

        // Prepend the generated avatar to the reference images
        const combinedRefImages = [avatarUrl, ...refImages];

        // 3. Synthesize structured prompts for each scene using Gemini
        const prompts: string[] = [];
        const scenes = script.scenes || [{ dialogue: script.dialogue, visuals: script.visuals }];
        
        // Mapped Gender Helpers based on analyzed character profile description
        const isMale = /male|man|boy|gentleman|he\b/i.test(profile?.character_description || "");
        const voiceGender = isMale ? "male" : "female";
        const subjectPronoun = isMale ? "he" : "she";
        const possessivePronoun = isMale ? "his" : "her";
        const characterNoun = isMale ? "man" : "woman";
        const characterAdjective = isMale ? "charismatic handsome" : "gorgeous beautiful";

        const creatorAvatarDescription = profile?.character_description 
            ? `Stunning close-up studio portrait of the custom character: ${profile.character_description}`
            : "Stunning close-up studio portrait of a supermodel-like Indian female UGC creator with a fair complexion, smiling warmly.";

        const characterConstraint = profile?.character_description
            ? `The video MUST feature the exact same custom character described in Reference Image 1: ${profile.character_description}. Face, gender, hair, and style must perfectly match Reference Image 1.`
            : "The video MUST feature the Indian female UGC creator shown in Reference Image 1. She must speak directly to the camera with highly warm, expressive, and friendly gestures. Her face, appearance, hair, and style must perfectly match Reference Image 1.";

        const promptCharacterLine = profile?.character_description
            ? `The exact same custom character (${profile.character_description}) from Reference Image 1 speaking directly to camera with a clear, natural, professional ${voiceGender} voice.`
            : "The exact same stunning Indian female UGC creator from Reference Image 1 speaking directly to camera with a clear, natural, professional female voice.";

        for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i];

            // Pre-process visuals to align perfectly with the target profile character's parsed gender.
            // This prevents Gemini from receiving contradictory gender cues from older default scripts!
            let visualText = scene.visuals || "";
            if (isMale) {
                visualText = visualText
                    .replace(/\bfemale\b/gi, 'male')
                    .replace(/\bwoman\b/gi, 'man')
                    .replace(/\bwomen\b/gi, 'men')
                    .replace(/\bgirl\b/gi, 'boy')
                    .replace(/\bgirls\b/gi, 'boys')
                    .replace(/\bshe\b/gi, 'he')
                    .replace(/\bher\b/gi, 'his')
                    .replace(/\bgorgeous\b/gi, 'handsome')
                    .replace(/\bbeautiful\b/gi, 'handsome');
            } else {
                visualText = visualText
                    .replace(/\bmale\b/gi, 'female')
                    .replace(/\bman\b/gi, 'woman')
                    .replace(/\bmen\b/gi, 'women')
                    .replace(/\bboy\b/gi, 'girl')
                    .replace(/\bboys\b/gi, 'girls')
                    .replace(/\bhe\b/gi, 'she')
                    .replace(/\bhim\b/gi, 'her')
                    .replace(/\bhis\b/gi, 'her')
                    .replace(/\bhandsome\b/gi, 'beautiful');
            }

            const synthesisPrompt = `You are a professional Prompt Engineer for Video Generative AI.
Translate the following specific scene from a script into a highly structured generative prompt for Bytedance Seedance 2.0.

Scene Number: ${i + 1} of ${scenes.length}
Scene Dialogue: "${scene.dialogue}"
Scene Visuals: "${visualText}"
Business name: "${businessName}"
Product context: "${productInfo}"
User's brand style: "${brandGuidelines}"
Custom instructions: "${customInstructions || 'None'}"

Reference Image Descriptions:
- Reference Image 1 (Creator Avatar): "${creatorAvatarDescription}"
${descriptionsText.replace(/Reference Image (\d+)/g, (m: string, n: string) => `Reference Image ${parseInt(n) + 1}`)}

YOUR INSTRUCTIONS:
1. Generate a single highly detailed video prompt following the structure of the provided example exactly.
2. The video MUST look super natural, organic, and have a UGC look (direct UGC look, shallow depth of field, handheld camera motion) by default.
3. ${characterConstraint}
   - CRITICAL PRONOUN AND GENDER RULE: The character is ${voiceGender}. In the generated video prompt under [Action Sequence], you MUST describe all visual movements and physical details of the character strictly matching this gender.
   - If male: describe the creator as "the handsome male creator", "he", "his", "him" throughout all SHOT descriptions. NEVER use words like "female", "woman", "she", or "her" anywhere in your output.
   - If female: describe the creator as "the beautiful female creator", "she", "her" throughout all SHOT descriptions. NEVER use words like "male", "man", "he", or "his" anywhere in your output.
    - In every SHOT where the creator is speaking, explicitly write that he/she is speaking with a clear, professional ${voiceGender} voice, audio-only speech with NO on-screen subtitles or captions overlay (e.g. "...speaking directly to camera with a clear, natural, professional ${voiceGender} voice, audio-only speech, absolutely no on-screen text or subtitles overlay...").
4. STRICT ENVIRONMENT CONSTRAINT (Prevents Hallucinations): Constrain all environment and visual action sequences strictly to the physical details actually visible in the reference images (Reference Image 2, 3, etc.). Do NOT invent, assume, or hallucinate rooms, structures, product features, or details that are not shown in the reference photos. For example, if the photos only show a bedroom, only show the bedroom; if the photos show a cosmetics bottle, only showcase that cosmetics bottle. This constraint is critical to prevent hallucinations across different business niches.
5. Make the scene highly dynamic: constantly moving, featuring dynamic shot changes, handheld camera motion, fluid panning, and different angles narrating dialogues along the way in a highly expressive way. Every shot must feature camera movement and expressive physical storytelling.
6. NO PHONE NUMBERS: Under no circumstances should the dialogue contain any digits or spoken phone numbers. Replace any phone numbers or digit blocks in the dialogue with the phrase "get in touch".
7. DO NOT use abstract image placeholders like "@Image 1", "@Image 2", "Image 1", or "Image 2" in the prompt. Instead, replace them by describing the actual visual content of the corresponding image description.
8. The video is a strict 15-second clip, so split the [Action Sequence] into SHOTs from 0:00 to 0:15 (e.g. SHOT 1 (0:00-0:03) ...).
9. The dialogue from the script MUST be mapped precisely to the dialogue in the SHOTs in the [Action Sequence] as spoken words by the creator.
10. CRITICAL: Keep the frame completely 100% clean of all visual text, subtitles, captions, watermarks, lower thirds, or logos on screen. The creator is speaking, but do NOT overlay any text of what is said on the video. The generated video must be audio-only speech. Ensure the negative prompt lists negative text descriptors.
11. The [Negative Prompt] section MUST explicitly list negative text descriptors: "text, logo, watermark, subtitles, captions, words, signature, letters, overlay, on-screen text, burned-in subtitles, gibberish text, lower-third titles".

OUTPUT FORMAT:
Provide the prompt output in the exact format shown below, starting with "[Aesthetic]" and concluding with the "[Negative Prompt]" section. Do not add any conversational text or formatting wrappers like markdown code blocks.

Example structure:
[Aesthetic] UGC style. Naturalistic warm lighting, handheld camera movement.
[Storyline] Part of an ad for ${businessName} demonstrating the product benefits.
[Characters] ${promptCharacterLine}
[Environment] Modern clean setting showing [insert relevant image description here].
[Action Sequence]
SHOT 1 (0:00-0:03) The charismatic ${characterAdjective} ${characterNoun} creator holding the product, pointing at the [insert image description here], speaking directly to camera in a clear professional ${voiceGender} voice, audio-only speech, absolutely no on-screen text or subtitles overlay. DIALOGUE: "..."
SHOT 2 (0:03-0:07) Close up on ${subjectPronoun} demonstrating the product [insert image description here], handheld camera tilting, ${subjectPronoun} speaking in a clear professional ${voiceGender} voice, audio-only speech with no text overlay. DIALOGUE: "..."
SHOT 3 (0:07-0:11) The creator showcasing the [insert image description here] with enthusiastic hand gestures, dynamic track left movement, speaking in a clear professional ${voiceGender} voice, audio-only speech, no burned-in text. DIALOGUE: "..."
SHOT 4 (0:11-0:15) The ${characterNoun} creator smiling warmly, waving, camera panning back out, speaking in a clear professional ${voiceGender} voice, audio-only speech, pristine screen. DIALOGUE: "..."
[Production Brief] Shallow depth of field, subject sharp, UGC handheld shake, 4k, realistic texture.
[Negative Prompt] text, logo, watermark, subtitles, captions, words, signature, letters, overlay, on-screen text, burned-in subtitles, gibberish text, lower-third titles, low quality.`;

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
                finalPrompt = `[Aesthetic] UGC style.
[Storyline] Product ad for ${businessName}.
[Characters] ${promptCharacterLine}
[Environment] Modern clean setting showing ${firstImageDesc}.
[Action Sequence]
SHOT 1 (0:00-0:15) Charismatic ${characterNoun} creator matching Reference Image 1 holding the product and talking directly to camera, speaking in a clear professional ${voiceGender} voice, handheld moving shots. DIALOGUE: "${scene.dialogue}"
[Production Brief] Shallow depth of field, subject sharp, UGC handheld shake.
[Negative Prompt] text, logo, watermark, subtitles, captions, words, signature, letters, overlay.`;
            }
            prompts.push(finalPrompt);
        }

        // 4. Create Placeholder Asset (Spinning Card) in Supabase
        const { data: newAsset, error: newAssetError } = await supabase
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
            const payload = {
                model: "bytedance/seedance-2-fast",
                callBackUrl: callbackUrl,
                input: {
                    prompt: promptText,
                    reference_image_urls: combinedRefImages.slice(0, 4), // Send the avatar + property photos (up to 4)
                    aspect_ratio: "9:16",
                    duration: 15,
                    generate_audio: true,
                    resolution: "480p"
                }
            };
            
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
            await supabase.from('assets').delete().eq('id', newAsset.id);
            await refundLimit(targetUserId, 'ai_creatives');
            return NextResponse.json({ error: launchErrors.join(', ') || "Failed to start parallel video generations" }, { status: 500 });
        }

        // 6. Record state in video_tasks (parallel records sharing the same asset_id)
        const insertPromises = taskIds.map((taskId, index) => {
            return supabase
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
