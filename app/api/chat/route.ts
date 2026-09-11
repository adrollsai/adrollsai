import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask, callDeepSeekWithUsage } from '@/utils/external-apis';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google'; 
import { checkLimitAndIncrement, refundLimit, checkStorageLimit } from '@/utils/subscription-server';
import { buildImageSystemPrompt, buildReferenceCreativePreamble, buildImageDisambiguationPreamble, detectIndustry, getRandomVisualArchetype, getRandomHumanPersona } from '@/utils/image-prompt-master';

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
        isEdit = false,
        isBrandOnly = false
    } = body;

    const effectiveIsBrandOnly = isBrandOnly || 
      !propertyTitle || 
      propertyTitle === 'Brand Campaign' || 
      propertyTitle === 'Brand Creative' || 
      propertyTitle === 'Brand Ad';

    const hasCredits = await hasEnoughCredits(supabaseAdmin, targetUserId, 10);
    if (!hasCredits) {
      logToFile(`CREDIT ERROR: Insufficient credits for image generation.`);
      await refundLimit(targetUserId, 'images');
      return NextResponse.json({ error: 'Insufficient credits. You need at least 10 Nobo Credits to generate an AI image.' }, { status: 402 });
    }

    const creditDeducted = await deductCredits(supabaseAdmin, targetUserId, 10, 'ai_generation', `AI Image Generation - ${propertyTitle || 'Ad'}`);
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

    // Only use reference design if explicitly selected by the user (via templateUrl)
    // Never auto-inject fallback reference designs when not selected

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
    const filterImages = (urls: any[]) => (urls || []).filter(url => 
        url && 
        typeof url === 'string' && 
        url.startsWith('http') && 
        !url.includes('placehold.co') && 
        !url.toLowerCase().endsWith('.svg') &&
        !excludedImages.includes(url)
    );

    // Detect if user requested to exclude logo, business info, or house photos
    const excludeLogo = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+logo\b/i);
    const excludeBusinessInfo = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip|only)\s+(business|brand|info|text|headline|label|overlay|words|letters|writing)\b/i) || userInstructions?.toLowerCase().includes('raw picture') || userInstructions?.toLowerCase().includes('raw image');
    const excludeHousePhoto = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip|do not show|not show|avoid|never show)\s+(kothi|house|villa|building|property photo|home|exterior|property picture|property image|structure)\b/i) ||
      userInstructions?.toLowerCase().includes('do not have') ||
      userInstructions?.toLowerCase().includes('no picture') ||
      userInstructions?.toLowerCase().includes('no photo') ||
      userInstructions?.toLowerCase().includes('misrepresent') ||
      userInstructions?.toLowerCase().includes('mis represents');

    // Helper to encode and sanitize image URLs (handles unencoded spaces and query params)
    const sanitizeImageUrl = (rawUrl: string): string => {
        try {
            const parsed = new URL(rawUrl);
            return parsed.href;
        } catch (e) {
            return encodeURI(rawUrl);
        }
    };

    let validPropImages = filterImages(propImages).map(sanitizeImageUrl);
    if (excludeHousePhoto) {
        logToFile("[CHAT ROUTE] Negative constraint detected (excludeHousePhoto): Suppressing input property photos.");
        validPropImages = [];
    }
    const validLogo = logoUrl && !excludedImages.includes(logoUrl) ? filterImages([logoUrl]).map(sanitizeImageUrl) : [];
    const validTemplate = templateUrl && !excludedImages.includes(templateUrl) ? filterImages([templateUrl]).map(sanitizeImageUrl) : [];
    
    // Capped at 16 images maximum for GPT 2 model
    const allInputImages = [...validPropImages, ...validLogo].slice(0, 16);

    const hasReference = validTemplate.length > 0;

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
          const styleAnalysisInstruction = `You are a Master Creative Director & Visual System Architect. 
Your task is to analyze this reference creative advertisement and deconstruct it into a universal "Graphic Design System Blueprint".

UNIVERSAL TWO-LAYER DECONSTRUCTION METHOD:
Layer 1 — STRIP & OMIT CONTENT ASSETS (ZERO-ELEMENT-BLEED):
- Do NOT describe, transcribe, or mention any specific physical building, house, villa, car, human face, specific brand name, telephone number, address, or QR code found in this image. They are content assets and MUST NOT be mentioned.

Layer 2 — FAITHFULLY EXTRACT VISUAL DESIGN BLUEPRINT:
Deconstruct the visual creative strictly into its 4 universal design parameters:
1. GRAPHIC CONTAINER & SIGNATURE FRAMING GEOMETRY: Describe the exact layout structure and geometric container shape framing or holding the hero image (e.g. custom icon silhouette, floating card, geometric mask, split container, or full-bleed grid). Explicitly instruct how the hero image should be framed.
2. COLOR PALETTE & LIGHTING MOOD: Primary background colors, accent colors, translucent pill gradients, contrast ratio, and ambient lighting mood.
3. HAUTE-COUTURE TYPOGRAPHY SYSTEM: Font pairing styles (e.g., high-fashion serif header like Bodoni/Cormorant or sleek geometric sans-serif like Trajan/Futura), champagne gold foil or crisp ivory-white tones (NEVER cheap flat yellow gradients), wide kerning/letter-spacing for subtext, and text alignment.
4. DECORATIVE BADGES & ICON PLACEMENT: Placement zones for feature pills, logo stamps, CTA banners, and decorative badge elements.

Write a structured, single-paragraph VISUAL DESIGN BLUEPRINT describing this complete advertising design system so an AI image model can apply this exact layout framework and visual branding to ANY new product.`;

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

    // Call Master Designer LLM if we are NOT in edit mode (handles both reference-guided and promptless generations)
    const finalContactNumber = contactNumber || profile?.contact_number || '';
    let designerPrompt = "";
    if (!isEdit) {
      try {
        logToFile("Calling Gemini Master Designer to compose optimized image generation prompt...");
        
        // Dynamically compute unique visual archetype & human persona for maximum generation variety
        const requestSeed = `${Date.now()}_${Math.random()}_${propertyTitle || ''}_${userInstructions || ''}`;
        const activeArchetype = getRandomVisualArchetype(propertyTitle, propertyDescription, requestSeed);
        let activePersona = getRandomHumanPersona(propertyTitle, propertyDescription, userInstructions, requestSeed);
        
        // Check for explicit user exclusion of people
        const userExcludedHumans = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i);
        if (userExcludedHumans) {
          activePersona = {
            id: 'no_humans',
            name: 'Pure Architectural & Interior Focus (No Humans)',
            hasHumans: false,
            promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans or people in this creative image. Focus 100% of the visual spotlight on the gorgeous property architecture, luxury interior design, crisp lighting, and graphic typography overlays.'
          };
        }

        logToFile(`DYNAMIC VARIATION GENERATED | HasReference: ${hasReference} | Archetype: ${activeArchetype.name} | Persona: ${activePersona.name}`);

        const styleGuidanceSection = hasReference && styleDescription
          ? `CRITICAL REFERENCE DESIGN BLUEPRINT (Extracted from User Reference Image):
${styleDescription}

UNIVERSAL MASTER DESIGNER SYNTHESIS INSTRUCTION:
Synthesize the extracted reference blueprint above into a 5-star luxury social media campaign creative for the user's product.
- Faithfully preserve and reproduce the reference creative's exact visual layout structure, container framing geometry, color scheme, and typography placement.
- Place the user's actual property/product photos as the hero visual inside the reference's signature container framing geometry.
- Render all text in modern, crisp, flat typography with high-contrast legibility.`
          : `MANDATORY CREATIVE DESIGN BLUEPRINT (FOR VARIETY & UNIQUENESS):
- ${activeArchetype.promptInstructions}
- LIGHTING & ATMOSPHERE: ${activeArchetype.lighting}.
- VISUAL COMPOSITION: ${activeArchetype.composition}.
- TYPOGRAPHY & OVERLAYS: ${activeArchetype.typography}.`;

        const designComposerPrompt = `You are an elite Master Advertising Designer and Creative Director with 20+ years of direct-response advertising experience crafting multi-million-dollar high-converting Meta, Instagram, and social ad campaigns.
Your mission is to write a highly detailed, conversion-optimized image generation prompt that will be sent to an AI image model to produce an ultra-photorealistic, high-converting commercial ad poster.

Here is the information provided by the user:
- Campaign Type: ${effectiveIsBrandOnly ? 'Brand & Service Campaign (No Specific Product Selected)' : 'Product / Property Campaign'}
- Product/Property Title: ${effectiveIsBrandOnly ? 'N/A (Brand / Service Ad)' : (propertyTitle || 'N/A')}
- Product/Property Description: ${effectiveIsBrandOnly ? 'N/A' : (propertyDescription || 'N/A')}
- Business Name: ${businessName || 'N/A'}
- Brand/Business Info: ${profile?.business_info || profile?.mission_statement || 'N/A'}
- Target Industry: ${industry || 'N/A'}
- Contact Number / Call to Action: ${finalContactNumber || 'N/A'}
- Custom User Instructions: ${userInstructions || 'None'}

${styleGuidanceSection}

Your goal is to synthesize this information and output an extremely detailed, descriptive visual prompt for the image generation model.
Follow these 20-year direct-response advertising master rules to maximize click-throughs and conversion:
1. SCROLL-STOPPING COMMERCIAL PHOTOGRAPHY: The creative must look like authentic live-action commercial photography captured by a top advertising photographer. Never make it look like a 3D render, cartoon, architectural blueprint, or CGI illustration. Bright, airy, commercial natural morning or golden-hour lighting with crisp shadows and believable textures.
${effectiveIsBrandOnly ? `2. BRAND & CAMPAIGN VISUAL SPOTLIGHT: No specific product is selected. Focus the visual canvas on high-impact brand aesthetic, aspirational lifestyle imagery, luxury graphic typography, and scene setting representing ${businessName || 'the brand'} in the ${industry || 'commercial'} sector according to the custom user instructions.` : `2. 60-70% HERO PRODUCT/PROPERTY FOCUS: The real product or property must occupy 60-70% of the canvas as the undisputed hero. ${excludeHousePhoto ? 'CRITICAL EXCLUSION: The user explicitly specified NOT to show a kothi/house/building photo. Do NOT describe or include any house, villa, kothi, or building exterior.' : 'Keep the generated property/building visuals faithful to the real structures in the input photos.'}`}
3. DIRECT-RESPONSE VISUAL HIERARCHY & BENEFIT HOOK: Include clear, high-converting direct-response text overlay instructions:
   - Primary Benefit Headline: A bold, emotionally compelling hook calling out ${effectiveIsBrandOnly ? 'the core service benefit or campaign hook from the instructions' : 'the dream lifestyle or solving the primary buyer friction'}.
   - ${effectiveIsBrandOnly ? `Brand Identification: Highlight "${businessName || 'the business'}" with prestigious typography.` : `Location Badge: You MUST prominently highlight the property's city or location name (e.g. "Mohali", "Zirakpur", "Chandigarh") in high-contrast typography so local buyers immediately recognize it.`}
   - Key Value Pills: Clean, semi-transparent frosted badges highlighting key specs or pricing (e.g. "3 & 4 BHK Luxury Floors", "Ready for Possession").
4. LUXURY HAUTE-COUTURE TYPOGRAPHY: Render main headlines in high-contrast serif (Bodoni/Cormorant) or sleek architectural geometric sans-serif with wide tracking. Subtle champagne gold foil or crisp ivory-white lettering. Absolutely FORBID cheap flat yellow gradients or crude generic fonts.
5. PROMINENT CONTACT FOOTER & LOGO: Place the business logo cleanly as a prestige seal in an upper corner. Place the contact number "${finalContactNumber || ''}" cleanly and prominently in a high-contrast footer strip at the bottom margin.
6. AUTHENTIC HUMAN PERSONA: ${activePersona.promptDirective} Regional ethnicity must match the business location. Real skin pores and candid expressions of joy, strictly no plastic AI faces.
7. OUTPUT FORMAT: Output ONLY a single cohesive, highly detailed, descriptive paragraph containing the exact scene description, layouts, styling, text overlays, and details for the image model. Do NOT include any intro, conversational text, or markdown code blocks.`;

        // Primary: DeepSeek v4-flash for Master Designer prompt synthesis
        try {
          logToFile("Calling DeepSeek v4-flash Master Designer to compose optimized image generation prompt...");
          const dsResult = await callDeepSeekWithUsage(designComposerPrompt);
          if (dsResult.text && dsResult.text.trim()) {
            designerPrompt = dsResult.text.trim();
            logToFile(`Master Designer prompt composed via DeepSeek v4-flash: ${designerPrompt.slice(0, 100)}...`);
          }
        } catch (dsErr: any) {
          logToFile(`DeepSeek Master Designer prompt generation notice: ${dsErr.message}. Falling back to Gemini...`);
        }

        // Fallback: Gemini multimodal if DeepSeek was unavailable or failed
        if (!designerPrompt) {
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
          logToFile(`Master Designer generated prompt via Gemini fallback: ${designerPrompt}`);
        }
      } catch (err: any) {
        logToFile(`Error in Master Designer LLM flow: ${err.message}`);
      }
    }

    const referencePreamble = buildReferenceCreativePreamble(validPropImages.length, validLogo.length > 0, hasReference);

    let finalImagePrompt = "";
    if (isEdit) {
      finalImagePrompt = `Modify the input image according to these custom instructions: "${userInstructions}". 
Make the edits clean, professional, and blend seamlessly with the original content. Do NOT add any messy or gibberish text overlays unless explicitly requested. Keep the visual theme intact while applying the edits.`;
    } else if (hasReference && designerPrompt) {
      finalImagePrompt = `${referencePreamble}${designerPrompt}`;
    } else if (hasReference) {
      const promptParts = [
          referencePreamble,
          `Create a clean, ultra-premium, agency-level ad creative design using the Graphic Design Blueprint below.`,
          `CRITICAL QUALITY DIRECTIVES (NO CHEAP CANVA OR VECTOR GRAPHICS):`,
          `- PROHIBITION ON OVAL MASKS & CHEAP GRAPHICS: Render the property visual as full-bleed commercial photography or a clean rectangular architectural frame. ABSOLUTELY NEVER enclose the image inside an oval mask, circular cut-out, or heavy white border frame.`,
          `- NO 3D GOLD EMBOSSED FONTS OR DOTTED ICON LINES: Typography must be modern, flat, clean, and crisp (minimalist geometric sans-serif or elegant high-contrast serif). Avoid fake 3D gold bevel gradients or lines of circular clip-art icons connected by dotted lines across the header.`,
          `- SEAMLESS NATURAL INTEGRATION: Human subjects and property visuals must be seamlessly integrated into natural photorealistic scene lighting, never floating over graphic shapes.`,
          effectiveIsBrandOnly
            ? `CRITICAL RULE FOR HERO SUBJECT: No specific product is selected. Focus on high-impact visual commercial imagery representing ${businessName || 'the business'} matching the user's custom instructions.`
            : `CRITICAL RULE FOR HERO SUBJECT: The building, product, or property MUST come 100% strictly from the provided input property photos (or property description). Do NOT invent or copy any building/structure. Place the user's property inside the design layout specified below.`,
          excludeHousePhoto 
            ? `STRICT NEGATIVE DIRECTIVE: Do NOT render any house, kothi, villa, or building exterior image. Focus on abstract luxury backgrounds, minimalist typography, location map graphics, or lifestyle close-ups.` 
            : (effectiveIsBrandOnly ? '' : `Use the user's actual property photos as the central visual hero asset of the canvas.`),
          propertyTitle ? `Subject: ${propertyTitle}` : '',
          propertyDescription ? `Details/Description: ${propertyDescription}` : '',
          (businessName && !excludeBusinessInfo) ? `Business Name: ${businessName}` : '',
          (validLogo.length > 0 && !excludeLogo) ? `Include the provided business logo cleanly. Integrate the brand logo seamlessly with the design and background. Do NOT place it inside a raw, unblended black or white box/circle; blend its background shape smoothly into the background sky/theme.` : '',
          (finalContactNumber && !excludeBusinessInfo) ? `Mandatory Contact Info: Display the contact number "${finalContactNumber}" cleanly and prominently according to the layout blueprint.` : '',
          `Do NOT add any messy or gibberish text overlays on the image unless explicitly requested. Keep the image clean, professional, and visually focused.`,
          `IMPORTANT NEGATIVE CONSTRAINT: Do NOT copy any text, barcodes, QR codes, website URLs, or license/RERA numbers (such as RERA registration numbers) directly from the reference image. If the reference creative contains a QR code, license number, or specific website address, omit them entirely from the final generated image.`,
          (!userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i)) ? `Include close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, highly attractive, photorealistic humans (e.g. a happy family, an elegant couple, or a professional individual, depending on the product context) in the foreground showing happy, positive, and smiling facial expressions of joy. Skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) looking completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look. The ethnicity of the humans must match the geographical region of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).` : '',
          styleDescription ? `=== EXTRACTED GRAPHIC DESIGN BLUEPRINT (APPLY THIS STYLE FRAMEWORK TO THE USER'S PRODUCT) ===\n${styleDescription}` : '',
          userInstructions ? `Custom Instructions: ${userInstructions}` : ''
      ].filter(Boolean);
      finalImagePrompt = promptParts.join("\n");
    } else {
      const disambiguationPreamble = buildImageDisambiguationPreamble(validPropImages.length, validLogo.length > 0);
      const fallbackPrompt = [
          `Create a highly detailed, premium, and professional ad creative design.`,
          effectiveIsBrandOnly ? `Subject: Brand Campaign for ${businessName || 'Business'}` : (propertyTitle ? `Subject: ${propertyTitle}` : ''),
          effectiveIsBrandOnly ? `Business Info & Context: ${profile?.business_info || profile?.mission_statement || propertyDescription || ''}` : (propertyDescription ? `Details/Description: ${propertyDescription}` : ''),
          (businessName && !excludeBusinessInfo) ? `Business Name: ${businessName}` : '',
          (validLogo.length > 0 && !excludeLogo) ? `Include the provided business logo cleanly. Integrate the brand logo seamlessly with the design and background. Do NOT place it inside a raw, unblended black or white box/circle; blend its background shape smoothly into the background sky/theme.` : '',
          (finalContactNumber && !excludeBusinessInfo) ? `Mandatory Contact Info: Include the contact number "${finalContactNumber}" clearly and elegantly in a banner or footer at the bottom of the poster (e.g. "Call: ${finalContactNumber}").` : '',
          effectiveIsBrandOnly ? `Create a brand-focused commercial visual emphasizing ${businessName || 'the business'}, industry prestige, and the user's custom instructions.` : (excludeHousePhoto ? `STRICT NEGATIVE DIRECTIVE: Do NOT render any house, kothi, villa, or building exterior image. Focus on abstract luxury backgrounds, minimalist typography, location map graphics, or lifestyle close-ups.` : `You are provided with multiple inventory/product photos. Carefully analyze all input photos, identify the most relevant/aesthetically appealing ones matching the subject, and use only those relevant images as the visual base for the design (ignore any unrelated images).`),
          `Ensure the overall composition is highly professional, balanced, featuring cinematic warm lighting, detailed textures, and a luxury editorial aesthetic.`,
          (!userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i)) ? `Include close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, highly attractive, photorealistic humans (e.g. a happy family, an elegant couple, or a professional individual, depending on the product context) in the foreground showing happy, positive, and smiling facial expressions of joy. Skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) looking completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look. The ethnicity of the humans must match the geographical region of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).` : '',
          !excludeBusinessInfo ? (effectiveIsBrandOnly ? `If text is not excluded, make the creative highly informative: include a bold, clean benefit-driven headline based on the brand and custom instructions, and display the brand logo and contact details clearly.` : `If text is not excluded, make the creative highly informative: include a bold, clean benefit-driven headline (based on ${propertyTitle || 'the product'}), a sub-headline highlighting key details, BHK specifications, and prominently including and highlighting the property's city or location name (based on ${propertyDescription || 'the product description'}, but only if explicitly mentioned; do NOT hallucinate or invent a location if it is not in the text, in which case omit it or keep it generic like "In a Prime Location"), and display the brand logo and contact details clearly.`) : '',
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
        logToFile(`FAILOVER TRIGGERED: ${primaryError.message}. Switching to text-to-image / nano-banana-2...`);
        
        // FAILOVER: Fall back to text-to-image if image fetch failed on primary model
        const failoverPayload = {
            model: "gpt-image-2-text-to-image",
            input: {
                prompt: finalImagePrompt,
                aspect_ratio: aspectRatio,
                resolution: "1K",
                output_format: "png"
            }
        };
        logToFile(`KIE PAYLOAD (Attempt 2 Failover): ${JSON.stringify(failoverPayload, null, 2)}`);
        kieResult = await createKieTask(failoverPayload);
    }

    if (!kieResult || kieResult.error || !kieResult.taskId) {
      const finalError = kieResult?.error || "Final attempt failed";
      logToFile(`Kie AI Task failed permanently: ${finalError}`);
      
      // REFUND: Give back the credit and limit
      await refundLimit(targetUserId, 'images');
      await addCredits(supabaseAdmin, targetUserId, 10, 'ai_generation', `Refund: AI Image Generation failed - ${propertyTitle || 'Ad'}`);
      creditDeductedSuccess = false;
      
      throw new Error(`Design server error: ${finalError}`);
    }
    
    logToFile(`✅ SUCCESS: KIE TASK CREATED: ${kieResult.taskId}`);

    // 2. Try the Caption Generation Safely
    let finalCaption = "";
    const effectiveContact = contactNumber || profile?.contact_number || 'DM for details!';

    const captionPrompt = effectiveIsBrandOnly ? `You are a world-class Direct Response Copywriter with 20+ years of experience.
Write a high-converting Meta ad caption and copy for our business: "${businessName || 'Our Business'}".

BUSINESS INFORMATION & PROFILE CONTEXT:
"${profile?.business_info || profile?.mission_statement || propertyDescription || 'Leading professional business committed to exceptional quality and service.'}"
${profile?.mission_statement ? `MISSION: "${profile.mission_statement}"` : ''}
${userInstructions ? `CUSTOM CAMPAIGN INSTRUCTIONS / HOOK:\n"${userInstructions}"` : ''}

CONTACT / CTA: "${effectiveContact}".

CRITICAL INSTRUCTION:
No specific product is selected for this ad. You MUST write the ad copy and description highlighting the business services, authority, credibility, and value proposition using ONLY the Business Information and Campaign Instructions provided above.

RULES: 
- Use Alex Hormozi frameworks (Hook, Retain, Reward). 
- Keep the length MODERATE (max 400 characters). Avoid long, exhausting paragraphs.
- Use bullet points and emojis. 
- No bold markdown (**). 
- DO NOT use any hashtags (#).
- At the very end of the caption, add 5-6 important keywords relevant to the business inside a single bracket, e.g., [Keyword1, Keyword2, Keyword3...]
- Make it stop the scroll.
- Output ONLY the caption, NO extra text.`
    : `You are a world-class Direct Response Copywriter with 20+ years of experience. 
Write a high-converting Meta ad caption for: "${propertyTitle}". 
Context: "${propertyDescription}". 
Business: "${businessName}". 
Contact: "${effectiveContact}". 

RULES: 
- Use Alex Hormozi frameworks (Hook, Retain, Reward). 
- Keep the length MODERATE (max 400 characters). Avoid long, exhausting paragraphs.
- Use bullet points and emojis. 
- No bold markdown (**). 
- DO NOT use any hashtags (#).
- At the very end of the caption, add 5-6 important keywords relevant to the business/property inside a single bracket, e.g., [Keyword1, Keyword2, Keyword3...]
- Make it stop the scroll.
- Output ONLY the caption, NO extra text.`;

    try {
        logToFile("Generating high-converting Meta ad caption via DeepSeek v4-flash...");
        const dsCaption = await callDeepSeekWithUsage(captionPrompt);
        if (dsCaption.text && dsCaption.text.trim()) {
            finalCaption = dsCaption.text.trim();
            logToFile("Caption generated successfully via DeepSeek v4-flash.");
        }
    } catch (dsCapErr: any) {
        logToFile(`DeepSeek caption notice: ${dsCapErr.message}. Falling back to Gemini...`);
    }

    if (!finalCaption) {
        try {
            const { text } = await generateText({
              model: google('gemini-3.5-flash'),
              prompt: captionPrompt,
            });
            finalCaption = text;
            logToFile("Caption generated successfully via Gemini fallback.");
        } catch (chatError: any) {
            logToFile(`Caption generation failed: ${chatError.message}. Trying preview model...`);
            try {
                const fallbackPrompt = effectiveIsBrandOnly
                    ? `Write a high-converting Meta ad copy for business: "${businessName}". Business info: "${profile?.business_info || profile?.mission_statement || ''}". Instructions: "${userInstructions || ''}". Contact: "${effectiveContact}" without bolding and without hashtags.`
                    : `Write a high-converting Meta ad caption for: "${propertyTitle}". Context: "${propertyDescription}". Business: "${businessName}". Contact: "${effectiveContact}" without bolding and without hashtags.`;

                const { text } = await generateText({
                  model: google('gemini-3-flash-preview'),
                  prompt: fallbackPrompt,
                });
                finalCaption = text;
            } catch {
                finalCaption = effectiveIsBrandOnly
                    ? `Discover exceptional services with ${businessName || 'us'}! Contact ${effectiveContact} for more details.`
                    : "Check out this premium property! DM for more details.";
            }
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
        await addCredits(supabaseAdmin, targetUserId, 10, 'ai_generation', `Refund: AI Image Generation failed`);
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