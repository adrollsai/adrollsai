import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask } from '@/utils/external-apis';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google'; 
import { checkLimitAndIncrement, refundLimit, checkStorageLimit } from '@/utils/subscription-server';
import { buildImageSystemPrompt, detectIndustry } from '@/utils/image-prompt-master';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function logToFile(msg: string) {
  const timestamp = new Date().toISOString();
  console.log(`[ImageGen] [${timestamp}] ${msg}`);
}

function extractTag(text: string, tag: string, fallback: string = ''): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : fallback;
}

export async function POST(request: Request) {
  try {
    logToFile("--- NEW IMAGE GEN REQUEST RECEIVED ---");
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      logToFile("ERROR: Unauthorized request");
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      logToFile("ERROR: Failed to parse request JSON");
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const url = new URL(request.url)
    const impersonateId = url.searchParams.get('impersonate') || body?.impersonateId || body?.payload?.impersonateId;

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
                    logToFile("ERROR: Unauthorized impersonation attempted");
                    return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
                }
            } else {
                targetUserId = impersonateId
            }
        } else {
            logToFile("ERROR: Non-privileged user attempted impersonation");
            return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
        }
    }

    logToFile(`PAYLOAD RECEIVED: ${JSON.stringify(body, null, 2)}`);

    // --- SUBSCRIPTION CHECK ---
    try {
      await checkLimitAndIncrement(targetUserId, 'images');
      await checkStorageLimit(targetUserId);
    } catch (limitErr: any) {
      logToFile(`QUOTA ERROR: ${limitErr.message}`);
      return NextResponse.json({ error: limitErr.message }, { status: 403 });
    }
    
    const { 
        userInstructions, 
        propertyDescription, 
        propertyTitle,       
        contactNumber, 
        logoUrl,
        propImages, 
        templateUrl, 
        aspectRatio = "4:5",
        model,
        isDirect = false,
        isOrganic = false,
        styleAesthetic,
        creativeCategory
    } = body;

    // Fetch user profile for business context + industry
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, business_info, mission_statement, custom_prompt, industry')
      .eq('id', targetUserId)
      .single()

    const businessName = profile?.business_name || '';
    const profileCustomPrompt = profile?.custom_prompt || '';

    // Determine the target creative category
    let targetCategory = creativeCategory || null;
    const styleOptions = ['premium', 'edm', 'high converting', 'high_converting'];
    if (!targetCategory && styleAesthetic && styleOptions.includes(styleAesthetic.toLowerCase())) {
        targetCategory = styleAesthetic;
    }
    if (isDirect && !targetCategory) {
        targetCategory = 'premium';
    }

    let normalizedCategory: 'premium' | 'edm' | 'high_converting' | null = null;
    if (targetCategory) {
        const catLower = targetCategory.toLowerCase();
        if (catLower.includes('premium')) normalizedCategory = 'premium';
        else if (catLower.includes('edm')) normalizedCategory = 'edm';
        else if (catLower.includes('high')) normalizedCategory = 'high_converting';
    }

    // Fetch random reference creative matching category
    let fetchedRefUrl = null;
    if (normalizedCategory) {
        try {
            const { data: refItems, error: refError } = await supabaseAdmin
                .from('reference_creatives')
                .select('url')
                .eq('category', normalizedCategory);
            
            if (!refError && refItems && refItems.length > 0) {
                const randomIndex = Math.floor(Math.random() * refItems.length);
                fetchedRefUrl = refItems[randomIndex].url;
                logToFile(`Selected random reference URL from database for category ${normalizedCategory}: ${fetchedRefUrl}`);
            }
        } catch (dbErr) {
            console.error("Failed to fetch reference creatives from DB:", dbErr);
        }

        // Fallback to seeded R2 URLs if none found in DB (table not created yet, or empty)
        if (!fetchedRefUrl) {
            const fallbacks = {
                premium: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/reference-creatives/premium_seed_orchid.png',
                edm: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/reference-creatives/edm_seed_farmland.jpg',
                high_converting: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/reference-creatives/high_converting_seed_99acres.jpg'
            };
            fetchedRefUrl = fallbacks[normalizedCategory];
            logToFile(`Using fallback reference URL for category ${normalizedCategory}: ${fetchedRefUrl}`);
        }
    }

    // Force organic smartphone style for high converting ads
    let isOrganicOverride = isOrganic;
    if (normalizedCategory === 'high_converting') {
        isOrganicOverride = true;
    }

    // --- INDUSTRY DETECTION & CACHING ---
    let industry = profile?.industry || null;
    if (!industry) {
        logToFile("Industry not set for user. Auto-detecting...");
        industry = await detectIndustry(
            profile?.business_name || '',
            profile?.business_info || '',
            profile?.mission_statement || ''
        );
        // Persist to DB so we don't re-detect on every request
        await supabaseAdmin
            .from('profiles')
            .update({ industry })
            .eq('id', targetUserId);
        logToFile(`Industry auto-detected and saved: ${industry}`);
    }

    // --- BUILD MASTER VISUAL PRODUCTION RULES ---
    const visualProductionRules = buildImageSystemPrompt(industry, isOrganicOverride);

    logToFile(`STARTING GENERATION | MODEL: ${model} | Target User ID: ${targetUserId} | Business Name: ${businessName} | Industry: ${industry} | Category: ${normalizedCategory || 'None'}`);
    
    // Consolidate and filter images (Remove placeholders, SVGs and invalid URLs)
    // SVGs are often rejected by Image-to-Image models as 'unsupported file type'.
    const filterImages = (urls: any[]) => (urls || []).filter(url => 
        url && 
        typeof url === 'string' && 
        url.startsWith('http') && 
        !url.includes('placehold.co') && 
        !url.toLowerCase().endsWith('.svg')
    );

    const validPropImages = filterImages(propImages);
    const validLogo = filterImages([logoUrl]);
    const validTemplate = filterImages([templateUrl || fetchedRefUrl]);
    
    const allInputImages = [...validPropImages, ...validLogo, ...validTemplate];

    // Build category specific layout and aesthetic guidance
    let categoryPromptGuideline = "";
    if (normalizedCategory === 'premium') {
        categoryPromptGuideline = "Style: Premium luxury ad creative layout. High-end clean commercial photography of the product/property, premium interior glow, warm lighting, elegant reflections, clean professional composition, elegant text design.";
    } else if (normalizedCategory === 'edm') {
        categoryPromptGuideline = "Style: EDM (Emotion & Feeling) ad creative. Focus on abstract lifestyle visual elements that evoke an emotional response (e.g. cozy fireplace atmosphere, beautiful view, warm pool water, abstract beauty) rather than directly showing the product. Sell the feeling. Include a powerful emotional hook.";
    } else if (normalizedCategory === 'high_converting') {
        categoryPromptGuideline = "Style: High converting raw organic ad creative. Unpolished, low-effort smartphone photo look that does not seem like an ad. Display a raw, clean image of the product. Directly on the image itself, overlay a simple, clean, readable text caption/card displaying bare minimum info (Location, Price, and Configuration) with zero clutter.";
    }

    const hasReference = validTemplate.length > 0;

    // Build literal, simplified, high-converting image prompt
    const promptParts = [
        "Make a high converting static meta ad, make sure the result is super real looking, and include attractive looking humans in it (ethnicity should be according to where the business is from) that don't look ai like, they should look super real. Only include super essential info in the image text overlays so it is not cluttered with text too much.",
        hasReference ? "Take design layout and style inspiration from the reference image creative (provided in the input images) and mold it for our product with a slight variation." : "",
        categoryPromptGuideline,
        `Product Description: ${propertyTitle || ''}. ${propertyDescription || ''}`,
        businessName ? `Business Info - Brand/Business Name: ${businessName}` : '',
        contactNumber ? `Business Info - Contact Info: ${contactNumber}` : '',
        logoUrl ? `Business Logo: Include the business logo cleanly in a corner of the image.` : '',
        (!normalizedCategory && styleAesthetic) ? `Style: Render the image in a ${styleAesthetic} aesthetic.` : '',
        profileCustomPrompt ? `Profile Custom Instructions: ${profileCustomPrompt}` : '',
        userInstructions ? `Custom Instructions: ${userInstructions}` : ''
    ].filter(Boolean);

    const finalImagePrompt = promptParts.join("\n");

    let kieModel = isDirect ? 'nano-banana-2' : 'gpt-image-2-text-to-image';
    let imageField = 'image_input'; // Default for text-to-image and nano

    // Revert: If we have ANY valid images (including logo), use Image-to-Image
    if (!isDirect && allInputImages.length > 0) {
        kieModel = 'gpt-image-2-image-to-image';
        imageField = 'input_urls';
    }
    
    // Explicitly check for requested model names
    if (model === 'image-2.0' || model === 'gpt/gpt-image-2-text-to-image') {
        kieModel = allInputImages.length > 0 ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image';
        if (allInputImages.length > 0) imageField = 'input_urls';
    } else if (model === 'nano' || model === 'nano-banana-2') {
        kieModel = 'nano-banana-2';
        imageField = 'image_input';
    }

    let payload: any = {
      "model": kieModel,
      "input": {
        "prompt": finalImagePrompt,
        "aspect_ratio": aspectRatio,
        "resolution": "1K"
      }
    };
    
    // Assign the correct image field based on the model if we have images
    if (allInputImages.length > 0) {
        payload.input[imageField] = allInputImages;
    }
    
    // Only text-to-image supports output_format usually
    if (kieModel === 'gpt-image-2-text-to-image') {
        payload.input.output_format = "png";
    }

    logToFile(`KIE PAYLOAD (Attempt 1 - ${kieModel}): ${JSON.stringify(payload, null, 2)}`);

    let kieResult;
    try {
        kieResult = await createKieTask(payload);
        if (!kieResult || kieResult.error || !kieResult.taskId) {
            const errMsg = kieResult?.error || "Task creation failed";
            logToFile(`PRIMARY MODEL ERROR: ${errMsg}`);
            throw new Error(errMsg);
        }
    } catch (primaryError: any) {
        logToFile(`FAILOVER TRIGGERED: ${primaryError.message}. Switching to nano-banana-2...`);
        
        // FAILOVER to nano-banana-2
        if (kieModel !== 'nano-banana-2') {
            const failoverModel = 'nano-banana-2';
            
            // SIMPLIFIED PROMPT for failover to avoid content policy rejections
            const simplifiedPrompt = `High-converting ad design for: "${propertyTitle}". 
Context: "${propertyDescription}". 
Brand: "${businessName}". 
Premium design, clean layout, bold headline.`;

            const failoverPayload = {
                model: failoverModel,
                input: {
                    prompt: simplifiedPrompt,
                    image_input: allInputImages,
                    aspect_ratio: aspectRatio,
                    resolution: "1K"
                }
            };
            
            logToFile(`KIE PAYLOAD (Attempt 2 - ${failoverModel}): ${JSON.stringify(failoverPayload, null, 2)}`);
            kieResult = await createKieTask(failoverPayload);
        } else {
            throw primaryError;
        }
    }

    if (!kieResult || kieResult.error || !kieResult.taskId) {
      const finalError = kieResult?.error || "Final attempt failed";
      logToFile(`Kie AI Task failed permanently: ${finalError}`);
      
      // REFUND: Give back the credit if task failed to start even after failover
      await refundLimit(user.id, 'images');
      
      throw new Error(`Design server error: ${finalError}`);
    }
    
    logToFile(`✅ SUCCESS: KIE TASK CREATED: ${kieResult.taskId}`);

    // 2. Try the Caption Generation Safely
    let finalCaption = "";
    try {
        logToFile("Generating high-converting Meta ad caption via Gemini...");
        const { text } = await generateText({
          model: google('gemini-3.5-flash'),
          prompt: `You are a world-class Direct Response Copywriter. 
Write a high-converting Meta ad caption for: "${propertyTitle}". 
Context: "${propertyDescription}". 
Business: "${businessName}". 
Contact: "${contactNumber || 'DM for details!'}". 

RULES: 
- Use Alex Hormozi frameworks (Hook, Retain, Reward). 
- Keep the length MODERATE (max 400 characters). Avoid long, exhausting paragraphs.
- Use bullet points and emojis. 
- No bold markdown (**). 
- DO NOT use any hashtags (#).
- At the very end of the caption, add 5-6 important keywords relevant to the business/property inside a single bracket, e.g., [Keyword1, Keyword2, Keyword3...]
- Make it stop the scroll.
- Output ONLY the caption, NO extra text.`,
        });
        finalCaption = text;
        logToFile("Caption generated successfully.");
    } catch (chatError: any) {
        logToFile(`Caption generation failed: ${chatError.message}. Trying fallback model...`);
        try {
            const { text } = await generateText({
              model: google('gemini-3-flash-preview'),
              prompt: `Write a high-converting Meta ad caption for: "${propertyTitle}". Context: "${propertyDescription}". Business: "${businessName}". Contact: "${contactNumber || 'DM for details!'}" without bolding and without hashtags.`,
            });
            finalCaption = text;
        } catch {
            finalCaption = "Check out this premium property! DM for more details.";
        }
    }

    return NextResponse.json({ 
        taskId: kieResult.taskId,
        caption: finalCaption,
    })

  } catch (error: any) {
    logToFile(`FATAL ERROR: ${error.message}`);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}