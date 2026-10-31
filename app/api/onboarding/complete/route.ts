import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { createKieImageTask, createKieTask } from '@/utils/external-apis';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { ensureJpegImage } from '@/utils/image-converter';
import { getReferenceTemplate, ALL_REFERENCE_TEMPLATES } from '@/utils/reference-templates-data';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_CHARACTER_URL = "https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/character-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780563818432-trimmed.mp4";
const DEFAULT_CHARACTER_AUDIO_URL = "https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/voice-sample-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780556476936.mp3";
const DEFAULT_CHARACTER_DESCRIPTION = "A young Indian female with straight shoulder-length black hair and a calm expression. She wears a striped button-down shirt and brown trousers, standing in a modern white interior with a feather-shaped wall light.";

export interface InputVideoConfig {
    id?: string;
    duration: number; // e.g. 15, 30, 45, 60
    customInstructions?: string;
}

export interface InputProjectConfig {
    id?: string;
    title: string;
    description: string;
    price?: string;
    imageUrl?: string;
    creativesCount?: number;
    videos?: InputVideoConfig[];
    customInstructions?: string;
}

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
            country,
            companyDescription, 
            logoUrl, 
            contactNumber,
            address,
            websiteUrl,
            whatsappNumber,
            productTitle, 
            productDescription, 
            productPrice, 
            productImageUrl,
            selectedTemplates,
            projects 
        } = body;

        // 1. Fetch current profile to check existing data
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, business_info, client_features, logo_url, contact_number, address, custom_domain, character_url, character_audio_url, character_description, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .eq('id', user.id)
            .single();

        const resolvedCompanyName = companyName || existingProfile?.business_name || 'My Business';
        const resolvedCompanyDesc = companyDescription || existingProfile?.business_info || '';
        const characterUrl = existingProfile?.character_url || DEFAULT_CHARACTER_URL;
        const characterAudioUrl = existingProfile?.character_audio_url || DEFAULT_CHARACTER_AUDIO_URL;
        const characterDescription = existingProfile?.character_description || DEFAULT_CHARACTER_DESCRIPTION;

        // 2. Update profiles table
        console.log("[Onboarding API] Updating profile details for user:", user.id);
        const profileUpdates: any = {
            business_name: resolvedCompanyName,
            business_info: resolvedCompanyDesc,
            logo_url: logoUrl || existingProfile?.logo_url || '',
            onboarding_completed: true,
            character_url: characterUrl,
            character_audio_url: characterAudioUrl,
            character_description: characterDescription
        };

        const existingFeatures = existingProfile?.client_features || {};
        profileUpdates.client_features = {
            ...existingFeatures,
            country: country || existingFeatures.country || 'India'
        };
        if (contactNumber) profileUpdates.contact_number = contactNumber;
        if (address) profileUpdates.address = address;
        if (whatsappNumber) profileUpdates.whatsapp_phone_number = whatsappNumber;
        if (Array.isArray(selectedTemplates) && selectedTemplates.length > 0) {
            profileUpdates.selected_templates = selectedTemplates;
        }
        if (websiteUrl && !existingProfile?.custom_domain) {
            profileUpdates.custom_domain = websiteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
        }

        if (body.paywallSkipped || body.skipPayment) {
            profileUpdates.client_features.paywall_skipped = true;
            if (!existingProfile?.subscription_status || existingProfile.subscription_status === '') {
                profileUpdates.subscription_status = 'free';
            }
        }

        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update(profileUpdates)
            .eq('id', user.id);

        if (profileError) {
            console.error("[Onboarding API] Profile update failed:", profileError);
            throw new Error(`Failed to update business profile: ${profileError.message}`);
        }

        // 3. Resolve projects list (support multi-project OR legacy single-product)
        let resolvedProjects: InputProjectConfig[] = [];
        if (Array.isArray(projects) && projects.length > 0) {
            resolvedProjects = projects.filter(p => p.title?.trim() && p.description?.trim());
        } else if (productTitle?.trim() && productDescription?.trim()) {
            resolvedProjects = [{
                title: productTitle.trim(),
                description: productDescription.trim(),
                price: productPrice || 'Contact for Price',
                imageUrl: productImageUrl || '',
                creativesCount: 3,
                videos: [{ duration: 15, customInstructions: '' }],
                customInstructions: ''
            }];
        }

        // If no projects provided (skipped product step)
        if (resolvedProjects.length === 0) {
            console.log("[Onboarding API] Product step skipped. Onboarding completed successfully.");
            return NextResponse.json({ 
                success: true, 
                message: 'Onboarding completed successfully without product generation.' 
            });
        }

        // 4. Auto-detect and persist industry
        console.log("[Onboarding API] Auto-detecting industry...");
        const detectedIndustry = await detectIndustry(resolvedCompanyName, resolvedCompanyDesc, '');
        await supabaseAdmin
            .from('profiles')
            .update({ industry: detectedIndustry })
            .eq('id', user.id);
        console.log(`[Onboarding API] Industry detected and saved: ${detectedIndustry}`);

        const visualProductionRules = buildImageSystemPrompt(detectedIndustry, false);

        // Calculate and enforce 5-minute (300s) maximum global video budget
        const MAX_GLOBAL_VIDEO_SECONDS = 300;
        let cumulativeVideoSeconds = 0;

        const host = request.headers.get('host') || 'localhost:3000';
        const isLocal = host.includes('localhost') || host.includes('local.nobogent.com') || host.includes('127.0.0.1');
        const baseUrl = isLocal ? 'http://127.0.0.1:3000' : `https://${host}`;

        const activeTemplates: string[] = (Array.isArray(selectedTemplates) && selectedTemplates.length > 0)
            ? selectedTemplates
            : ['pinterest_pin_0', 'pinterest_pin_1', 'pinterest_pin_2', 'pinterest_pin_3', 'pinterest_pin_4'];

        const generationSummary: Array<{ projectTitle: string; imageTasksQueued: number; videoTasksQueued: number }> = [];

        // 5. Process each project
        for (let pIdx = 0; pIdx < resolvedProjects.length; pIdx++) {
            const proj = resolvedProjects[pIdx];
            console.log(`[Onboarding API] Processing project ${pIdx + 1}/${resolvedProjects.length}: "${proj.title}"`);

            // Insert property into database
            const { data: property, error: propertyError } = await supabaseAdmin
                .from('properties')
                .insert({
                    user_id: user.id,
                    title: proj.title,
                    description: proj.description,
                    price: proj.price || 'Contact for Price',
                    image_url: proj.imageUrl || '',
                    images: proj.imageUrl ? [proj.imageUrl] : [],
                    address: address || 'Online',
                    property_type: 'Generic',
                    status: 'Active',
                    auto_generate: false
                })
                .select()
                .single();

            if (propertyError || !property) {
                console.error(`[Onboarding API] Property insertion failed for ${proj.title}:`, propertyError);
                continue;
            }

            const creativesToGenerate = Math.max(1, Math.min(10, proj.creativesCount || 3));
            let imageTasksCount = 0;
            let videoTasksCount = 0;

            // --- A. Generate Image Prompts & Submit Tasks ---
            console.log(`[Onboarding API] Generating ${creativesToGenerate} static creatives for "${proj.title}"...`);
            
            for (let cIdx = 0; cIdx < creativesToGenerate; cIdx++) {
                // Randomly select one template from the user's selected templates
                const randomTmplId = activeTemplates[Math.floor(Math.random() * activeTemplates.length)];
                const refTmpl = getReferenceTemplate(randomTmplId);
                const templateStyleName = refTmpl?.name || 'Modern Minimalist Luxury';
                const templateBadge = refTmpl?.badge || 'PREMIUM EXCLUSIVE';

                const promptSchema = z.object({
                    imagePrompt: z.string(),
                    adCaption: z.string()
                });

                const creativeGenPrompt = `You are a world-class Ad Creative Director.
Company: "${resolvedCompanyName}"
Project Title: "${proj.title}"
Project Description: "${proj.description}"
Price: "${proj.price || 'Contact for Price'}"
Industry: "${detectedIndustry}"
Visual Template Style to Emulate: "${templateStyleName}" (${templateBadge})
${proj.customInstructions ? `Custom Owner Instructions: "${proj.customInstructions}"` : ''}

### VISUAL PRODUCTION RULES:
${visualProductionRules}

Requirements:
- Static Meta Ad prompt optimized for 3:4 aspect ratio.
- Must look 100% authentic photograph, not plastic or artificial.
- Photorealistic humans matching context ethnicity.
- DO NOT draw text overlays or placeholder circles. Clean visual layout.
- Emulate the aesthetic tone of "${templateStyleName}".
- If custom instructions are provided, honor them explicitly.
`;

                try {
                    const { object } = await generateObject({
                        model: google('gemini-3.5-flash'),
                        schema: promptSchema,
                        prompt: creativeGenPrompt
                    });

                    const imageInputUrls: string[] = [];
                    if (proj.imageUrl) imageInputUrls.push(proj.imageUrl);
                    if (logoUrl) imageInputUrls.push(logoUrl);
                    if (refTmpl?.url) imageInputUrls.push(refTmpl.url);

                    const selectedImageModel = imageInputUrls.length > 0 ? "gpt-image-2-5-flare-image-to-image" : "gpt-image-2-5-flare-text-to-image";
                    const taskId = await createKieImageTask(object.imagePrompt, selectedImageModel, "3:4", imageInputUrls);

                    if (taskId) {
                        imageTasksCount++;
                        fetch(`${baseUrl}/api/background-worker`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userId: user.id,
                                propId: property.id,
                                propertyTitle: property.title,
                                existingTaskId: taskId,
                                existingCaption: `${object.adCaption}\n\nPrice: ${property.price}`
                            })
                        }).catch(err => console.error("[Onboarding API] Background worker call failed:", err));
                    }
                } catch (imgErr: any) {
                    console.error(`[Onboarding API] Failed to generate creative ${cIdx + 1} for ${property.title}:`, imgErr.message);
                }
            }

            // --- B. Generate Videos with Specified Durations (5-Min Total Budget) ---
            const projectVideos = Array.isArray(proj.videos) ? proj.videos : [{ duration: 15, customInstructions: '' }];
            
            for (let vIdx = 0; vIdx < projectVideos.length; vIdx++) {
                const vid = projectVideos[vIdx];
                const requestedDuration = Number(vid.duration) || 15;

                // Enforce global 5-minute pool
                if (cumulativeVideoSeconds + requestedDuration > MAX_GLOBAL_VIDEO_SECONDS) {
                    console.warn(`[Onboarding API] Video pool cap reached (300s). Skipping additional video.`);
                    break;
                }
                cumulativeVideoSeconds += requestedDuration;

                console.log(`[Onboarding API] Generating ${requestedDuration}s video for "${proj.title}"...`);

                const videoSchema = z.object({
                    videoPrompt: z.string(),
                    finalCaption: z.string()
                });

                const videoGenPrompt = `You are an elite video ad director creating a ${requestedDuration}-second 9:16 mobile commercial reel.
Company: "${resolvedCompanyName}"
Project Title: "${proj.title}"
Description: "${proj.description}"
Price: "${proj.price || 'Contact for Price'}"
Duration: ${requestedDuration} seconds.
${vid.customInstructions ? `Specific Video Instructions: "${vid.customInstructions}"` : ''}
${proj.customInstructions ? `General Project Instructions: "${proj.customInstructions}"` : ''}

Output a structured video prompt for Seedance mini video engine with exact uppercase headers:
LOCATION (IMPORTANT)
CHARACTER APPEARANCE
DIALOGUE (Spoken script fitting exactly ${requestedDuration} seconds: ~${Math.round(requestedDuration * 2.2)} words. If India context, write in natural conversational Hinglish with Hindi words in Devanagari script).
SPEECH STYLE
ACTION
B-ROLL
CAMERA
LIGHTING
STYLE
AVOID
`;

                try {
                    const { object: vidObj } = await generateObject({
                        model: google('gemini-3.5-flash'),
                        schema: videoSchema,
                        prompt: videoGenPrompt
                    });

                    const videoPayload: any = {
                        model: "bytedance/seedance-2-mini",
                        callBackUrl: `${baseUrl}/api/video/callback`,
                        input: {
                            prompt: vidObj.videoPrompt,
                            aspect_ratio: "9:16",
                            duration: requestedDuration <= 15 ? 15 : 30, // Seedance mini accepts 15 or 30
                            generate_audio: true,
                            resolution: "480p",
                            nsfw_checker: true,
                            web_search: false
                        }
                    };

                    if (property.image_url) {
                        const convertedImg = await ensureJpegImage(property.image_url, user.id);
                        videoPayload.input.reference_image_urls = [convertedImg];
                    }

                    const taskResult = await createKieTask(videoPayload);
                    if (taskResult.taskId) {
                        videoTasksCount++;
                        const { data: newAsset } = await supabaseAdmin
                            .from('assets')
                            .insert({
                                user_id: user.id,
                                property_id: property.id,
                                type: 'video',
                                status: 'Processing',
                                url: 'https://designs.adrolls.in/processing',
                                caption: vidObj.finalCaption,
                                metadata: { duration: requestedDuration, instructions: vid.customInstructions || proj.customInstructions }
                            })
                            .select()
                            .single();

                        if (newAsset) {
                            await supabaseAdmin
                                .from('video_tasks')
                                .insert([{
                                    user_id: user.id,
                                    property_id: property.id,
                                    asset_id: newAsset.id,
                                    prompts: [vidObj.videoPrompt],
                                    current_index: 0,
                                    last_task_id: taskResult.taskId,
                                    last_successful_task_id: "",
                                    aspect_ratio: "9:16",
                                    status: 'Processing',
                                    final_caption: vidObj.finalCaption
                                }]);
                        }
                    }
                } catch (vErr: any) {
                    console.error(`[Onboarding API] Video generation failed for ${property.title}:`, vErr.message);
                }
            }

            generationSummary.push({
                projectTitle: property.title,
                imageTasksQueued: imageTasksCount,
                videoTasksQueued: videoTasksCount
            });
        }

        // 6. Optional: Send WhatsApp notification to Admin if connected
        const targetWaPhone = whatsappNumber || existingProfile?.contact_number;
        const waPhoneId = existingProfile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
        const waToken = existingProfile?.whatsapp_access_token || existingProfile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

        if (targetWaPhone && waPhoneId && waToken) {
            try {
                const summaryText = generationSummary
                    .map(s => `• *${s.projectTitle}*: ${s.imageTasksQueued} Creatives + ${s.videoTasksQueued} Video(s)`)
                    .join('\n');

                const introMsg = `🚀 *Nobogent Studio Initialized!*

Welcome *${resolvedCompanyName}*! We have commenced generation across your projects:
${summaryText}

⏱️ *Total Video Duration Allocated*: ${cumulativeVideoSeconds}s / ${MAX_GLOBAL_VIDEO_SECONDS}s (5 Mins Free Budget)

📲 *How Approvals & Revisions Work*:
As each creative is synthesized, it will be delivered here with product copy in WhatsApp template format.
• Reply *'Approve'* to instantly schedule it to your socials at peak 7:30 PM.
• Reply with changes (e.g. _"Change price to ₹2.1 Cr"_ or _"Regenerate style"_) to trigger automatic revisions!`;

                fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: targetWaPhone.replace(/\D/g, ''),
                        type: 'text',
                        text: { body: introMsg }
                    })
                }).catch(err => console.error("[Onboarding API] WhatsApp alert error:", err));
            } catch {}
        }

        console.log("[Onboarding API] Multi-project onboarding completed successfully!");
        return NextResponse.json({ 
            success: true, 
            message: `Onboarding completed for ${resolvedProjects.length} project(s).`,
            totalVideoSecondsUsed: cumulativeVideoSeconds,
            remainingVideoSeconds: Math.max(0, MAX_GLOBAL_VIDEO_SECONDS - cumulativeVideoSeconds),
            summary: generationSummary 
        });

    } catch (error: any) {
        console.error("[Onboarding API] Fatal Error:", error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
