import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat, queryKieTask } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getRandomReferenceTemplate } from '@/utils/reference-templates-data';
import { dispatchCreativeToAdmin } from '@/utils/creative-dispatch-helper';

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300; // 5-minute timeout for image polling

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function extractTag(text: string, tag: string, fallback: string = ''): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : fallback;
}

export async function POST(request: Request) {
  try {
    // 1. Security check (QStash forwards the authorization header)
    const authHeader = request.headers.get('authorization');
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    const cronSecret = process.env.CRON_SECRET ? process.env.CRON_SECRET.trim() : '';
    if (cronSecret && token !== cronSecret) {
      console.warn('[Auto-Generate Worker] Unauthorized worker execution attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id: propertyId } = body;

    if (!propertyId) {
      return NextResponse.json({ error: 'Missing parameter: id' }, { status: 400 });
    }

    console.log(`[Auto-Generate Worker] Processing property ID: ${propertyId}...`);

    // A. Fetch Property Details
    const { data: prop, error: propError } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .maybeSingle();

    if (propError) throw propError;
    if (!prop) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    // B. Fetch Host Profile Context
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', prop.user_id)
      .single();

    if (!profile) throw new Error('Profile not found');

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
      console.log(`[Auto-Generate Worker] Industry auto-detected for ${prop.user_id}: ${industry}`);
    }

    // B. Prepare the Image Array
    let propImages: string[] = [];
    if (prop.images && prop.images.length > 0) propImages = prop.images.slice(0, 2);
    else if (prop.image_url) propImages = [prop.image_url];

    const allInputImages = [...propImages];
    if (logoUrl) allInputImages.push(logoUrl);

    // Parse auto-generate settings from property configurations
    let autoGenSettings: any = {};
    if (prop.configurations) {
      if (typeof prop.configurations === 'object') {
        autoGenSettings = prop.configurations.auto_gen_settings || {};
      } else {
        try {
          const parsed = JSON.parse(prop.configurations);
          autoGenSettings = parsed.auto_gen_settings || {};
        } catch (e) {}
      }
    }

    // Daily creatives are strictly generated in 3:4 aspect ratio based on selected templates
    const effectiveAspectRatio = '3:4';

    // Pick a random reference design template from user's selected templates (or all templates)
    const userSelectedTemplates = Array.isArray(profile.selected_templates) && profile.selected_templates.length > 0
      ? profile.selected_templates
      : undefined;
    const chosenTemplate = getRandomReferenceTemplate(userSelectedTemplates);
    console.log(`[Auto-Generate Worker] Using reference template for 3:4 daily creative: ${chosenTemplate.name} (${chosenTemplate.id})`);

    if (chosenTemplate.url) {
      allInputImages.push(chosenTemplate.url);
    }

    const productCustomPrompt = (autoGenSettings.custom_prompt || '').trim();

    // C. Generate custom, high-converting image prompt using Gemini
    const systemVisualRules = buildImageSystemPrompt(industry || 'general', false);

    const llmPromptForImage = `You are a world-class Ad Creative Director with 20 years of experience creating high-converting Meta ads.
Your task is to write a highly detailed, professional visual design prompt for an image generation model to create a stunning static ad graphic for this product:

PRODUCT TITLE: "${prop.title || ''}"
PRODUCT DESCRIPTION: "${prop.description || ''}"
BUSINESS NAME: "${businessName || ''}"
CONTACT DETAILS: "${contactNumber || ''}"
INDUSTRY/VERTICAL: "${industry || 'general'}"
REFERENCE DESIGN BLUEPRINT: "${chosenTemplate.name}" - ${chosenTemplate.description} (Category: ${chosenTemplate.category})
PRODUCT SPECIFIC CREATIVE INSTRUCTIONS: "${productCustomPrompt || 'None'}"
GLOBAL USER INSTRUCTIONS: "${profile.custom_prompt || ''}"
TARGET ASPECT RATIO: "${effectiveAspectRatio}"

### VISUAL DESIGN SYSTEM RULES (MANDATORY)
The image prompt you generate must instruct the image model to follow these guidelines:
${systemVisualRules}

### ADDITIONAL SPECIFIC DIRECTIONS
- Adopt the visual composition, typography framing, and aesthetic mood of reference blueprint "${chosenTemplate.name}".
- The product or property itself must be the primary focus and hero of the image. For real estate, showcase a gorgeous modern luxury apartment interior, living room, or a villa.
- Show happy, attractive, photorealistic humans (e.g. a family, a professional, or a couple) interacting naturally with the product in the scene (e.g., enjoying the living room, standing in front of the villa, working at the desk). The people should have true-to-life skin detailing, real pores, natural expressions, and look completely authentic.
- The ethnicity of the humans must match the business origin (e.g., South Asian/Indian ethnicity if the business context or product is based in India, Caucasian/Western otherwise).
- Create a complete, premium ad design layout: Include a clean, professional logo/monogram watermark of the brand in one corner. Overlay the product name and a short hook/benefit headline in an elegant, minimal geometric font. Print the business name "${businessName}" and contact info "${contactNumber}" in a tiny, clean info line at the bottom margin.
${productCustomPrompt ? `- Incorporate this specific product direction: "${productCustomPrompt}"` : ''}

Write a cohesive, single-paragraph image prompt (between 80 to 120 words) that describes this complete visual scene, composition, lighting, and design layout. Do NOT write any markdown, intro, or explanation. Output ONLY the raw prompt text itself.`;

    let finalImagePrompt = "";
    try {
      console.log("[Auto-Generate Worker] Calling Gemini to generate custom image prompt...");
      const response = await generateKieChat(llmPromptForImage, "gemini-3-flash");
      finalImagePrompt = response.trim();
      console.log("[Auto-Generate Worker] Generated Custom Image Prompt:", finalImagePrompt);
    } catch (err) {
      console.error("[Auto-Generate Worker] Gemini prompt generation failed, falling back to static prompt:", err);
      // Fallback if Gemini fails
      finalImagePrompt = [
        `Make a premium, high-converting static meta ad for ${prop.title || ''}.`,
        productCustomPrompt ? `Special instructions: ${productCustomPrompt}` : '',
        `The primary focus must be the product/property itself. Include attractive photorealistic humans (matching origin ethnicity) interacting with the product naturally (e.g. enjoying the room).`,
        `Integrate a small branding logo watermark in a corner and contact info "${contactNumber || ''}" at the bottom.`,
        `Product details: ${prop.title || ''} - ${prop.description || ''}`
      ].filter(Boolean).join("\n");
    }

    const selectedModel = allInputImages.length > 0 ? "gpt-image-2-5-flare-image-to-image" : "gpt-image-2-5-flare-text-to-image";

    const payload: any = {
      "model": selectedModel,
      "input": {
        "prompt": finalImagePrompt,
        "aspect_ratio": effectiveAspectRatio,
        "resolution": "1K"
      }
    };

    if (allInputImages.length > 0) {
      payload.input.input_urls = allInputImages;
    }

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

      if (!kieResult || kieResult.error || !kieResult.taskId) {
        throw new Error(kieResult?.error || 'Primary Kie task creation failed');
      }
    } catch (err: any) {
      console.warn("[Auto-Generate Worker] Primary task or caption failed, falling back to text-to-image:", err);
      // Fallback: If image-to-image failed (e.g. input_urls inaccessible or bad), fall back to text-to-image
      const fallbackPayload = {
        model: "gpt-image-2-5-flare-text-to-image",
        input: {
          prompt: finalImagePrompt,
          aspect_ratio: effectiveAspectRatio,
          resolution: "1K",
          output_format: "png"
        }
      };
      kieResult = await createKieTask(fallbackPayload);
      if (!generatedCaption) {
        generatedCaption = `Check out ${prop.title}! Contact us at ${contactNumber || 'our office'} for more details.`;
      }
    }

    if (!kieResult || kieResult.error || !kieResult.taskId) {
      throw new Error(`Kie AI Task failed: ${kieResult?.error || 'Unknown error'}`);
    }

    // E. Poll the status using queryKieTask directly
    let finalImageUrl = '';
    const taskId = kieResult.taskId;
    let attempts = 0;

    while (attempts < 35) {
      attempts++;
      await new Promise(res => setTimeout(res, 5000)); 
      
      const statusRes = await queryKieTask(taskId);

      if (statusRes.state === 'success' && statusRes.resultUrl) {
        finalImageUrl = statusRes.resultUrl;
        break;
      } else if (statusRes.state === 'fail') {
        throw new Error(statusRes.error || 'Image generation task failed internally');
      }
    }

    if (finalImageUrl) {
      // Compress and persist to R2
      let persistedUrl = finalImageUrl;
      try {
        console.log(`[Auto-Generate Worker] Persisting image to R2 for property ${prop.id}...`);
        const imgRes = await fetch(finalImageUrl);
        const rawBuffer = Buffer.from(await imgRes.arrayBuffer());

        let compressedBuffer: any = rawBuffer;
        let finalFileName = `generated/${prop.user_id}/${Date.now()}.jpg`;
        let contentType = 'image/jpeg';

        try {
          console.log("[Auto-Generate Worker] Compressing image with sharp...");
          compressedBuffer = await sharp(rawBuffer)
            .resize({ width: 1200, withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();
          console.log("[Auto-Generate Worker] Image compressed successfully.");
        } catch (sharpErr) {
          console.error("[Auto-Generate Worker] sharp compression failed, using original png:", sharpErr);
          finalFileName = `generated/${prop.user_id}/${Date.now()}.png`;
          contentType = 'image/png';
        }

        await r2.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: finalFileName,
          Body: compressedBuffer,
          ContentType: contentType
        }));

        persistedUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
        console.log("[Auto-Generate Worker] Successfully persisted to R2:", persistedUrl);
      } catch (r2Error) {
        console.error("[Auto-Generate Worker] R2 Persistence Failed, using original URL:", r2Error);
      }

      // F. Save to Database
      const { data: insertedAsset } = await supabaseAdmin.from('assets').insert({
        user_id: prop.user_id,
        property_id: prop.id,
        url: persistedUrl,
        type: 'image',
        status: 'pending_approval',
        caption: generatedCaption,
        kie_task_id: taskId,
        metadata: {
          auto_generated: true,
          dimensions: effectiveAspectRatio,
          time_of_day: autoGenSettings.time_of_day || '09:00',
          custom_prompt: productCustomPrompt || undefined
        },
        created_at: new Date().toISOString()
      }).select('id').single();

      // G. Trigger Push Notification to user
      await sendPushNotification(
        prop.user_id,
        'Daily Image Ready! 🌅',
        `Your new automated marketing creative for ${prop.title} is ready to view.`,
        `/dashboard/assets`
      );

      // H. Dispatch to Admin's WhatsApp & Email (Nobogent WABA with Approve & Edit buttons)
      try {
        const targetPhone = profile.whatsapp_personal_number || profile.contact_number;
        const targetEmail = profile.notification_email || profile.email;

        await dispatchCreativeToAdmin({
          recipientEmail: targetEmail,
          recipientPhone: targetPhone,
          businessName,
          creativeUrl: persistedUrl,
          caption: generatedCaption,
          title: prop.title,
          assetId: insertedAsset?.id || null,
          userId: prop.user_id,
          isFestival: false,
          clientWabaPhoneId: profile.whatsapp_phone_number_id,
          clientWabaToken: profile.whatsapp_access_token || profile.facebook_token
        });
      } catch (dispatchErr: any) {
        console.warn('[Auto-Generate Worker] Creative delivery warning (non-fatal):', dispatchErr.message);
      }

      console.log(`[Auto-Generate Worker] Completed successfully for property ${prop.id}`);
      return NextResponse.json({ success: true, url: persistedUrl });
    } else {
      throw new Error(`Timed out waiting for property ${prop.id} image generation`);
    }

  } catch (error: any) {
    console.error('[Auto-Generate Worker] Execution failed:', error);
    return NextResponse.json({ error: error.message || 'Worker execution failed' }, { status: 500 });
  }
}
