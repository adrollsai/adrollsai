import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createKieTask } from '@/utils/external-apis';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google'; 
import { checkLimitAndIncrement, refundLimit, checkStorageLimit } from '@/utils/subscription-server';

function logToFile(msg: string) {
  const timestamp = new Date().toISOString();
  // Using standard console.log for Vercel/Next.js cloud logs
  // Local file system writing is disabled due to EROFS errors in serverless functions.
  console.log(`[ImageGen] [${timestamp}] ${msg}`);
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
        isOrganic = false // New flag for raw/organic look
    } = body;

    // Fetch user profile for business context
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name')
      .eq('id', targetUserId)
      .single()

    const businessName = profile?.business_name || 'Your Business';

    logToFile(`STARTING GENERATION | MODEL: ${model} | Target User ID: ${targetUserId} | Business Name: ${businessName}`);
    
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
    const validTemplate = filterImages([templateUrl]);
    
    const allInputImages = [...validPropImages, ...validLogo, ...validTemplate];

    // --- HORMORZI-STYLE DIRECT RESPONSE PROMPT ---
    let styleInstructions = isOrganic 
      ? `AESTHETIC: RAW & ORGANIC. Use a smartphone-photo style. It must look like an unedited, authentic photo taken by a regular person, not a professional photographer. 
         LIGHTING: Natural, slightly imperfect, no studio glow.
         TYPOGRAPHY: Hand-written or slightly unorganized text overlays. Avoid professional agency layouts. It must feel "real" and trustworthy.`
      : `HYPER-REALISM: The image must look like a professional photograph taken with a high-end camera (Sony A7R V or Canon EOS R5). 
         NO ARTIFICIAL SHEEN: Avoid that typical "AI look". No plasticy textures, no artificial glowing sheen, and no saturated "HDR-style" over-processing.
         NATURAL LIGHTING: Use soft, natural light (Golden Hour or professional studio lighting). Shadows should be soft and realistic.`;

    // Dynamic prompt synthesis via Gemini
    let synthesizedPrompt = "";
    try {
        logToFile("Synthesizing dynamic ad creative image prompt via Gemini...");
        const synthesisPrompt = `You are a world-class Direct Response Ad Creative Director and Senior Copywriter.
Your goal is to write a highly detailed, premium image generation prompt for a static Meta ad.

We are designing an ad for:
- Product/Service Title: "${propertyTitle}"
- Description/Context: "${propertyDescription}"
- Business Name: "${businessName}"
- Contact Number: "${contactNumber || 'None'}"
- User Style/Instructions: "${userInstructions || 'None'}"
- Design Style: ${isOrganic ? 'RAW & ORGANIC smartphone photo look (natural light, unedited, authentic look)' : 'HYPER-REALISTIC studio photo (high-end professional camera, soft lighting, premium agency layout)'}
- Aspect Ratio: ${aspectRatio}

Your task is to write a highly detailed, descriptive image generation prompt (around 150-250 words) for the AI Image Generator.
Follow these rules:
1. THE HOOK & HEADLINE (CRITICAL):
   - Formulate a highly relatable, scroll-stopping headline hook that directly appeals to the target audience's desires/pain points. Do NOT just print the product title. For example, for a NEET course, a hook like "Crush NEET 2027!" or "Score 680+ in NEET" is far better than "Path IQ".
   - The headline MUST be short and bold (maximum 4-5 words) to ensure the image generator renders the text perfectly without spelling errors.
   - Specify exactly where the headline should be rendered (e.g. "large, bold, high-contrast text at the top").
2. THE VISUAL SCENE & COMPOSITION:
   - Describe a stunning, premium scene that showcases the product's value.
   - Include high-quality, aspirational, beautiful people matching the ethnicity of the business context (${businessName}) who look successful.
   - Specify natural, soft lighting and a harmonious, curated color palette (avoiding generic primary colors, use HSL-tailored premium colors like deep indigo, warm gold, rich teal, or charcoal).
   - Keep the design clean, premium, and uncluttered.
3. BRANDING & CONTACT:
   - Instruct the generator to professionally integrate the business logo (${logoUrl ? 'using the logo URL' : ''}) and the contact number (${contactNumber || ''}) with premium, high-end typography and placement (e.g., at the bottom or corner of the image).
4. OUTPUT FORMAT:
   - Output ONLY the final detailed prompt that will be sent directly to the image generator. Do not include introductory text, conversational phrases, or formatting blocks. Just the prompt.

Write the prompt now:`;

        let modelName = 'gemini-3.5-flash';
        let response;
        try {
            response = await generateText({
              model: google(modelName),
              prompt: synthesisPrompt,
            });
        } catch (err: any) {
            logToFile(`Failed with ${modelName}: ${err.message}. Falling back to gemini-3-flash-preview...`);
            modelName = 'gemini-3-flash-preview';
            response = await generateText({
              model: google(modelName),
              prompt: synthesisPrompt,
            });
        }
        
        synthesizedPrompt = response.text.trim();
        logToFile(`Synthesized prompt successfully using ${modelName}: ${synthesizedPrompt}`);
    } catch (err: any) {
        logToFile(`Warning: Prompt synthesis failed: ${err.message}. Falling back to default static prompt.`);
    }

    let finalImagePrompt = synthesizedPrompt || `PERSONA: World-class Senior Ad Creative Director (20+ years exp) at a top-tier global advertising agency.
OBJECTIVE: Design a "High-Value" professional Meta Ad creative that encapsulates the product's essence with industry-standard excellence while maintaining extreme scroll-stopping power.

TITLE/OFFER: "${propertyTitle}"
DESCRIPTION/CONTEXT: "${propertyDescription}"
BUSINESS NAME: "${businessName}"
CONTACT NUMBER: "${contactNumber || 'Not provided'}"

DESIGN RULES:
1. ${styleInstructions}
2. PEOPLE: ALWAYS include high-quality, "super beautiful" people who look successful and aspirational. 
3. ETHNICITY: Match the ethnicity of the people to the context of the Business Name (${businessName}) and Location. If the business is regional, use the appropriate local ethnicity.
4. BRAND ENCAPSULATION: Professionally integrate the product details into the scene. It should feel like a premium, state-of-the-art brand advertisement.
5. NO NONSENSE: Ensure perfectly clean anatomy and NO nonsensical artifacts or "AI hallucinations".
6. HOOK & HIERARCHY: Use a clear visual hook that immediately draws the eye to the most important element of the offer.
7. TYPOGRAPHY & TEXT DENSITY: Use minimal, high-impact text. Do NOT clutter the image with long sentences. Include ONLY the Business Name and the most important "Hook" or "Offer". Ensure all text is large, bold, and easily readable on a small mobile screen. Avoid tiny fine print.
8. BRAND INTEGRATION: Include the provided BUSINESS LOGO and the CONTACT NUMBER (${contactNumber || ''}) with premium, high-end typography and placement.

USER INSTRUCTIONS: ${userInstructions || 'None'}
ASPECT RATIO: ${aspectRatio}`;

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
    let generatedCaption = "Check out this premium property! DM for more details.";
    try {
        const { text } = await generateText({
          model: google('gemini-3-flash-preview'),
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
        generatedCaption = text;
        logToFile("Caption generated successfully.");
    } catch (chatError: any) {
        logToFile(`Caption generation failed: ${chatError.message}`);
    }

    return NextResponse.json({ 
        taskId: kieResult.taskId,
        caption: generatedCaption,
    })

  } catch (error: any) {
    logToFile(`FATAL ERROR: ${error.message}`);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}