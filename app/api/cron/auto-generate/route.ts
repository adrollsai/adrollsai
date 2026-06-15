import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';

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
        
        // Apply the type here!
        const results: GenerationResult[] = [];

        // 3. Process concurrently
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
                    "Make a high converting static meta ad, make sure the result is super real looking, and include attractive looking humans in it (ethnicity should be according to where the business is from) that don't look ai like, they should look super real. Only include super essential info in the image text overlays so it is not cluttered with text too much.",
                    `Product Info: ${prop.title || ''}. Description: ${prop.description || ''}`,
                    businessName ? `Business Name: ${businessName}` : '',
                    contactNumber ? `Contact Info: ${contactNumber}` : '',
                    logoUrl ? `Business Logo: Include the business logo cleanly in a corner.` : '',
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
                    `;
                    const [taskRes, chatRes] = await Promise.all([
                        createKieTask(payload),
                        generateKieChat(copyPrompt, "gemini-3-flash")
                    ]);
                    kieResult = taskRes;
                    generatedCaption = chatRes;
                } catch (err: any) {
                    console.error("Task submission or caption generation failed, falling back:", err);
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
                    // F. Save to Database
                    await supabaseAdmin.from('assets').insert({
                        user_id: prop.user_id,
                        property_id: prop.id,
                        url: finalImageUrl,
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

                    results.push({ id: prop.id, title: prop.title, status: 'success' });
                } else {
                    results.push({ id: prop.id, status: 'failed', error: 'Timed out waiting for generation' });
                }

            } catch (error: any) {
                results.push({ id: prop.id, status: 'failed', error: error.message });
            }
        });

        // Wait for all auto-generations to conclude
        await Promise.all(promises);

        return NextResponse.json({ success: true, processed: results });
        
    } catch (err: any) {
        return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
    }
}