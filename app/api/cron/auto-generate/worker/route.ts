import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

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
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // C. Generate custom, high-converting image prompt using Gemini
    const systemVisualRules = buildImageSystemPrompt(industry || 'general', false);

    const llmPromptForImage = `You are a world-class Ad Creative Director with 20 years of experience creating high-converting Meta ads.
Your task is to write a highly detailed, professional visual design prompt for an image generation model to create a stunning static ad graphic for this product:

PRODUCT TITLE: "${prop.title || ''}"
PRODUCT DESCRIPTION: "${prop.description || ''}"
BUSINESS NAME: "${businessName || ''}"
CONTACT DETAILS: "${contactNumber || ''}"
INDUSTRY/VERTICAL: "${industry || 'general'}"
CUSTOM USER INSTRUCTIONS: "${profile.custom_prompt || ''}"

### VISUAL DESIGN SYSTEM RULES (MANDATORY)
The image prompt you generate must instruct the image model to follow these guidelines:
${systemVisualRules}

### ADDITIONAL SPECIFIC DIRECTIONS
- The product or property itself must be the primary focus and hero of the image. For real estate, showcase a gorgeous modern luxury apartment interior, living room, or a villa.
- Show happy, attractive, photorealistic humans (e.g. a family, a professional, or a couple) interacting naturally with the product in the scene (e.g., enjoying the living room, standing in front of the villa, working at the desk). The people should have true-to-life skin detailing, real pores, natural expressions, and look completely authentic.
- The ethnicity of the humans must match the business origin (e.g., South Asian/Indian ethnicity if the business context or product is based in India, Caucasian/Western otherwise).
- Create a complete, premium ad design layout: Include a clean, professional logo/monogram watermark of the brand in one corner. Overlay the product name and a short hook/benefit headline in an elegant, minimal geometric font. Print the business name "${businessName}" and contact info "${contactNumber}" in a tiny, clean info line at the bottom margin.

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
        `The primary focus must be the product/property itself. Include attractive photorealistic humans (matching origin ethnicity) interacting with the product naturally (e.g. enjoying the room).`,
        `Integrate a small branding logo watermark in a corner and contact info "${contactNumber || ''}" at the bottom.`,
        `Product details: ${prop.title || ''} - ${prop.description || ''}`
      ].join("\n");
    }

    const selectedModel = allInputImages.length > 0 ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image";

    const payload: any = {
      "model": selectedModel,
      "input": {
        "prompt": finalImagePrompt,
        "aspect_ratio": "4:5",
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
    } catch (err: any) {
      console.error("[Auto-Generate Worker] Task submission or caption generation failed, falling back:", err);
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
    const host = new URL(request.url).host;
    const isLocal = host.includes('localhost') || host.includes('local.nobogent.com') || host.includes('127.0.0.1');
    const baseUrl = isLocal ? 'http://127.0.0.1:3000' : new URL(request.url).origin;

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
            if (resultObj.resultUrls?.[0]) {
              finalImageUrl = resultObj.resultUrls[0];
              break;
            }
          } catch(e) {}
        } else if (checkData.data.resultUrl) {
          finalImageUrl = checkData.data.resultUrl;
          break;
        }
      } else if (checkData.data && (checkData.data.state === 'failed' || checkData.data.state === 'fail')) {
        throw new Error('Image generation task failed internally');
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
      await supabaseAdmin.from('assets').insert({
        user_id: prop.user_id,
        property_id: prop.id,
        url: persistedUrl,
        type: 'image',
        status: 'Draft',
        caption: generatedCaption,
        created_at: new Date().toISOString()
      });

      // G. Trigger Push Notification to user
      await sendPushNotification(
        prop.user_id,
        'Daily Image Ready! 🌅',
        `Your new automated marketing creative for ${prop.title} is ready to view.`,
        `/dashboard/assets`
      );

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
