import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { createKieImageTask, createKieTask } from '@/utils/external-apis';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { ensureJpegImage } from '@/utils/image-converter';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_CHARACTER_URL = "https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/character-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780563818432-trimmed.mp4";
const DEFAULT_CHARACTER_AUDIO_URL = "https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/voice-sample-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780556476936.mp3";
const DEFAULT_CHARACTER_DESCRIPTION = "A young Indian female with straight shoulder-length black hair and a calm expression. She wears a striped button-down shirt and brown trousers, standing in a modern white interior with a feather-shaped wall light.";

export async function POST(request: Request) {
    try {
        console.log("[Onboarding API] Complete onboarding request received");
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { 
            companyName, 
            companyDescription, 
            logoUrl, 
            productTitle, 
            productDescription, 
            productPrice, 
            productImageUrl 
        } = body;

        if (!companyName || !companyDescription || !productTitle || !productDescription) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Fetch current profile to check if characters are already set
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('character_url, character_audio_url, character_description')
            .eq('id', user.id)
            .single();

        const characterUrl = existingProfile?.character_url || DEFAULT_CHARACTER_URL;
        const characterAudioUrl = existingProfile?.character_audio_url || DEFAULT_CHARACTER_AUDIO_URL;
        const characterDescription = existingProfile?.character_description || DEFAULT_CHARACTER_DESCRIPTION;

        // 2. Update profiles table
        console.log("[Onboarding API] Updating profile details for user:", user.id);
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({
                business_name: companyName,
                business_info: companyDescription,
                logo_url: logoUrl || '',
                onboarding_completed: true,
                character_url: characterUrl,
                character_audio_url: characterAudioUrl,
                character_description: characterDescription
            })
            .eq('id', user.id);

        if (profileError) {
            console.error("[Onboarding API] Profile update failed:", profileError);
            throw new Error(`Failed to update business profile: ${profileError.message}`);
        }

        // 3. Insert product into properties table
        console.log("[Onboarding API] Inserting product details into properties...");
        const { data: property, error: propertyError } = await supabaseAdmin
            .from('properties')
            .insert({
                user_id: user.id,
                title: productTitle,
                description: productDescription,
                price: productPrice || 'Contact for Price',
                image_url: productImageUrl || '',
                images: productImageUrl ? [productImageUrl] : [],
                address: 'Online',
                property_type: 'Generic',
                status: 'Active',
                auto_generate: false
            })
            .select()
            .single();

        if (propertyError || !property) {
            console.error("[Onboarding API] Product insertion failed:", propertyError);
            throw new Error(`Failed to add product: ${propertyError?.message || 'Unknown error'}`);
        }

        // 4. Auto-detect and persist industry
        console.log("[Onboarding API] Auto-detecting industry...");
        const detectedIndustry = await detectIndustry(companyName, companyDescription, '');
        await supabaseAdmin
            .from('profiles')
            .update({ industry: detectedIndustry })
            .eq('id', user.id);
        console.log(`[Onboarding API] Industry detected and saved: ${detectedIndustry}`);

        // Build master visual production rules for image prompts
        const visualProductionRules = buildImageSystemPrompt(detectedIndustry, false);

        // 5. Generate image prompts and video script using Gemini
        console.log("[Onboarding API] Generating prompts via Gemini...");
        
        let aiResult;
        const schema = z.object({
            imagePrompts: z.array(z.string()).length(3),
            videoPrompt: z.string(),
            finalCaption: z.string()
        });

        const masterPrompt = `You are a world-class Ad Creative Director.
Analyze the following company profile and product details:
Company Name: "${companyName}"
Company Description: "${companyDescription}"
Product Title: "${productTitle}"
Product Description: "${productDescription}"
Product Price: "${productPrice}"
Industry/Vertical: "${detectedIndustry}"

### SYSTEM-LEVEL VISUAL PRODUCTION RULES
When writing image prompts, you MUST follow and apply the Visual Production Rules below as your foundational visual grammar:

${visualProductionRules}

### CONTENT INTEGRITY (CRITICAL)
- ONLY use text, facts, prices, features, and claims that are EXPLICITLY provided in the product/business input above. Do NOT invent, fabricate, or assume ANY information.
- If a detail (price, discount, phone, website) is NOT provided, do NOT include it. Leave it out entirely.
- Keep the creative CLEAN and UNCLUTTERED — only the most essential info. Prefer visual storytelling over text-heavy layouts.
- The business logo MUST always be included in the creative (placed cleanly in a corner).
- Contact info MUST be included if provided (subtle bottom strip). Do NOT fabricate contact info if not provided.

Your task is to generate:
1. Three (3) highly converting, short image ad prompts. Each prompt MUST follow this exact, simple, short layout format (approx. 50-80 words):
   "Make a high converting static meta ad, make sure the result is super real looking, and include attractive looking humans in it (ethnicity should be according to where the business is from) that don't look ai like, they should look super real. Only include super essential info in the image text overlays so it is not cluttered with text too much. Do NOT include any information that is not explicitly provided below — no made-up prices, discounts, claims, or contact details.
   Product Info: ${productTitle}. Description: [Short sentence summarizing ONLY the essential product info that was provided].
   Business Name: ${companyName || 'N/A'}
   Business Logo: Include the business logo cleanly in a corner.
   Style: Render the image in a [Varying style, e.g., prompt 1 is 'Sunset Golden Hour', prompt 2 is 'Minimalist Clean Studio', prompt 3 is 'Warm Home Interior'] aesthetic."
   Optimized for a 4:5 aspect ratio.
2. One (1) structured video prompt for Bytedance Seedance 2.0 (aspect ratio 9:16, 15 seconds duration).
   - Character Ethnicity / Details: Determine the country/business context based on the inputs (e.g. if the currency is ₹, or the company name/description/price refers to India, Delhi, Mumbai, etc., it is India).
     - If the context is India, describe the presenter in the "CHARACTER APPEARANCE" section as: "a beautiful Indian female with fair complexion and sharp features".
     - Otherwise, describe the character ethnicity appropriate for the context (e.g., "a beautiful Caucasian female" or "a beautiful Hispanic female", always with sharp features and a warm, attractive appearance).
   - Video Style: TikTok/UGC-like, organic, dialogue delivery natural and expressive, with an attractive tone of voice.
   - Dialogue:
     - The dialogue MUST be in Hinglish: write Hindi words in native Devanagari script (e.g. 'अगर', 'सुकून', 'शानदार', 'घर') and English words in standard English letters. Keep dialogue under 45 words.
     - Address the target audience in the first line of the dialogue.
   - Prompt Structure to output:
     The prompt must follow this EXACT format (ensure correct double newlines and exact uppercase headers):

LOCATION (IMPORTANT)
[Write the location guidelines. Determine appropriate environment settings for the presenter. E.g. "The presenter must remain in a premium, warm office environment."]

CHARACTER APPEARANCE
[Describe the presenter: a beautiful female with fair complexion, sharp features, ethnicity chosen based on the business context, and professional stylish outfit suited for the business]

DIALOGUE
"[dialogue text to be spoken. Under 45 words.]"

SPEECH STYLE
[Describe vocal delivery with rich personality, natural, expressive UGC style, attractive voice tone, conversational delivery.]

ACTION
[Describe the presenter's actions: maintaining eye contact, smiling warmly, using natural hand gestures.]

B-ROLL
[Describe B-roll showing the product in hand or premium lifestyle showcase.]

CAMERA
1. Medium shot presenter speaking to camera
2. Close-up presenter shot
3. B-roll close-up matching product image
4. Presenter final medium close-up

LIGHTING
[Describe lighting, e.g., warm golden-hour / studio lighting, professional clean presentation.]

STYLE
[TikTok style UGC video advertisement, realistic movement, organic feel.]

AVOID
• No text overlays
• No captions
• No logos
• No watermarks
3. A highly converting ad caption in finalCaption (with emojis, CTA, but no bold markdown and no hashtags).
`;

        try {
            const res = await generateObject({
                model: google('gemini-3.5-flash'),
                schema,
                prompt: masterPrompt,
            });
            aiResult = res.object;
        } catch (err: any) {
            console.warn("[Onboarding API] Primary Gemini model failed. Trying fallback...", err.message);
            const res = await generateObject({
                model: google('gemini-3-flash-preview'),
                schema,
                prompt: masterPrompt,
            });
            aiResult = res.object;
        }

        const { imagePrompts, videoPrompt, finalCaption } = aiResult;
        console.log("[Onboarding API] Prompts generated successfully. Image Prompts:", imagePrompts);
        console.log("[Onboarding API] Generated Video Prompt:", videoPrompt);

        // 5. Submit 3 Image Tasks to Kie.ai (using 4:5 aspect ratio)
        console.log("[Onboarding API] Submitting 3 image tasks to Kie.ai...");
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${host}`;

        for (let i = 0; i < imagePrompts.length; i++) {
            const prompt = imagePrompts[i];
            try {
                const imageInputUrls = productImageUrl ? [productImageUrl] : [];
                const selectedImageModel = productImageUrl ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image";
                
                const taskId = await createKieImageTask(prompt, selectedImageModel, "4:5", imageInputUrls);
                if (taskId) {
                    // Fire background worker asynchronously (fire and forget)
                    fetch(`${baseUrl}/api/background-worker`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: user.id,
                            propId: property.id,
                            propertyTitle: property.title,
                            existingTaskId: taskId,
                            existingCaption: `Creative ${i + 1} for ${property.title}`
                        })
                    }).catch(err => console.error("[Onboarding API] Background worker call failed:", err));
                }
            } catch (imageErr: any) {
                console.error(`[Onboarding API] Failed to submit image task ${i + 1}:`, imageErr.message);
            }
        }

        // 6. Submit 1 Video Task to Kie.ai (duration 15s, aspect ratio 9:16)
        console.log("[Onboarding API] Submitting video task to Kie.ai...");
        const payload = {
            model: "bytedance/seedance-2-mini",
            callBackUrl: `${baseUrl}/api/video/callback`,
            input: {
                prompt: videoPrompt,
                aspect_ratio: "9:16",
                duration: 15,
                generate_audio: true,
                resolution: "480p",
                nsfw_checker: true,
                web_search: false
            }
        };

        if (property.image_url) {
            const convertedImg = await ensureJpegImage(property.image_url, user.id);
            // @ts-ignore
            payload.input.reference_image_urls = [convertedImg];
        }

        const taskIds: string[] = [];
        const taskResult = await createKieTask(payload);
        if (taskResult.error || !taskResult.taskId) {
            console.error("[Onboarding API] Onboarding video submission failed:", taskResult.error);
        } else {
            taskIds.push(taskResult.taskId);
        }

        if (taskIds.length > 0) {
            // Create Video Asset Placeholder
            console.log("[Onboarding API] Creating video asset placeholder...");
            const { data: newAsset, error: assetErr } = await supabaseAdmin
                .from('assets')
                .insert({
                    user_id: user.id,
                    property_id: property.id,
                    type: 'video',
                    status: 'Processing',
                    url: 'https://designs.adrolls.in/processing',
                    caption: finalCaption
                })
                .select()
                .single();

            if (assetErr || !newAsset) {
                console.error("[Onboarding API] Failed to create video asset placeholder:", assetErr);
            } else {
                // Insert tasks into video_tasks table
                console.log("[Onboarding API] Recording tasks in video_tasks...");
                const videoTasksToInsert = taskIds.map((taskId, i) => ({
                    user_id: user.id,
                    property_id: property.id,
                    asset_id: newAsset.id,
                    prompts: [videoPrompt],
                    current_index: i,
                    last_task_id: taskId,
                    last_successful_task_id: "",
                    aspect_ratio: "9:16",
                    status: 'Processing',
                    final_caption: finalCaption
                }));

                const { error: taskInsertErr } = await supabaseAdmin
                    .from('video_tasks')
                    .insert(videoTasksToInsert);

                if (taskInsertErr) {
                    console.error("[Onboarding API] Failed to save video_tasks rows:", taskInsertErr);
                }
            }
        }

        console.log("[Onboarding API] Onboarding complete flow triggered successfully!");
        return NextResponse.json({ success: true, message: 'Onboarding completed and production assets triggered.' });

    } catch (error: any) {
        console.error("[Onboarding API] Fatal Error:", error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
