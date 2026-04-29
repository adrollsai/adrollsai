import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';

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

                const businessName = profile.business_name || 'Your Business';
                const contactNumber = profile.contact_number || '';
                const logoUrl = profile.logo_url || '';

                // B. Prepare the Image Array
                let propImages: string[] = [];
                if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 2);
                else if (prop.image_url) propImages = [prop.image_url];

                const allInputImages = [...propImages];
                if (logoUrl) allInputImages.push(logoUrl);

                // C. Construct Prompts 
                let finalImagePrompt = `Create a high-converting, professional Meta ad design for the product: "${prop.title}". \n\n`;
                finalImagePrompt += `DESIGN PHILOSOPHY (ALEX HORMOZI FRAMEWORK):\n`;
                finalImagePrompt += `2. BOLD TYPOGRAPHY: Use large, authoritative, high-contrast text for the main headline.\n`;
                finalImagePrompt += `4. ZERO CLUTTER: Every element must drive the direct-response goal.\n\n`;
                finalImagePrompt += `PRODUCT CONTEXT: ${prop.description || ''}. \n`;
                finalImagePrompt += `VISUAL STYLE: Professional commercial photography, premium lighting, engaging composition. \n`;

                if (logoUrl) {
                    finalImagePrompt += `\n*** LOGO INSTRUCTIONS ***\nIntegrate the brand logo cleanly into the design without distortion.\n`;
                }

                finalImagePrompt += `\nAspect Ratio: 1:1.`;
                if (contactNumber) finalImagePrompt += ` Display contact info: ${contactNumber}.`;

                const payload = {
                  "model": "nano-banana-2",
                  "input": {
                    "prompt": finalImagePrompt,
                    "image_input": allInputImages,
                    "aspect_ratio": "1:1",
                    "resolution": "1K",
                    "output_format": "png"
                  }
                };

                const copyPrompt = `
                  You are an elite direct-response copywriter trained in Alex Hormozi's "$100M Offers" framework.
                  Write a high-converting caption for:
                  TITLE: ${prop.title}
                  DETAILS: ${prop.description || ''}
                  COMPANY: ${businessName}
                  CONTACT: ${contactNumber || 'DM for details!'}
                  FRAMEWORK:
                  1. HOOK: Call out the buyer.
                  2. OFFER: The no-brainer deal.
                  3. VALUE STACK: Benefit bullets.
                  4. SCARCITY/URGENCY: Why now.
                  5. CTA: Direct instruction.
                `;

                // D. Fire External API requests
                const [kieResult, generatedCaption] = await Promise.all([
                    createKieTask(payload),
                    generateKieChat(copyPrompt, "gemini-3-flash")
                ]);

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