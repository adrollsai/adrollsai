import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

function extractTag(text: string, tag: string, fallback: string = ''): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : fallback;
}

// Initialize Supabase Admin to bypass Row Level Security since this runs in the background
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Define the type to fix the TypeScript red squiggle
type GenerationResult = {
    id: string;
    title?: string;
    status: 'success' | 'failed';
    error?: string;
};

export const maxDuration = 300; // Important for image generation polling

export async function GET(request: Request) {
    // 1. Security check to ensure only your cron job can hit this endpoint
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // 2. Fetch all properties that have auto_generate enabled
        const { data: properties, error: propError } = await supabaseAdmin
            .from('properties')
            .select('*')
            .eq('auto_generate', true);

        if (propError || !properties || properties.length === 0) {
            return NextResponse.json({ message: 'No properties scheduled for auto-generation' });
        }

        const baseUrl = new URL(request.url).origin;

        // Run auto-generations in the background to prevent cron-job.org 30s timeout
        (async () => {
            console.log(`[Auto-Generate Background] Starting auto-generation for ${properties.length} properties...`);
            
            const promises = properties.map(async (prop) => {
                try {
                    // A. Fetch User Profile Context
                    const { data: profile } = await supabaseAdmin
                        .from('profiles')
                        .select('*')
                        .eq('id', prop.user_id)
                        .single();

                    if (!profile) throw new Error("Profile not found");

                    const businessName = profile.business_name || '';
                    const contactNumber = profile.contact_number || '';
                    const logoUrl = profile.logo_url || '';

                    // Auto-detect and cache industry if not set
                    let industry = profile.industry || null;
                    if (!industry) {
                        industry = await detectIndustry(
                            profile.business_name || '',
                            profile.business_info || '',
                            profile.mission_statement || ''
                        );
                        await supabaseAdmin
                            .from('profiles')
                            .update({ industry })
                            .eq('id', prop.user_id);
                        console.log(`[Auto-Generate] Industry auto-detected for ${prop.user_id}: ${industry}`);
                    }

                    // Build master visual production rules
                    const visualProductionRules = buildImageSystemPrompt(industry, false);

                    // B. Prepare the Image Array
                    let propImages: string[] = [];
                    if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 2);
                    else if (prop.image_url) propImages = [prop.image_url];

                    const allInputImages = [...propImages];
                    if (logoUrl) allInputImages.push(logoUrl);

                    // C. Build literal, simplified, high-converting image prompt
                    const promptParts = [
                        "Make a high converting static meta ad, make sure the result is real looking, and include attractive looking humans in it (ethnicity should be according to where the business is from) that don't look artificial, they should look real. Only include essential info in the image text overlays so it is not cluttered with text. IMPORTANT: Do NOT include ANY information that is not explicitly provided below — no made-up prices, discounts, claims, phone numbers, websites, or contact details. If a detail is not provided, leave it out entirely.",
                        `Product Info: ${prop.title || ''}. Description: ${prop.description || ''}`,
                        businessName ? `Business Name: ${businessName}` : '',
                        contactNumber ? `Contact Info: ${contactNumber}` : '',
                        logoUrl ? `Business Logo: Include the business logo cleanly in a corner of the creative.` : 'Business Logo: Include the business logo cleanly in a corner.',
                        profile.custom_prompt ? `Custom Instructions: ${profile.custom_prompt}` : ''
                    ].filter(Boolean);

                    const finalImagePrompt = promptParts.join("\n");

                    const payload = {
                      "model": "gpt-image-2-image-to-image", // Upgraded to premium model
                      "input": {
                        "prompt": finalImagePrompt,
                        "input_urls": allInputImages, // Using correct field for image-to-image
                        "aspect_ratio": "4:5",
                        "resolution": "1K"
                      }
                    };

                    // D. Fire External API requests
                    let generatedCaption = "";
                    let kieResult;
                    
                    try {
                        const copyPrompt = `
                          You are an elite direct-response copywriter trained in Alex Hormozi's "$100M Offers" framework.
                          Write a high-converting caption for:
                          TITLE: ${prop.title}
                          DETAILS: ${prop.description || ''}
                          COMPANY: ${businessName}
                          MISSION: ${profile.mission_statement || ''}
                          CONTACT: ${contactNumber || 'DM for details!'}
                          FRAMEWORK:
                          1. HOOK: Call out the buyer.
                          2. OFFER: The no-brainer deal.
                          3. VALUE STACK: Benefit bullets.
                          4. SCARCITY/URGENCY: Why now.
                          5. CTA: Direct instruction.
                          
                          IMPORTANT: Keep the caption length under 400 characters so that it fits within social posting limits, including Instagram.
                        `;
                        const [taskRes, chatRes] = await Promise.all([
                            createKieTask(payload),
                            generateKieChat(copyPrompt, "gemini-3-flash")
                        ]);
                        kieResult = taskRes;
                        generatedCaption = chatRes;
                    } catch (err: any) {
                        console.error("[Auto-Generate] Task submission or caption generation failed, falling back:", err);
                        kieResult = await createKieTask(payload);
                        generatedCaption = `Check out ${prop.title}! Contact us at ${contactNumber || 'our office'} for more details.`;
                    }

                    if (!kieResult || kieResult.error || !kieResult.taskId) {
                      throw new Error(`Kie AI Task failed: ${kieResult?.error || 'Unknown error'}`);
                    }

                    // E. Poll the status API
                    let finalImageUrl = '';
                    const taskId = kieResult.taskId;
                    let attempts = 0;

                    while (attempts < 30) {
                        attempts++;
                        await new Promise(res => setTimeout(res, 4000)); 
                        
                        const checkResponse = await fetch(`${baseUrl}/api/check-status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ taskId })
                        });
                        const checkData = await checkResponse.json();

                        if (checkData.data && checkData.data.state === 'success') {
                            if (checkData.data.resultJson) {
                                try {
                                    const resultObj = JSON.parse(checkData.data.resultJson);
                                    if (resultObj.resultUrls?.[0]) { finalImageUrl = resultObj.resultUrls[0]; break; }
                                } catch(e) {}
                            } else if (checkData.data.resultUrl) {
                                finalImageUrl = checkData.data.resultUrl;
                                break;
                            }
                        } else if (checkData.data && checkData.data.state === 'failed') {
                            throw new Error('Image generation task failed internally');
                        }
                    }

                    if (finalImageUrl) {
                        // --- NEW: COMPRESS AND PERSIST TO R2 ---
                        let persistedUrl = finalImageUrl;
                        try {
                            console.log(`[Auto-Generate] Persisting image to R2 for property ${prop.id}...`);
                            const imgRes = await fetch(finalImageUrl);
                            const rawBuffer = Buffer.from(await imgRes.arrayBuffer());

                            let compressedBuffer: any = rawBuffer;
                            let finalFileName = `generated/${prop.user_id}/${Date.now()}.jpg`;
                            let contentType = 'image/jpeg';

                            try {
                                console.log("[Auto-Generate] Compressing image with sharp...");
                                compressedBuffer = await sharp(rawBuffer)
                                    .resize({ width: 1200, withoutEnlargement: true })
                                    .jpeg({ quality: 80, progressive: true })
                                    .toBuffer();
                                console.log("[Auto-Generate] Image compressed successfully.");
                            } catch (sharpErr) {
                                console.error("[Auto-Generate] sharp compression failed, using original png:", sharpErr);
                                finalFileName = `generated/${prop.user_id}/${Date.now()}.png`;
                                contentType = 'image/png';
                            }

                            await r2.send(new PutObjectCommand({
                                Bucket: R2_BUCKET,
                                Key: finalFileName,
                                Body: compressedBuffer,
                                ContentType: contentType
                            }));

                            persistedUrl = `${R2_PUBLIC_URL}/adrolls-storage/${finalFileName}`;
                            console.log("[Auto-Generate] Successfully persisted to R2:", persistedUrl);
                        } catch (r2Error) {
                            console.error("[Auto-Generate] R2 Persistence Failed, using original URL:", r2Error);
                        }

                        // F. Save to Database
                        await supabaseAdmin.from('assets').insert({
                            user_id: prop.user_id,
                            property_id: prop.id,
                            url: persistedUrl,
                            type: 'image',
                            status: 'Draft',
                            caption: generatedCaption
                        });

                        // G. Trigger Push Notification to user
                        await sendPushNotification(
                            prop.user_id,
                            'Daily Image Ready! 🌅',
                            `Your new automated marketing creative for ${prop.title} is ready to view.`,
                            `/dashboard/assets`
                        );
                        console.log(`[Auto-Generate Background] Completed successfully for property ${prop.id}`);
                    } else {
                        console.error(`[Auto-Generate Background] Timed out waiting for property ${prop.id} generation`);
                    }

                } catch (error: any) {
                    console.error(`[Auto-Generate Background] Failed for property ${prop.id}:`, error.message);
                }
            });

            await Promise.all(promises);
            console.log("[Auto-Generate Background] Finished processing all properties.");
        })();

        // Respond immediately to release cron-job.org connection
        return NextResponse.json({ success: true, message: `Auto-generation triggered in the background for ${properties.length} properties.` });
        
    } catch (err: any) {
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}