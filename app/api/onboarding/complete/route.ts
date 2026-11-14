import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { createKieImageTask, createKieTask } from '@/utils/external-apis';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { ensureJpegImage } from '@/utils/image-converter';
import { getReferenceTemplate, ALL_REFERENCE_TEMPLATES } from '@/utils/reference-templates-data';
import { resolveRequestUser } from '@/utils/api-auth';
import { reserveCredits, chargeHold, closeHold } from '@/lib/automation/billing';
import { planOnboarding, onboardingJobId, imageCredits, videoCredits } from '@/lib/automation/onboarding-plan';
import { imageModelFor } from '@/lib/agent/media-models';
import { outboundRecipient, testBanner } from '@/lib/automation/test-mode';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_CHARACTER_URL = "https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/character-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780563818432-trimmed.mp4";
const DEFAULT_CHARACTER_AUDIO_URL = "https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/logos/voice-sample-9bbf6e51-283e-48d1-bbb4-8dc546cc74b2-1780556476936.mp3";
const DEFAULT_CHARACTER_DESCRIPTION = "A young Indian female with straight shoulder-length black hair and a calm expression. She wears a striped button-down shirt and brown trousers, standing in a modern white interior with a feather-shaped wall light.";

/**
 * Ceiling on what one onboarding run may spend.
 *
 * This is NOT a volume cap on the business (those were removed deliberately in
 * 20261111230000_uncap_volume_use_approval.sql and must not come back). It is the
 * funding limit for a single first-run job: a human onboards once, an agent can
 * loop the same call, and an unbounded first run is the difference between a free
 * taster and a drained wallet. Above this the plan is trimmed, not refused.
 */
const MAX_ONBOARDING_CREDITS = 4000;

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
        const { user } = await resolveRequestUser(request);

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
            .select('business_name, business_info, client_features, logo_url, contact_number, address, custom_domain, character_url, character_audio_url, character_description, whatsapp_access_token, whatsapp_phone_number_id, facebook_token, subscription_status')
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

        // 2a. Welcome credits: every business starts with 5,000 so it can try the
        //     product before paying. Idempotent per account via a flag on the profile,
        //     because onboarding can be re-submitted (back button, retry) and a second
        //     grant would be free money. 1 credit = ₹1; every vendor cost is charged at
        //     a 2x margin, so 5,000 credits ≈ ₹2,500 of our actual spend.
        //
        //     These credits are the FIRST RUN'S FUNDING. `hasEnoughCredits` used to
        //     refuse them because it also demanded an active subscription, so the
        //     grant was unspendable for anyone who skipped the paywall — that is fixed
        //     in utils/credits.ts (funding is the question, not billing status).
        try {
            const alreadyGranted = Boolean(existingProfile?.client_features?.welcome_credits_granted);
            if (!alreadyGranted) {
                const { grantCreditsOnce } = await import('@/lib/automation/billing');
                const grant = await grantCreditsOnce(supabaseAdmin, {
                    userId: user.id,
                    amount: 5000,
                    category: 'topup',
                    description: 'Welcome credits — 5,000 to start',
                    ref: `welcome:${user.id}`,
                });
                if (grant.granted || grant.duplicate) {
                    await supabaseAdmin
                        .from('profiles')
                        .update({
                            client_features: {
                                ...(existingProfile?.client_features || {}),
                                ...(profileUpdates.client_features || {}),
                                welcome_credits_granted: true,
                                welcome_credits_granted_at: new Date().toISOString(),
                            },
                        })
                        .eq('id', user.id);
                    console.log('[Onboarding API] Welcome credits granted (5000) to', user.id);
                } else {
                    console.warn('[Onboarding API] Welcome credits were NOT granted (grant returned false)');
                }
            }
        } catch (creditErr: any) {
            // Never fail onboarding because the welcome grant hiccuped: the account is
            // usable either way, and support can re-grant.
            console.warn('[Onboarding API] Welcome credit grant error:', creditErr?.message || creditErr);
        }

        // 2b. Provision the automation policy (default ON) and the calling
        //     policy. Previously neither table had a writer, so every
        //     automation was opt-in-by-accident and nothing ran for a new
        //     account. Both writes are idempotent.
        try {
            const { error: autoErr } = await supabaseAdmin
                .from('tenant_automations')
                .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
            if (autoErr) console.warn('[Onboarding API] tenant_automations provision failed:', autoErr.message);

            const { error: polErr } = await supabaseAdmin
                .from('agent_policies')
                .upsert({ user_id: user.id, is_enabled: true }, { onConflict: 'user_id', ignoreDuplicates: true });
            if (polErr) console.warn('[Onboarding API] agent_policies provision failed:', polErr.message);
        } catch (provErr: any) {
            // Never fail onboarding because of automation provisioning.
            console.warn('[Onboarding API] Automation provisioning error:', provErr?.message);
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

        const host = request.headers.get('host') || 'localhost:3000';
        const isLocal = host.includes('localhost') || host.includes('local.nobogent.com') || host.includes('127.0.0.1');
        const baseUrl = isLocal ? 'http://127.0.0.1:3000' : `https://${host}`;

        const activeTemplates: string[] = (Array.isArray(selectedTemplates) && selectedTemplates.length > 0)
            ? selectedTemplates
            : ['pinterest_pin_0', 'pinterest_pin_1', 'pinterest_pin_2', 'pinterest_pin_3', 'pinterest_pin_4'];

        // 4a. Persist the catalogue FIRST. Intake is free and must not be behind a
        //     paywall: the property rows are what the agent will work on once the
        //     account is funded, so losing them on a paywalled run would lose the
        //     customer's own input.
        const savedProjects: Array<{ property: any; config: InputProjectConfig }> = [];
        for (const proj of resolvedProjects) {
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
                    // Enrolled by default: the marketing-department workflow is
                    // ON for new accounts and controlled from
                    // /dashboard/profile/creation-automation + automation toggles.
                    auto_generate: true
                })
                .select()
                .single();

            if (propertyError || !property) {
                console.error(`[Onboarding API] Property insertion failed for ${proj.title}:`, propertyError);
                continue;
            }
            savedProjects.push({ property, config: proj });
        }

        // 4b. Price the run, then fund it. Nothing billable happens without a hold.
        //
        // The plan is built from the projects that were ACTUALLY saved, not from the
        // requested list: a property insert can fail, and if plan indices referred to
        // the requested array, every artefact after the failure would be generated
        // for the wrong project.
        const plan = planOnboarding(
            savedProjects.map(s => ({ creativesCount: s.config.creativesCount, videos: s.config.videos })),
            { maxCredits: MAX_ONBOARDING_CREDITS, maxVideoSeconds: 300 }
        );

        const quote = {
            jobId: onboardingJobId(user.id, plan),
            costInCredits: plan.costInCredits,
            imageCount: plan.imageCount,
            videoCount: plan.videoCount,
            trimmed: plan.trimmed,
            lines: plan.items.map(i => ({
                kind: i.kind,
                project: savedProjects[i.projectIndex]?.config.title || `project ${i.projectIndex + 1}`,
                credits: i.credits,
                seconds: i.kind === 'video' ? i.vendorDuration : undefined,
            })),
        };

        const funding = await reserveCredits(supabaseAdmin, {
            userId: user.id,
            jobId: quote.jobId,
            amount: plan.costInCredits,
            ttlMinutes: 240,
            reason: `onboarding: ${plan.imageCount} creatives, ${plan.videoCount} videos`,
        });

        if (!funding.ok) {
            // Not funded. The intake above is saved, the catalogue exists, and the
            // quote is returned so the UI can say exactly what the money buys.
            console.log(`[Onboarding API] Generation not funded for ${user.id}: needs ${plan.costInCredits}, has ${funding.available}`);
            return NextResponse.json({
                success: true,
                message: 'Your business is set up. Choose a plan to generate the first creatives and video.',
                intakeSaved: true,
                needsFunding: true,
                quote,
                availableCredits: funding.available,
                shortfall: funding.available === null ? null : Math.max(0, plan.costInCredits - Number(funding.available)),
            });
        }

        const holdId = funding.holdId;
        let creditsCharged = 0;
        let budgetExhausted = false;
        const generationSummary: Array<{ projectTitle: string; imageTasksQueued: number; videoTasksQueued: number }> = [];

        try {
            // 5. Generate exactly what the plan says, charging each artefact as the
            //    vendor accepts it. A charge that cannot be covered caps the run
            //    instead of overdrawing the wallet.
            for (let pIdx = 0; pIdx < savedProjects.length; pIdx++) {
                const { property, config: proj } = savedProjects[pIdx];
                const projectItems = plan.items.filter(i => i.projectIndex === pIdx);
                if (projectItems.length === 0) continue;

                let imageTasksCount = 0;
                let videoTasksCount = 0;
                console.log(`[Onboarding API] Project ${pIdx + 1}/${savedProjects.length} "${property.title}": ${projectItems.length} artefact(s) planned`);

                for (const item of projectItems) {
                    if (budgetExhausted) break;

                    // ---------------- image ----------------
                    if (item.kind === 'image') {
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

                            const selectedImageModel = imageModelFor(imageInputUrls);

                            const taskId = await createKieImageTask(object.imagePrompt, selectedImageModel, "3:4", imageInputUrls);

                            if (!taskId) {
                                console.warn(`[Onboarding API] Creative ${item.itemIndex + 1} was not accepted by the provider; not charging for it.`);
                                continue;
                            }

                            imageTasksCount++;

                            // Charge only once the vendor has accepted the work: a
                            // charge for a submission that never happened is the
                            // fastest way to lose a customer's trust. The plan is
                            // derived from the hold, so the total cannot exceed it.
                            const charge = await chargeHold(supabaseAdmin, {
                                holdId,
                                credits: imageCredits(),
                                description: `Onboarding creative — ${property.title}`,
                                ref: `${quote.jobId}:img:${pIdx}:${item.itemIndex}`,
                            });
                            if (charge.ok && !charge.capped) {
                                creditsCharged += charge.charged;
                            } else if (!charge.duplicate) {
                                budgetExhausted = true;
                                console.warn(`[Onboarding API] Stopping after this creative: ${charge.error || 'the reservation is used up'}`);
                            }

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
                        } catch (imgErr: any) {
                            console.error(`[Onboarding API] Failed to generate creative ${item.itemIndex + 1} for ${property.title}:`, imgErr.message);
                        }
                        continue;
                    }

                    // ---------------- video ----------------
                    const requestedDuration = Number(item.duration) || 15;
                    const vid: InputVideoConfig = (proj.videos && proj.videos[item.itemIndex]) || { duration: requestedDuration, customInstructions: '' };

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
                                duration: item.vendorDuration || (requestedDuration <= 15 ? 15 : 30), // Seedance mini accepts 15 or 30
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
                            // Charge once the provider has accepted the render, never
                            // before — see the image path above for why.
                            const charge = await chargeHold(supabaseAdmin, {
                                holdId,
                                credits: videoCredits(requestedDuration),
                                description: `Onboarding video (${requestedDuration}s) — ${property.title}`,
                                ref: `${quote.jobId}:vid:${pIdx}:${item.itemIndex}`,
                            });
                            if (charge.ok && !charge.capped) {
                                creditsCharged += charge.charged;
                            } else if (!charge.duplicate) {
                                budgetExhausted = true;
                                console.warn(`[Onboarding API] Stopping after this video: ${charge.error || 'the reservation is used up'}`);
                            }

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
        } finally {
            // Whatever happened, the unspent part of the reservation goes back.
            const closed = await closeHold(supabaseAdmin, holdId, 'onboarding run finished');
            console.log(
                `[Onboarding API] Run closed: charged ${creditsCharged}, released ${closed.released}, state ${closed.state}`
            );
        }

        // 6. Send WhatsApp notification to Admin & deliver live website link
        const targetWaPhone = whatsappNumber || existingProfile?.contact_number;
        const waPhoneId = existingProfile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
        const waToken = existingProfile?.whatsapp_access_token || existingProfile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        const liveWebsiteUrl = existingProfile?.custom_domain
            ? `https://${existingProfile.custom_domain}`
            : `${baseUrl}/website/${user.id}`;

        // Every outbound channel goes through test mode, so a first run during the
        // pilot lands on the founder's phone and never on a customer's.
        const waRecipient = outboundRecipient(targetWaPhone);

        if (waRecipient && waPhoneId && waToken) {
            try {
                const summaryText = generationSummary
                    .map(s => `• *${s.projectTitle}*: ${s.imageTasksQueued} Creatives + ${s.videoTasksQueued} Video(s)`)
                    .join('\n');

                const introMsg = `🚀 *Nobogent Studio Initialized!*

Welcome *${resolvedCompanyName}*! We have commenced generation across your projects:
${summaryText}

🌐 *Your Live Website*:
${liveWebsiteUrl}
(Live now, with your catalogue synced automatically. You can generate a fully branded version any time from Dashboard → Pages.)

📲 *How Approvals & Revisions Work*:
As each creative is synthesized, it will be delivered here with product copy in WhatsApp template format.
• Reply *'Approve'* to instantly schedule it to your socials at peak 7:30 PM.
• Reply with changes (e.g. _"Change the price to ₹2.1 Cr"_ or _"Regenerate style"_) to trigger automatic revisions!${testBanner()}`;

                fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${waToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        recipient_type: 'individual',
                        to: waRecipient.replace(/\D/g, ''),
                        type: 'text',
                        text: { body: introMsg }
                    })
                }).catch(err => console.error("[Onboarding API] WhatsApp alert error:", err));
            } catch { }
        } else if (targetWaPhone && !waRecipient) {
            console.warn('[Onboarding API] Refusing to send: outbound test mode is on with no test number configured.');
        }

        console.log("[Onboarding API] Multi-project onboarding completed successfully!");
        return NextResponse.json({
            success: true,
            message: `Onboarding completed for ${savedProjects.length} project(s).`,
            liveWebsiteUrl,
            summary: generationSummary,
            quote,
            creditsCharged,
            budgetExhausted,
        });

    } catch (error: any) {
        console.error("[Onboarding API] Fatal Error:", error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
