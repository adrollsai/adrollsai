import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { createKieImageTask, createKieTask } from '@/utils/external-apis';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { ensureJpegImage } from '@/utils/image-converter';
import { getReferenceTemplate } from '@/utils/reference-templates-data';

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
        const { projects, selectedTemplates } = body;

        if (!Array.isArray(projects) || projects.length === 0) {
            return NextResponse.json({ error: 'Please configure at least one project.' }, { status: 400 });
        }

        // 1. Fetch user profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, business_info, logo_url, contact_number, whatsapp_phone_number, whatsapp_phone_number_id, whatsapp_access_token, facebook_token, industry, selected_templates')
            .eq('id', user.id)
            .single();

        const businessName = profile?.business_name || 'My Business';
        const businessInfo = profile?.business_info || '';
        const detectedIndustry = profile?.industry || await detectIndustry(businessName, businessInfo, '');
        const visualProductionRules = buildImageSystemPrompt(detectedIndustry, false);

        if (Array.isArray(selectedTemplates) && selectedTemplates.length > 0) {
            await supabaseAdmin.from('profiles').update({ selected_templates: selectedTemplates }).eq('id', user.id);
        }

        const activeTemplates: string[] = (Array.isArray(selectedTemplates) && selectedTemplates.length > 0)
            ? selectedTemplates
            : (profile?.selected_templates || ['pinterest_pin_0', 'pinterest_pin_1', 'pinterest_pin_2', 'pinterest_pin_3', 'pinterest_pin_4']);

        const MAX_GLOBAL_VIDEO_SECONDS = 300;
        let cumulativeVideoSeconds = 0;

        const host = request.headers.get('host') || 'localhost:3000';
        const isLocal = host.includes('localhost') || host.includes('local.nobogent.com') || host.includes('127.0.0.1');
        const baseUrl = isLocal ? 'http://127.0.0.1:3000' : `https://${host}`;

        const summary: Array<{ projectTitle: string; imageTasksQueued: number; videoTasksQueued: number }> = [];

        for (const proj of projects) {
            if (!proj.title?.trim() || !proj.description?.trim()) continue;

            let propertyId = proj.id;
            let property: any = null;

            // Check if existing property or create new
            if (propertyId && /^[0-9a-f-]{36}$/i.test(propertyId)) {
                const { data: existingProp } = await supabaseAdmin
                    .from('properties')
                    .select('*')
                    .eq('id', propertyId)
                    .eq('user_id', user.id)
                    .single();
                if (existingProp) {
                    property = existingProp;
                    await supabaseAdmin.from('properties').update({
                        title: proj.title,
                        description: proj.description,
                        price: proj.price || existingProp.price,
                        image_url: proj.imageUrl || existingProp.image_url
                    }).eq('id', property.id);
                }
            }

            if (!property) {
                const { data: newProp } = await supabaseAdmin
                    .from('properties')
                    .insert({
                        user_id: user.id,
                        title: proj.title,
                        description: proj.description,
                        price: proj.price || 'Contact for Price',
                        image_url: proj.imageUrl || '',
                        images: proj.imageUrl ? [proj.imageUrl] : [],
                        address: 'Online',
                        property_type: 'Generic',
                        status: 'Active'
                    })
                    .select()
                    .single();
                property = newProp;
            }

            if (!property) continue;

            const creativesToGenerate = Math.max(1, Math.min(10, proj.creativesCount || 3));
            let imgCount = 0;
            let vidCount = 0;

            // Generate image creatives
            for (let i = 0; i < creativesToGenerate; i++) {
                const randomTmplId = activeTemplates[Math.floor(Math.random() * activeTemplates.length)];
                const refTmpl = getReferenceTemplate(randomTmplId);
                const templateStyleName = refTmpl?.name || 'Modern Luxury';
                const templateBadge = refTmpl?.badge || 'PREMIUM EXCLUSIVE';

                const promptSchema = z.object({
                    imagePrompt: z.string(),
                    adCaption: z.string()
                });

                const creativePrompt = `You are a world-class Ad Creative Director.
Company: "${businessName}"
Project Title: "${property.title}"
Description: "${property.description}"
Price: "${property.price || 'Contact for Price'}"
Industry: "${detectedIndustry}"
Visual Template Style to Emulate: "${templateStyleName}" (${templateBadge})
${proj.customInstructions ? `Custom Owner Instructions: "${proj.customInstructions}"` : ''}

### VISUAL PRODUCTION RULES:
${visualProductionRules}

Requirements:
- Static Meta Ad prompt optimized for 3:4 aspect ratio.
- High quality photography, authentic lighting, no text overlays or awkward placeholder graphics.
- Clean presentation highlighting the product/property strengths.
`;

                try {
                    const { object } = await generateObject({
                        model: google('gemini-3.5-flash'),
                        schema: promptSchema,
                        prompt: creativePrompt
                    });

                    const inputUrls: string[] = [];
                    if (property.image_url) inputUrls.push(property.image_url);
                    if (profile?.logo_url) inputUrls.push(profile.logo_url);
                    if (refTmpl?.url) inputUrls.push(refTmpl.url);

                    const selectedImageModel = inputUrls.length > 0 ? "gpt-image-2-5-flare-image-to-image" : "gpt-image-2-5-flare-text-to-image";
                    const taskId = await createKieImageTask(object.imagePrompt, selectedImageModel, "3:4", inputUrls);

                    if (taskId) {
                        imgCount++;
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
                        }).catch(e => console.error("Worker error:", e));
                    }
                } catch (e: any) {
                    console.error("Creative generation error:", e.message);
                }
            }

            // Generate videos
            const videosList = Array.isArray(proj.videos) ? proj.videos : [{ duration: 15, customInstructions: '' }];
            for (const vid of videosList) {
                const duration = Number(vid.duration) || 15;
                if (cumulativeVideoSeconds + duration > MAX_GLOBAL_VIDEO_SECONDS) break;
                cumulativeVideoSeconds += duration;

                const videoSchema = z.object({
                    videoPrompt: z.string(),
                    finalCaption: z.string()
                });

                const videoGenPrompt = `You are an elite video ad director creating a ${duration}-second 9:16 commercial reel.
Company: "${businessName}"
Project Title: "${property.title}"
Description: "${property.description}"
Price: "${property.price || 'Contact for Price'}"
Duration: ${duration} seconds.
${vid.customInstructions ? `Specific Video Instructions: "${vid.customInstructions}"` : ''}
${proj.customInstructions ? `General Project Instructions: "${proj.customInstructions}"` : ''}

Output a structured video prompt for Seedance mini video engine with exact uppercase headers:
LOCATION (IMPORTANT)
CHARACTER APPEARANCE
DIALOGUE (Spoken script fitting exactly ${duration} seconds: ~${Math.round(duration * 2.2)} words. Natural conversational Hinglish with Hindi in Devanagari script).
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
                            duration: duration <= 15 ? 15 : 30,
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
                        vidCount++;
                        const { data: newAsset } = await supabaseAdmin.from('assets').insert({
                            user_id: user.id,
                            property_id: property.id,
                            type: 'video',
                            status: 'Processing',
                            url: 'https://designs.adrolls.in/processing',
                            caption: vidObj.finalCaption,
                            metadata: { duration: duration, instructions: vid.customInstructions || proj.customInstructions }
                        }).select().single();

                        if (newAsset) {
                            await supabaseAdmin.from('video_tasks').insert([{
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
                } catch (e: any) {
                    console.error("Video task error:", e.message);
                }
            }

            summary.push({
                projectTitle: property.title,
                imageTasksQueued: imgCount,
                videoTasksQueued: vidCount
            });
        }

        // WhatsApp admin ping
        const adminPhone = profile?.whatsapp_phone_number || profile?.contact_number;
        const waPhoneId = profile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
        const waToken = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

        if (adminPhone && waPhoneId && waToken) {
            try {
                const summaryLines = summary.map(s => `• *${s.projectTitle}*: ${s.imageTasksQueued} Creatives, ${s.videoTasksQueued} Video(s)`).join('\n');
                const text = `🎨 *Delivery Batch Dispatched!*

We are cooking your requested creatives across your projects:
${summaryLines}

⏱️ *Total Video Duration*: ${cumulativeVideoSeconds}s / ${MAX_GLOBAL_VIDEO_SECONDS}s allocated.

💡 *WhatsApp Approvals & Edits*:
You will receive each finished creative here. Reply *'Approve'* to post to your socials, or reply with changes (e.g. _"Change price to ₹2.1 Cr"_ or _"Regenerate style"_) to get auto-revisions!`;

                fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: adminPhone.replace(/\D/g, ''),
                        type: 'text',
                        text: { body: text }
                    })
                }).catch(() => {});
            } catch {}
        }

        return NextResponse.json({
            success: true,
            summary,
            totalVideoSecondsUsed: cumulativeVideoSeconds,
            remainingVideoSeconds: Math.max(0, MAX_GLOBAL_VIDEO_SECONDS - cumulativeVideoSeconds)
        });

    } catch (err: any) {
        console.error("Delivery allocation fatal error:", err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

