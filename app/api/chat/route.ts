import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask } from '@/utils/external-apis';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google'; 
import { checkLimitAndIncrement, refundLimit, checkStorageLimit } from '@/utils/subscription-server';
import { buildImageSystemPrompt, buildReferenceCreativePreamble, buildImageDisambiguationPreamble, detectIndustry } from '@/utils/image-prompt-master';

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
  let creditDeductedSuccess = false;
  let targetUserId = '';
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
    targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
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

    // --- SUBSCRIPTION & CREDITS CHECK ---
    const { hasEnoughCredits, deductCredits, addCredits } = await import('@/utils/credits')
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
        creativeCategory,
        excludedImages = [],
        isEdit = false
    } = body;

    const hasCredits = await hasEnoughCredits(supabaseAdmin, targetUserId, 30);
    if (!hasCredits) {
      logToFile(`CREDIT ERROR: Insufficient credits for image generation.`);
      await refundLimit(targetUserId, 'images');
      return NextResponse.json({ error: 'Insufficient credits. You need at least 30 Nobo Credits to generate an AI image.' }, { status: 402 });
    }

    const creditDeducted = await deductCredits(supabaseAdmin, targetUserId, 30, 'ai_generation', `AI Image Generation - ${propertyTitle || 'Ad'}`);
    if (!creditDeducted) {
      await refundLimit(targetUserId, 'images');
      return NextResponse.json({ error: 'Failed to process credit deduction.' }, { status: 500 });
    }
    creditDeductedSuccess = true;

    // Fetch user profile for business context + industry
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, business_info, mission_statement, custom_prompt, industry, brand_color, contact_number')
      .eq('id', targetUserId)
      .single() as any;

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
                .eq('category', normalizedCategory)
                .is('user_id', null);
            
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
        !url.toLowerCase().endsWith('.svg') &&
        !excludedImages.includes(url)
    );

    const validPropImages = filterImages(propImages);
    const validLogo = logoUrl && !excludedImages.includes(logoUrl) ? filterImages([logoUrl]) : [];
    const validTemplate = templateUrl && !excludedImages.includes(templateUrl) ? filterImages([templateUrl]) : [];
    
    // Capped at 16 images maximum for GPT 2 model
    const allInputImages = [...validPropImages, ...validLogo].slice(0, 16);

    const hasReference = validTemplate.length > 0;

    // Detect if user requested to exclude logo or business info
    const excludeLogo = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+logo\b/i);
    const excludeBusinessInfo = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip|only)\s+(business|brand|info|text|headline|label|overlay|words|letters|writing)\b/i) || userInstructions?.toLowerCase().includes('raw picture') || userInstructions?.toLowerCase().includes('raw image');

    // Multimodal Visual Style Analysis using Gemini if a reference ad image is selected
    let styleDescription = "";
    if (hasReference && validTemplate[0]) {
      try {
        const refUrl = validTemplate[0];
        logToFile(`Fetching reference creative for style analysis: ${refUrl}`);
        const refRes = await fetch(refUrl);
        if (refRes.ok) {
          const refBuffer = Buffer.from(await refRes.arrayBuffer());
          const refMimeType = refRes.headers.get('content-type') || 'image/png';
          
          logToFile("Calling Gemini to analyze reference creative style...");
          const styleAnalysisInstruction = `Analyze the visual style, design aesthetic, layout composition, typography styling, and color palette of this reference ad in detail. Describe it in a way that guides an AI image generator (like Stable Diffusion or DALL-E) to match this exact aesthetic, layout, and composition. Focus on colors, lighting, placing of objects, backgrounds, design hierarchy, and overall mood. Write a single detailed paragraph.
IMPORTANT: Do NOT transcribe or include any specific text contents, business names, telephone numbers, barcodes, QR codes, website URLs, or licensing/registration numbers (like RERA) found on the reference ad. Instead, refer to them generally as layout placeholders (e.g., "a logo placeholder in the corner", "licensing text placeholder", "contact detail placeholder").`;

          let geminiResult;
          try {
            geminiResult = await generateText({
              model: google('gemini-3.5-flash'),
              messages: [
                {
                  role: 'user',
                  content: [
                    { 
                      type: 'text', 
                      text: styleAnalysisInstruction
                    },
                    {
                      type: 'image',
                      image: refBuffer,
                      mimeType: refMimeType
                    } as any
                  ]
                }
              ]
            });
          } catch (geminiErr1) {
            logToFile(`Failed with gemini-3.5-flash: ${(geminiErr1 as Error).message}. Retrying with gemini-3-flash-preview...`);
            geminiResult = await generateText({
              model: google('gemini-3-flash-preview'),
              messages: [
                {
                  role: 'user',
                  content: [
                    { 
                      type: 'text', 
                      text: styleAnalysisInstruction
                    },
                    {
                      type: 'image',
                      image: refBuffer,
                      mimeType: refMimeType
                    } as any
                  ]
                }
              ]
            });
          }
          styleDescription = geminiResult.text.trim();
          logToFile(`Successfully extracted style description from reference creative: ${styleDescription}`);
        } else {
          logToFile(`Failed to fetch reference creative file: Status ${refRes.status}`);
        }
      } catch (err: any) {
        logToFile(`Error extracting style from reference: ${err.message}`);
      }
    }

    // Call Master Designer LLM if no reference style is selected and we are NOT in edit mode
    const finalContactNumber = contactNumber || profile?.contact_number || '';
    let designerPrompt = "";
    if (!hasReference && !isEdit) {
      try {
        logToFile("Calling Gemini Master Designer to compose optimized image generation prompt...");
        const designComposerPrompt = `You are a Master Advertising Designer with 20+ years of experience in creating high-converting, visually stunning ad creatives for premium social media campaigns.
Your job is to write a highly detailed, optimized image generation prompt that will be sent to an AI image model (like Stable Diffusion or DALL-E) to produce a professional, premium ad poster.

Here is the information provided by the user:
- Product/Property Title: ${propertyTitle || 'N/A'}
- Product/Property Description: ${propertyDescription || 'N/A'}
- Business Name: ${businessName || 'N/A'}
- Brand/Business Info: ${profile?.business_info || 'N/A'}
- Target Industry: ${industry || 'N/A'}
- Contact Number / Call to Action: ${finalContactNumber || 'N/A'}
- Custom User Instructions: ${userInstructions || 'None'}

Your goal is to synthesize this information and output an extremely detailed, descriptive visual prompt for the image generation model.
Follow these master designer rules to ensure the prompt is premium, attention-grabbing, and informative:
1. BRIGHT LIGHT THEME & COMPOSITION: Describe a highly detailed, premium, and professional visual layout. The design should default to a bright, clean, airy light theme with high-exposure natural morning sunlight, clear bright blue skies, and a vibrant, crisp commercial aesthetic. Avoid dark, moody, dim, twilight, or sunset settings unless explicitly requested.
2. INFORMATION & CREATIVE COPYWRITING Hooks: Unless the user's custom instructions explicitly request to exclude text overlays, make the creative highly informative. Include clear, high-converting text overlay instructions: a bold benefit-driven headline highlighting the product value proposition, and a sub-headline listing key features or pricing details. You MUST prominently include and highlight the property's city or location name (e.g. "Zirakpur", "Mohali", "Chandigarh", or "Near Chandigarh" based on the product description or details) in the text overlays so viewers immediately know where the property is located. If the city or location is NOT mentioned in the product description/details, you MUST NOT hallucinate or invent one; instead, keep it generic or omit the location name entirely (e.g., use "In a Prime Location" or focus solely on property benefits). Avoid boring, lazy generic slogans like "elevated luxury living" or "experience luxury". Instead, write catchy, fresh, creative, and highly specific copywriting hooks tailored to the actual property facts (e.g. BHK size, exact locations, price points). Instruct the model to use modern, clean, and stylized typography (such as elegant serif headers paired with clean minimalist geometric sans-serif sub-headers, crisp lettering with high contrast size hierarchy, and subtle light legibility overlays).
3. MANDATORY CONTACT INFO & BRANDING: Unless the user's custom instructions explicitly request to exclude the contact number or business info, you MUST instruct the model to display the contact number "${finalContactNumber || ''}" cleanly, professionally, and prominently. It should be positioned elegantly at the bottom footer or banner of the design (e.g., "For info, contact: ${finalContactNumber || ''}" or "Call ${finalContactNumber || ''}").
4. LOGO INTEGRATION: Unless the user's custom instructions explicitly request to exclude the logo, instruct the image model to place the business logo cleanly and integrate it seamlessly (blending the background smoothly into the surrounding theme/sky, avoiding unblended raw shapes).
5. HUMAN SUBJECT INCLUSION & VISIBILITY: Unless the user's custom instructions explicitly request to exclude humans/people (e.g. "no people", "no humans"), you MUST instruct the model to include close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, highly attractive, photorealistic humans (such as a happy family, an elegant couple, or a successful professional individual depending on the product context) in the foreground showing happy, positive, and smiling facial expressions of joy and satisfaction. Instruct the model that skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) and look completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look. Avoid distant, tiny, or blurry figures. The ethnicity of the humans must match the geographical region/country of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).
6. IMAGE HERO & FIDELITY: Instruct the model to analyze the provided product/property photos, keep the generated property/building visuals extremely close, faithful, and visually consistent with the actual structures in the photos, and place it as the main subject of the canvas.
7. EXPLICIT EXCLUSION HANDLING: If the custom user instructions explicitly ask to remove, exclude, or skip text overlays, headlines, contact numbers, or logos (e.g., "no text", "no logo", "raw picture without text", "raw image"), you MUST follow this strictly. In that case, do NOT instruct the image model to include any text overlays, slogans, contact numbers, or logos. Describe only the raw visual scene of the product/property itself.
8. OUTPUT FORMAT: The output should be a single cohesive, highly detailed, descriptive paragraph containing the exact scene description, layouts, styling, text overlays, and details for the image model. Do NOT include any intro, conversational text, or metadata in your output. Just output the final prompt.`;

        const imageParts: any[] = [];
        for (const imgUrl of validPropImages.slice(0, 4)) {
          try {
            const res = await fetch(imgUrl);
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer());
              const mimeType = res.headers.get('content-type') || 'image/png';
              imageParts.push({
                type: 'image',
                image: buffer,
                mimeType: mimeType
              } as any);
            }
          } catch (err) {
            logToFile(`Error fetching image for Master Designer: ${imgUrl}`);
          }
        }

        const messagesContent: any[] = [
          {
            type: 'text',
            text: designComposerPrompt
          },
          ...imageParts
        ];

        let geminiResult;
        try {
          geminiResult = await generateText({
            model: google('gemini-3.5-flash'),
            messages: [
              {
                role: 'user',
                content: messagesContent
              }
            ]
          });
        } catch (geminiErr1) {
          logToFile(`Failed with gemini-3.5-flash for Master Designer: ${(geminiErr1 as Error).message}. Retrying with gemini-3-flash-preview...`);
          geminiResult = await generateText({
            model: google('gemini-3-flash-preview'),
            messages: [
              {
                role: 'user',
                content: messagesContent
              }
            ]
          });
        }

        designerPrompt = geminiResult.text.trim();
        logToFile(`Master Designer generated prompt: ${designerPrompt}`);
      } catch (err: any) {
        logToFile(`Error in Master Designer LLM flow: ${err.message}`);
      }
    }

    const referencePreamble = buildReferenceCreativePreamble(validPropImages.length, validLogo.length > 0, hasReference);

    let finalImagePrompt = "";
    if (isEdit) {
      finalImagePrompt = `Modify the input image according to these custom instructions: "${userInstructions}". 
Make the edits clean, professional, and blend seamlessly with the original content. Do NOT add any messy or gibberish text overlays unless explicitly requested. Keep the visual theme intact while applying the edits.`;
    } else if (hasReference) {
      const promptParts = [
          referencePreamble,
          `Create a clean, high quality, professional ad creative design.`,
          propertyTitle ? `Subject: ${propertyTitle}` : '',
          propertyDescription ? `Details/Description: ${propertyDescription}` : '',
          (businessName && !excludeBusinessInfo) ? `Business Name: ${businessName}` : '',
          (validLogo.length > 0 && !excludeLogo) ? `Include the provided business logo cleanly. Integrate the brand logo seamlessly with the design and background. Do NOT place it inside a raw, unblended black or white box/circle; blend its background shape smoothly into the background sky/theme.` : '',
          (finalContactNumber && !excludeBusinessInfo) ? `Mandatory Contact Info: Include the contact number "${finalContactNumber}" clearly and elegantly, placed according to the reference creative layout.` : '',
          `You are provided with multiple inventory/product photos. Carefully analyze all input photos, identify the most relevant/aesthetically appealing ones matching the subject, and use only those relevant images as the visual base for the design (ignore any unrelated images).`,
          `Do NOT add any messy or gibberish text overlays on the image unless explicitly requested. Keep the image clean, professional, and visually focused.`,
          `IMPORTANT NEGATIVE CONSTRAINT: Do NOT copy any text, barcodes, QR codes, website URLs, or license/RERA numbers (such as RERA registration numbers) directly from the reference image. If the reference creative contains a QR code, license number, or specific website address, omit them entirely from the final generated image.`,
          (!userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i)) ? `Include close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, highly attractive, photorealistic humans (e.g. a happy family, an elegant couple, or a professional individual, depending on the product context) in the foreground showing happy, positive, and smiling facial expressions of joy. Skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) looking completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look. The ethnicity of the humans must match the geographical region of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).` : '',
          styleDescription ? `MATCH THE FOLLOWING STYLE, LAYOUT, AND COMPOSITION EXACTLY:\n${styleDescription}` : '',
          userInstructions ? `Custom Instructions: ${userInstructions}` : ''
      ].filter(Boolean);
      finalImagePrompt = promptParts.join("\n");
    } else {
      const disambiguationPreamble = buildImageDisambiguationPreamble(validPropImages.length, validLogo.length > 0);
      const fallbackPrompt = [
          `Create a highly detailed, premium, and professional ad creative design.`,
          propertyTitle ? `Subject: ${propertyTitle}` : '',
          propertyDescription ? `Details/Description: ${propertyDescription}` : '',
          (businessName && !excludeBusinessInfo) ? `Business Name: ${businessName}` : '',
          (validLogo.length > 0 && !excludeLogo) ? `Include the provided business logo cleanly. Integrate the brand logo seamlessly with the design and background. Do NOT place it inside a raw, unblended black or white box/circle; blend its background shape smoothly into the background sky/theme.` : '',
          (finalContactNumber && !excludeBusinessInfo) ? `Mandatory Contact Info: Include the contact number "${finalContactNumber}" clearly and elegantly in a banner or footer at the bottom of the poster (e.g. "Call: ${finalContactNumber}").` : '',
          `You are provided with multiple inventory/product photos. Carefully analyze all input photos, identify the most relevant/aesthetically appealing ones matching the subject, and use only those relevant images as the visual base for the design (ignore any unrelated images).`,
          `Ensure the overall composition is highly professional, balanced, featuring cinematic warm lighting, detailed textures, and a luxury editorial aesthetic.`,
          (!userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i)) ? `Include close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, highly attractive, photorealistic humans (e.g. a happy family, an elegant couple, or a professional individual, depending on the product context) in the foreground showing happy, positive, and smiling facial expressions of joy. Skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) looking completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look. The ethnicity of the humans must match the geographical region of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).` : '',
          !excludeBusinessInfo ? `If text is not excluded, make the creative highly informative: include a bold, clean benefit-driven headline (based on ${propertyTitle || 'the product'}), a sub-headline highlighting key details, BHK specifications, and prominently including and highlighting the property's city or location name (based on ${propertyDescription || 'the product description'}, but only if explicitly mentioned; do NOT hallucinate or invent a location if it is not in the text, in which case omit it or keep it generic like "In a Prime Location"), and display the brand logo and contact details clearly.` : '',
          excludeBusinessInfo ? `Do NOT add any text overlays, slogans, contact numbers, writing, or labels on the image. Keep it purely as a clean, raw photograph.` : '',
          excludeLogo ? `Do NOT include any brand logo or watermark on the image.` : '',
          userInstructions ? `Custom Instructions: ${userInstructions}` : ''
      ].filter(Boolean).join("\n");
      finalImagePrompt = designerPrompt ? `${disambiguationPreamble}${designerPrompt}` : `${disambiguationPreamble}${fallbackPrompt}`;
    }

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
      
      // REFUND: Give back the credit and limit
      await refundLimit(targetUserId, 'images');
      await addCredits(supabaseAdmin, targetUserId, 30, 'ai_generation', `Refund: AI Image Generation failed - ${propertyTitle || 'Ad'}`);
      creditDeductedSuccess = false;
      
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
    if (creditDeductedSuccess) {
      try {
        await refundLimit(targetUserId, 'images');
        const { addCredits } = await import('@/utils/credits');
        await addCredits(supabaseAdmin, targetUserId, 30, 'ai_generation', `Refund: AI Image Generation failed`);
      } catch (refundErr) {
        console.error("Failed to refund credit/limit in catch block:", refundErr);
      }
    }
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}