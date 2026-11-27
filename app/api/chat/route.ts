import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createKieTask, callDeepSeekWithUsage } from '@/utils/external-apis';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google'; 
import { checkLimitAndIncrement, refundLimit, checkStorageLimit } from '@/utils/subscription-server';
import { buildImageSystemPrompt, buildReferenceCreativePreamble, buildImageDisambiguationPreamble, detectIndustry, getRandomVisualArchetype, getRandomHumanPersona } from '@/utils/image-prompt-master';
import { MEDIA_MODELS, imageModelFor, modelAlias } from '@/lib/agent/media-models';
import { DEFAULT_IMAGE_RATIO, providerImageRequest } from '@/lib/agent/media-ratios';
import { brandKitFor } from '@/lib/agent/media/brand-kit';
import { chooseReferenceCreative, describeReferenceChoice, isOwnReferenceCreative, isSuperAdminReference } from '@/lib/automation/reference-selection';

export const maxDuration = 120; // Allow 2 minutes for AI prompt synthesis & image task dispatch

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

    const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id, selected_templates').eq('id', user.id).single()
    targetUserId = (currentProfile?.role === 'agent' && (currentProfile?.agency_id || currentProfile?.parent_id)) 
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
        propertyPrice,
        propertyLocation,
        contactNumber, 
        logoUrl,
        propImages, 
        templateUrl, 
        aspectRatio = DEFAULT_IMAGE_RATIO,
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

    // Fetch user profile for business context
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, business_info, mission_statement, custom_prompt, brand_color, contact_number')
      .eq('id', targetUserId)
      .single() as any;

    const businessName = profile?.business_name || '';
    const profileCustomPrompt = profile?.custom_prompt || '';

    // Extract clean business info and check for saved industry in JSON
    let cleanBusinessInfo = '';
    let cachedIndustry: string | null = null;
    let bInfoObj: any = null;

    if (profile?.business_info) {
      if (typeof profile.business_info === 'object') {
        bInfoObj = profile.business_info;
        cleanBusinessInfo = profile.business_info._raw_text || profile.business_info.bio || profile.business_info.description || '';
        cachedIndustry = profile.business_info.industry || null;
      } else if (typeof profile.business_info === 'string') {
        const trimmed = profile.business_info.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            bInfoObj = JSON.parse(trimmed);
            cleanBusinessInfo = bInfoObj._raw_text || bInfoObj.bio || bInfoObj.description || trimmed;
            cachedIndustry = bInfoObj.industry || null;
          } catch {
            cleanBusinessInfo = trimmed;
          }
        } else {
          cleanBusinessInfo = trimmed;
        }
      }
    }

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
    let industry = cachedIndustry || null;
    if (!industry) {
        logToFile("Industry not set for user. Auto-detecting...");
        industry = await detectIndustry(
            profile?.business_name || '',
            cleanBusinessInfo || profile?.business_info || '',
            profile?.mission_statement || ''
        );
        // Persist to business_info JSON so we don't re-detect on every request
        try {
          const updatedBInfo = bInfoObj || {};
          updatedBInfo.industry = industry;
          await supabaseAdmin
              .from('profiles')
              .update({ business_info: JSON.stringify(updatedBInfo) })
              .eq('id', targetUserId);
          logToFile(`Industry auto-detected and saved to business_info: ${industry}`);
        } catch (saveErr: any) {
          logToFile(`Could not persist industry to business_info: ${saveErr.message}`);
        }
    }

    // --- BUILD MASTER VISUAL PRODUCTION RULES ---
    const visualProductionRules = buildImageSystemPrompt(industry, isOrganicOverride);

    /**
     * THE ACCOUNT'S OWN BRAND, AT GENERATION TIME.
     *
     * This path never read the brand kit: not the palette the owner sets in Profile → Brand Kit, not the
     * standing creative directives on the playbook. A live film academy whose enforced rule is "use ONLY
     * these colours: scarlet #E13C3C, charcoal #1F1F1F, wisteria #92ABE1" received a black-and-champagne
     * gold poster, because nothing in the prompt mentioned the brand at all.
     *
     * The lock is stated LAST and as non-negotiable, because every branch below builds its own styling
     * instructions (including one that hardcoded "champagne gold and ivory"); a brand rule that can be
     * outvoted by a template sentence is not a brand rule.
     */
    const brand = await brandKitFor(supabaseAdmin, targetUserId);
    const industryLock = industry
      ? `- Target industry: ${industry}. Use this industry's subjects, props, vocabulary and proof points. NEVER use another industry's vocabulary: no property, plot, listing, inventory, "site visit", "book a site visit", possession, RERA or EMI language unless this business actually sells property.`
      : '';
    const brandLockBlock = [
      brand.brandColor
        ? `- Primary brand colour: ${brand.brandColor}. Use it as the dominant accent, with neutrals only for everything else. Do not introduce colours from another brand.`
        : '',
      brand.rules ? `- Standing brand rules (obey exactly):\n${brand.rules}` : '',
      industryLock,
    ].filter(Boolean);
    const brandLock = brandLockBlock.length
      ? `\n\nBRAND & INDUSTRY LOCK (non-negotiable — overrides any style suggestion above):\n${brandLockBlock.join('\n')}`
      : '';
    logToFile(
      `[CHAT ROUTE] Brand lock: ${brandLockBlock.length} rule(s) from ${brand.sources.join(', ') || 'nothing on file'}`
    );

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

    let effectiveTemplateUrl = templateUrl;

    /**
     * THE DESIGN COMES FROM THIS ACCOUNT OR FROM NOWHERE.
     *
     * The operator's rule: "never use the super admin designs for real estate for any account, use the
     * users' own ref if uploaded, it's own brand kit if provided otherwise the ai can create a prompt on
     * it's own based on the data it has access to."
     *
     * So a `templateUrl` is honoured ONLY when it is one of the account's own uploads. A built-in used to
     * be honoured here because the caller passed one — and the caller (the Creation tab) was itself
     * choosing at random from the 35 built-in Dubai property designs, which is how a film academy's poster
     * came out carrying "PRIVATE POOL OASIS". Refusing it at this door means an old cached tab, a stale
     * `selected_templates` value, or a future caller cannot re-introduce it either.
     */
    let suppliedReferenceRejected: string | null = null;
    if (effectiveTemplateUrl && isSuperAdminReference(effectiveTemplateUrl)) {
      suppliedReferenceRejected = 'it is one of the built-in (super admin) real-estate designs';
      effectiveTemplateUrl = null;
    } else if (effectiveTemplateUrl) {
      const own = await isOwnReferenceCreative(supabaseAdmin, targetUserId, effectiveTemplateUrl);
      if (!own) {
        suppliedReferenceRejected = 'it is not one of this account\u2019s own uploads';
        effectiveTemplateUrl = null;
      }
    }

    if (!effectiveTemplateUrl && !isEdit) {
      const selectionSeed =
        (typeof propertyTitle === 'string' && propertyTitle.trim() ? propertyTitle.trim() : '') ||
        (typeof userInstructions === 'string' ? userInstructions.slice(0, 80) : '') ||
        targetUserId;

      const choice = await chooseReferenceCreative(supabaseAdmin, targetUserId, {
        preferCategory: normalizedCategory,
        seed: selectionSeed,
      });
      if (choice.url) {
        effectiveTemplateUrl = choice.url;
        logToFile(`[CHAT ROUTE] Reference: ${describeReferenceChoice(choice)} (${choice.url})`);
      } else {
        effectiveTemplateUrl = null;
        logToFile(
          '[CHAT ROUTE] Reference: ' +
            describeReferenceChoice(choice) +
            (suppliedReferenceRejected
              ? ` (a supplied reference was refused: ${suppliedReferenceRejected}).`
              : '.') +
            ' The creative is composed from the brief, this account\u2019s own data and its brand kit.'
        );
      }
    }
    if (!effectiveTemplateUrl && isEdit && suppliedReferenceRejected) {
      logToFile(`[CHAT ROUTE] Edit ignored a supplied reference: ${suppliedReferenceRejected}.`);
    }

    const validTemplate = (effectiveTemplateUrl && !excludedImages.includes(effectiveTemplateUrl) && typeof effectiveTemplateUrl === 'string' && effectiveTemplateUrl.startsWith('http')) 
      ? [sanitizeImageUrl(effectiveTemplateUrl)] 
      : [];
    const hasReference = validTemplate.length > 0;

    // Build allInputImages ensuring the reference template image is passed to the image-to-image model
    let allInputImages: string[] = [];
    const templateRefUrl = hasReference ? validTemplate[0] : null;
    const singleLogo = (validLogo.length > 0 && !excludeLogo && !validLogo[0].toLowerCase().includes('nobogent') && !validLogo[0].endsWith('/logo.png')) ? validLogo[0] : null;

    if (hasReference && templateRefUrl) {
      if (validPropImages.length > 0) {
        // IMAGE 1: User's property photo
        // IMAGE 2: Reference template ad creative
        // IMAGE 3: Business logo (if present)
        allInputImages.push(validPropImages[0]);
        allInputImages.push(templateRefUrl);
        if (singleLogo && !allInputImages.includes(singleLogo)) {
          allInputImages.push(singleLogo);
        }
      } else {
        // No property photo (brand campaign or text-only prompt)
        // IMAGE 1: Reference template ad creative
        // IMAGE 2: Business logo (if present)
        allInputImages.push(templateRefUrl);
        if (singleLogo && !allInputImages.includes(singleLogo)) {
          allInputImages.push(singleLogo);
        }
      }
    } else {
      // No reference template selected
      allInputImages = [...validPropImages, ...validLogo].slice(0, 16);
    }

    // Multimodal Visual Style Analysis using Gemini if a reference ad image is selected
    let styleDescription = "";
    if (hasReference && validTemplate[0]) {
      try {
        const refUrl = validTemplate[0];
        logToFile(`Fetching reference creative for style analysis: ${refUrl}`);
        const refRes = await fetch(refUrl);
        if (refRes.ok) {
          const refBuffer = Buffer.from(await refRes.arrayBuffer());
          const refMimeType = refRes.headers.get('content-type') || 'image/jpeg';
          
          logToFile("Calling Gemini to analyze reference creative style...");
          const styleAnalysisInstruction = `You are a Master Creative Director & Visual System Architect. Analyze this reference luxury advertising creative and deconstruct it into a universal "Graphic Design System Blueprint":
1. GRAPHIC CONTAINER & SIGNATURE FRAMING GEOMETRY: Describe the exact layout structure and geometric container shape holding or framing the hero image (e.g. custom icon silhouette, floating card, geometric mask, split container, arch, or full-bleed grid). Explicitly instruct how the hero photo should be framed.
2. COLOR PALETTE & LIGHTING MOOD: Primary background colors, accent colors, translucent pill gradients, contrast ratio, and ambient lighting mood.
3. TYPOGRAPHY SYSTEM: Font pairing styles (e.g., high-fashion serif header like Bodoni/Cormorant or sleek geometric sans-serif like Trajan/Futura), text and accent tones, wide kerning/letter-spacing, and text alignment. Describe the SHAPE of the type system only — never a fixed colour: the colours come from this business's brand kit, which the brand lock enforces.${brand.brandColor ? ` This account's brand colour is ${brand.brandColor}.` : ''}
4. DECORATIVE BADGES & ICON PLACEMENT: Placement zones for feature pills, logo stamps, starting price ribbons, CTA banners, and decorative badge elements.
Output a dense single paragraph describing this exact graphic design system so an AI image model can apply this layout framework to any new product.`;

          let geminiResult;
          try {
            geminiResult = await generateText({
              model: google('gemini-2.5-flash'),
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
            logToFile(`Failed with gemini-2.5-flash: ${(geminiErr1 as Error).message}. Retrying with gemini-3-flash-preview...`);
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
          logToFile(`Successfully extracted style description from reference creative: ${styleDescription.slice(0, 100)}...`);
        } else {
          logToFile(`Failed to fetch reference creative file: Status ${refRes.status}`);
        }
      } catch (err: any) {
        logToFile(`Error extracting style from reference: ${err.message}`);
      }
    }

    // Call Master Designer LLM if we are NOT in edit mode and NO reference template is selected
    const finalContactNumber = contactNumber || profile?.contact_number || '';
    let designerPrompt = "";
    if (!isEdit && !hasReference) {
      try {
        logToFile("Calling Master Designer to compose optimized image generation prompt...");
        
        // Dynamically compute unique visual archetype & human persona for maximum generation variety
        const requestSeed = `${Date.now()}_${Math.random()}_${propertyTitle || ''}_${userInstructions || ''}`;
        const activeArchetype = getRandomVisualArchetype(propertyTitle, propertyDescription, requestSeed);
        let activePersona = getRandomHumanPersona(propertyTitle, propertyDescription, userInstructions, requestSeed, industry);
        
        // Check for explicit user exclusion of people
        const userExcludedHumans = userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i);
        if (userExcludedHumans) {
          activePersona = {
            id: 'no_humans',
            name: 'Pure Commercial Product & Graphic Focus (No Humans)',
            hasHumans: false,
            promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans or people in this creative image. Focus 100% of the visual spotlight on the hero subject, clean lighting, and high-impact graphic typography overlays.'
          };
        }

        logToFile(`DYNAMIC VARIATION GENERATED | HasReference: ${hasReference} | Archetype: ${activeArchetype.name} | Persona: ${activePersona.name}`);

        const styleGuidanceSection = `MANDATORY CREATIVE DESIGN BLUEPRINT (FOR VARIETY & UNIQUENESS):
- ${activeArchetype.promptInstructions}
- LIGHTING & ATMOSPHERE: ${activeArchetype.lighting}.
- VISUAL COMPOSITION: ${activeArchetype.composition}.
- TYPOGRAPHY & OVERLAYS: ${activeArchetype.typography}.`;

        const designComposerPrompt = `You are an elite Master Advertising Designer and Creative Director with 20+ years of direct-response advertising experience crafting multi-million-dollar high-converting Meta, Instagram, and social ad campaigns across all industries.
Your mission is to write a highly detailed, conversion-optimized image generation prompt that will be sent to the image model to produce an ultra-photorealistic, high-converting commercial ad poster.

Here is the information provided by the user:
- Campaign Type: ${effectiveIsBrandOnly ? 'Brand & Service Campaign (No Specific Product Selected)' : 'Product / Offering Campaign'}
- Product/Service Title: ${effectiveIsBrandOnly ? 'N/A (Brand / Service Ad)' : (propertyTitle || 'N/A')}
- Product/Service Description: ${effectiveIsBrandOnly ? 'N/A' : (propertyDescription || 'N/A')}
${propertyPrice ? `- Starting Price / Price: ${propertyPrice}` : ''}
${propertyLocation ? `- Location: ${propertyLocation}` : ''}
- Business Name: ${businessName || 'N/A'}
- Brand/Business Info: ${cleanBusinessInfo || profile?.mission_statement || 'N/A'}
- Target Industry: ${industry || 'N/A'}
- Contact Number / Call to Action: ${finalContactNumber || 'N/A'}
- Custom User Instructions: ${userInstructions || 'None'}
${brandLock}

${styleGuidanceSection}

Your goal is to synthesize this information and output an extremely detailed, descriptive visual prompt for the image generation model.
Follow these 20-year direct-response advertising master rules to maximize click-throughs and conversion:
1. SCROLL-STOPPING COMMERCIAL PHOTOGRAPHY: The creative must look like authentic live-action commercial photography captured by a top advertising photographer. Never make it look like a 3D render, cartoon, architectural blueprint, or CGI illustration. Bright, airy, commercial natural morning or golden-hour lighting with crisp shadows and believable textures.
${effectiveIsBrandOnly ? `2. BRAND & CAMPAIGN VISUAL SPOTLIGHT: No specific product is selected. Focus the visual canvas on high-impact commercial branding, aspirational imagery, and clean graphic typography representing ${businessName || 'the brand'} in the ${industry || 'commercial'} sector according to the custom user instructions.` : `2. 60-70% HERO FOCUS: The real product or subject must occupy 60-70% of the canvas as the undisputed hero. ${excludeHousePhoto ? 'CRITICAL EXCLUSION: Do NOT describe or include any exterior architectural house, villa, or building photos.' : 'Keep the generated visuals faithful to the real subject in the input.'}`}
3. HIGH-CONVERTING PERFORMANCE AD POSTER ARCHITECTURE (META / INSTAGRAM / LINKEDIN):
   - TOP BANNER & LOCATION TAG: Frosted category/offer pill tag (e.g. "OFFICIAL IMMIGRATION PATHWAY", "EXCLUSIVE PRE-LAUNCH", "AI REVENUE ENGINE", "PREMIUM CRAFTSMANSHIP") placed cleanly near top margin. MANDATORY LOCATION TAG: If location or sector is mentioned (e.g. "Downtown Dubai", "Sector 82 Mohali"), feature a sleek location pill (e.g. "📍 DOWNTOWN DUBAI").
   - HERO VISUAL (55-65% CANVAS): Aspirational, photorealistic hero visual featuring the product, service, or customer in an authentic real-world environment with tangible proof artifacts (passports, approval letters, certificates, product packaging, keys, or modern dashboard interfaces).
   - BENEFIT HOOK HEADLINE: Exactly ONE dominant, high-contrast outcome-driven headline (e.g., "Live & Work in Canada in 2026", "Own Luxury for 1% Monthly", "Automate 80% of Support") that instantly hooks the target customer.
   - MANDATORY PRICE BADGE: Since we sell to businesses and high-intent buyers, if price, starting price, or payment terms are provided (e.g. "Starting at ₹1.2 Cr", "From AED 1,200,000", "1% Monthly Payment Plan", "$49/mo"), you MUST prominently display a luxury, high-contrast price badge or ribbon pill (e.g. "STARTING AT AED 1.2M", "FROM ₹1.2 CR*") on the creative!
   - TRUST PROOF BADGES / VALUE PILLS: Exactly 2 to 3 sleek, modern frosted glass or flat solid contrast chips/badges highlighting key credibility and risk-reversal points. Use proof points this business can truthfully claim (e.g. "Licensed & Certified", "98% Success Rate", "Zero Hidden Fees", "Free Consultation") — the examples in this brief come from several industries, so translate them into this business's own vocabulary rather than copying property-sector ones (never "RERA", "possession", "site visit" or "explore inventory" unless the business sells property).
   - FOOTER CTA BAR: Crisp high-contrast bottom action bar with a clear call-to-action button that fits THIS business ("Book Free Consultation", "Claim Offer", "Apply Now", "Get Free Assessment") alongside the contact details "${finalContactNumber || ''}".
4. STRICT BAN ON AMATEUR GIMMICKS:
   - ABSOLUTELY NEVER generate floating 3D glass cubes, floating green bars, floating holographic stock charts, or neon gaming button glows. All badges and chips must be modern, minimal, flat or frosted glass executive-grade UI elements.
5. PRISTINE ANTI-SMUDGE BRAND LOGO & TYPOGRAPHY:
   - If brand logo is included, position it cleanly in an upper corner as a razor-sharp, crisp vector mark. STRICT DIRECTIVE: Do NOT smudge, melt, blur, distort, or warp the logo icon or lettering.
   - Modern, authoritative grotesque sans-serif (Neue Haas Grotesk, Inter) or elegant editorial typography. Crisp white or obsidian dark letters with razor-sharp legibility.
6. AUTHENTIC HUMAN PERSONA: ${activePersona.promptDirective} Regional ethnicity must match the business location. Real skin pores and candid expressions of joy, strictly no plastic AI faces.
7. OUTPUT FORMAT: Output ONLY a single cohesive, highly detailed, descriptive paragraph containing the exact scene description, layouts, styling, text overlays, and details for the image model. Do NOT include any intro, conversational text, or markdown code blocks.`;

        // Primary: DeepSeek v4-flash for Master Designer prompt synthesis (with 7s timeout fallback)
        try {
          logToFile("Calling DeepSeek v4-flash Master Designer to compose optimized image generation prompt...");
          const dsResult = await callDeepSeekWithUsage(designComposerPrompt, { timeoutMs: 7000 });
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

          try {
            const { text } = await generateText({
              model: google('gemini-2.5-flash'),
              messages: [
                {
                  role: 'user',
                  content: messagesContent
                }
              ]
            });
            designerPrompt = text.trim();
            logToFile(`Master Designer prompt composed via Gemini 2.5 Flash: ${designerPrompt.slice(0, 100)}...`);
          } catch (geminiErr: any) {
            logToFile(`Gemini Master Designer failed: ${geminiErr.message}. Trying preview model...`);
            const { text } = await generateText({
              model: google('gemini-3-flash-preview'),
              messages: [
                {
                  role: 'user',
                  content: messagesContent
                }
              ]
            });
            designerPrompt = text.trim();
          }
        }
      } catch (err: any) {
        logToFile(`Error in Master Designer LLM flow: ${err.message}`);
      }
    }

    let finalImagePrompt = "";
    if (isEdit) {
      finalImagePrompt = `Modify the input image according to these custom instructions: "${userInstructions}". 
Make the edits clean, professional, and blend seamlessly with the original content. Do NOT add any messy or gibberish text overlays unless explicitly requested. Keep the visual theme intact while applying the edits.`;
    } else if (hasReference) {
      // A reference with no template metadata is the account's OWN upload: no borrowed name, no borrowed
      // badge, and no real-estate vocabulary ("Ultra Luxury", "Waterfront") in the prompt.
      // Every reference that reaches this point is the account's OWN upload, which carries no template
      // metadata — so there is no borrowed name, category or badge to inherit. These three lines are the
      // neutral fallbacks, and they name this business's own industry rather than a villa development's.
      const tmplName = "the account's own reference creative";
      const tmplCat = 'this business\u2019s own branding';
      const tmplBadge = `${industry ? industry.toUpperCase() : 'PREMIUM'} OFFER`;
      const effectiveAspect = aspectRatio || DEFAULT_IMAGE_RATIO;

      if (validPropImages.length > 0) {
        finalImagePrompt = `Create an ultra-premium, agency-level ad creative design in ${effectiveAspect} portrait ratio for Instagram/Meta ad campaigns using the Graphic Design Blueprint below.

=== EXTRACTED GRAPHIC DESIGN BLUEPRINT (APPLY THIS STYLE FRAMEWORK TO THE USER'S PRODUCT/PROPERTY) ===
${styleDescription || `Style: ${tmplName} (${tmplCat}). Signature layout with prominent starting price ribbon${propertyPrice ? ` (${propertyPrice})` : ''}, modern luxury typography, and urgent CTA ribbon.`}

CRITICAL DIRECTIVES:
- IMAGE 1 is the user's actual product/property photo: Place this photo as the central visual hero of the canvas inside the reference container framing geometry.
- IMAGE 2 is the reference creative design blueprint: Faithfully reproduce the exact container framing, layout geometry, typography style, color scheme, and badge placement of IMAGE 2 for the subject in IMAGE 1.
${effectiveIsBrandOnly ? `- Subject: Brand Campaign for ${businessName || 'Business'}` : (propertyTitle ? `- Subject: ${propertyTitle}` : '')}
${businessName && !excludeBusinessInfo ? `- Business / Company: ${businessName}` : ''}
${propertyPrice ? `- Starting Price / Price Badge: ${propertyPrice}` : ''}
${propertyLocation ? `- Location: ${propertyLocation}` : ''}
${propertyDescription ? `- Details & Amenities: ${propertyDescription}` : ''}
- Badge Tag: ${tmplBadge}
${finalContactNumber && !excludeBusinessInfo ? `- Contact / CTA: ${finalContactNumber}` : ''}
${userInstructions ? `- Additional Custom Instructions: ${userInstructions}` : ''}
- Typography: brand palette only (the brand lock at the end is binding), clean editorial headings, modern geometric sans-serif subtext, perfectly aligned without any messy or gibberish text.

CRITICAL BRANDING & URL RESTRICTIONS:
${businessName ? `- Business / Developer Name: "${businessName}". STRICTLY and ONLY display this exact company name.` : ''}
- STRICT PROHIBITION: Do NOT invent, hallucinate, synthesize, or display ANY website URL, domain name, or dot-com address anywhere on the canvas (specifically NEVER display "nobogent.com", or any .com, .in, .ae address). There is NO website URL.
- NEVER display "nobogent.com", "Nobogent", or any third-party agency name on the ad creative.
${singleLogo ? `- IMAGE 3 is the official business logo: Place it cleanly in an upper corner as a razor-sharp vector mark. Strictly do NOT smudge, melt, or distort it.` : (businessName ? `- If no brand logo is provided, display the Business name "${businessName}" in clean luxury typography at the top.` : '')}
- Do NOT copy any barcodes, QR codes, or random phone numbers from IMAGE 2.${finalContactNumber ? ` Only use the contact number: ${finalContactNumber}.` : ''}`;
      } else {
        finalImagePrompt = `Create an ultra-premium, agency-level ad creative design in ${effectiveAspect} portrait ratio for Instagram/Meta ad campaigns using the Graphic Design Blueprint below.

=== EXTRACTED GRAPHIC DESIGN BLUEPRINT (APPLY THIS STYLE FRAMEWORK) ===
${styleDescription || `Style: ${tmplName} (${tmplCat}). Signature layout with prominent starting price ribbon${propertyPrice ? ` (${propertyPrice})` : ''}, modern typography, and urgent CTA ribbon.`}

CRITICAL DIRECTIVES:
- IMAGE 1 is the reference creative design blueprint: Faithfully reproduce the exact container framing, layout geometry, typography style, color scheme, and badge placement of IMAGE 1 for the advertised offering.
${effectiveIsBrandOnly ? `- Subject: Brand Campaign for ${businessName || 'Business'}` : (propertyTitle ? `- Subject: ${propertyTitle}` : '')}
${businessName && !excludeBusinessInfo ? `- Business / Company: ${businessName}` : ''}
${propertyPrice ? `- Starting Price / Price Badge: ${propertyPrice}` : ''}
${propertyLocation ? `- Location: ${propertyLocation}` : ''}
${propertyDescription ? `- Details & Amenities: ${propertyDescription}` : ''}
- Badge Tag: ${tmplBadge}
${finalContactNumber && !excludeBusinessInfo ? `- Contact / CTA: ${finalContactNumber}` : ''}
${userInstructions ? `- Additional Custom Instructions: ${userInstructions}` : ''}
- Typography: brand palette only (the brand lock at the end is binding), clean editorial headings, modern geometric sans-serif subtext, perfectly aligned without any messy or gibberish text.

CRITICAL BRANDING & URL RESTRICTIONS:
${businessName ? `- Business / Developer Name: "${businessName}". STRICTLY and ONLY display this exact company name.` : ''}
- STRICT PROHIBITION: Do NOT invent, hallucinate, synthesize, or display ANY website URL, domain name, or dot-com address anywhere on the canvas (specifically NEVER display "nobogent.com", or any .com, .in, .ae address). There is NO website URL.
- NEVER display "nobogent.com", "Nobogent", or any third-party agency name on the ad creative.
${singleLogo ? `- IMAGE 2 is the official business logo: Place it cleanly in an upper corner as a razor-sharp vector mark. Strictly do NOT smudge, melt, or distort it.` : (businessName ? `- If no brand logo is provided, display the Business name "${businessName}" in clean luxury typography at the top.` : '')}
- Do NOT copy any barcodes, QR codes, or random phone numbers from IMAGE 1.${finalContactNumber ? ` Only use the contact number: ${finalContactNumber}.` : ''}`;
      }
    } else {
      const disambiguationPreamble = buildImageDisambiguationPreamble(validPropImages.length, validLogo.length > 0);
      const fallbackPrompt = [
          `Create a highly detailed, premium, high-converting performance marketing ad poster adhering to top-tier Meta / Instagram / LinkedIn direct-response advertising standards.`,
          `AD ARCHITECTURE:
- TOP: Clean category/offer pill tag and razor-sharp brand logo.
- HERO VISUAL (55-65% canvas): High-impact, photorealistic subject with authentic contextual proof artifacts.
- COPY: 1 bold outcome-driven benefit hook headline + 1 punchy subline.
- TRUST PROOF: 2 to 3 sleek modern frosted glass or flat contrast trust badges / value pills highlighting credibility, speed, or guarantees.
- BOTTOM CTA BAR: High-contrast action banner with clear CTA button and contact details.`,
          effectiveIsBrandOnly ? `Subject: Brand Campaign for ${businessName || 'Business'}` : (propertyTitle ? `Subject: ${propertyTitle}` : ''),
          effectiveIsBrandOnly ? `Business Info & Context: ${cleanBusinessInfo || profile?.mission_statement || propertyDescription || ''}` : (propertyDescription ? `Details/Description: ${propertyDescription}` : ''),
          (businessName && !excludeBusinessInfo) ? `Business Name: ${businessName}` : '',
          (validLogo.length > 0 && !excludeLogo) ? `Include the provided business logo cleanly in an upper corner as a razor-sharp vector mark. STRICT ANTI-SMUDGE DIRECTIVE: Do NOT smudge, melt, blur, distort, or warp the logo icon or font lettering.` : '',
          (finalContactNumber && !excludeBusinessInfo) ? `Mandatory Contact Info: Include the contact number "${finalContactNumber}" clearly and elegantly in a sleek, minimalist footer CTA bar at the bottom of the poster (e.g. "Call: ${finalContactNumber}").` : '',
          effectiveIsBrandOnly ? `Create a brand-focused commercial visual emphasizing ${businessName || 'the business'}, industry prestige, and the user's custom instructions.` : (excludeHousePhoto ? `STRICT NEGATIVE DIRECTIVE: Do NOT render any unwanted building or house exterior image. Focus on clean product showcases, minimalist typography, or lifestyle close-ups.` : `You are provided with multiple inventory/product photos. Carefully analyze all input photos, identify the most relevant/aesthetically appealing ones matching the subject, and use only those relevant images as the visual base for the design (ignore any unrelated images).`),
          `Ensure the overall composition is highly professional, balanced, featuring cinematic commercial lighting, authentic textures, and a luxury editorial aesthetic. Strictly avoid floating 3D glass cubes, fake stock chart lines, or circular gold ribbon stickers.`,
          (!userInstructions?.toLowerCase().match(/\b(no|exclude|without|dont|don't|remove|skip)\s+(people|humans|person|family|man|woman)\b/i)) ? `Include close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, highly attractive, photorealistic humans (e.g. a happy customer, team professional, or entrepreneur, depending on the product context) in the foreground showing happy, positive, and smiling facial expressions of joy. Skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) looking completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look. The ethnicity of the humans must match the geographical region of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).` : '',
          !excludeBusinessInfo ? (effectiveIsBrandOnly ? `Structure layout: (1) Category pill tag at top, (2) One bold benefit hook headline based on the brand, (3) 2-3 sleek modern trust badges/value pills, (4) Brand logo in an upper corner, and (5) High-contrast footer bar with CTA button and contact details.` : `Structure layout: (1) Category pill tag at top, (2) One bold benefit hook headline based on ${propertyTitle || 'the product'}, (3) 2-3 sleek modern trust badges or value pills highlighting key features/guarantees, (4) Brand logo in an upper corner, and (5) High-contrast footer bar with CTA button and contact details.`) : '',
          excludeBusinessInfo ? `Do NOT add any text overlays, slogans, contact numbers, writing, or labels on the image. Keep it purely as a clean, raw photograph.` : '',
          excludeLogo ? `Do NOT include any brand logo or watermark on the image.` : '',
          userInstructions ? `Custom Instructions: ${userInstructions}` : ''
      ].filter(Boolean).join("\n");
      finalImagePrompt = designerPrompt ? `${disambiguationPreamble}${designerPrompt}` : `${disambiguationPreamble}${fallbackPrompt}`;
    }

    // The brand lock is appended to every branch, not just the ones that happened to mention branding:
    // one branch hardcoded "champagne gold and ivory" and another said nothing at all.
    if (finalImagePrompt && brandLock) finalImagePrompt = `${finalImagePrompt}${brandLock}`;

    // Every model id below comes from lib/agent/media-models.ts — nothing is
    // inlined here. Two accept-only shims remain for already-cached bundles:
    //   'image-2.0'              an old name for "use the registry's image route"
    //   modelAlias(<fallback id>) the prefix-free form of the image fallback id
    // Neither one names a model that is not in the registry, and no client we
    // ship today sends either — they exist so an old tab keeps working.
    const nanoImageModel: string = MEDIA_MODELS.image.fallbacks[0];
    const nanoAlias = modelAlias(nanoImageModel);

    let kieModel: string = isDirect ? nanoImageModel : MEDIA_MODELS.image.id;
    let imageField = 'image_input'; // Default for text-to-image and nano

    // If we have ANY valid images (including logo), use Image-to-Image
    if (!isDirect && allInputImages.length > 0) {
        kieModel = MEDIA_MODELS.imageEdit.id;
        imageField = 'input_urls';
    }
    
    // Explicitly check for requested model names
    if (model === 'image-2.0' || model === MEDIA_MODELS.image.id) {
        kieModel = imageModelFor(allInputImages);
        if (allInputImages.length > 0) imageField = 'input_urls';
    } else if (model === 'nano' || model === nanoAlias) {
        kieModel = nanoImageModel;
        imageField = 'image_input';
    }

    // Every offered ratio goes to the provider as `auto`, with the ratio stated in words in the
    // prompt. The Flare image models carry no 4:5 enum, and the old "ask for 3:4 instead" was
    // never followed by a crop — so a 4:5 creative silently shipped at 3:4.
    // lib/agent/media-ratios.ts is the single owner of that rule.
    const framed = providerImageRequest(finalImagePrompt, aspectRatio);

    let payload: any = {
      "model": kieModel,
      "input": {
        "prompt": framed.prompt,
        "aspect_ratio": framed.aspectRatio,
        "resolution": "1K"
      }
    };
    
    // Assign the correct image field based on the model if we have images
    if (allInputImages.length > 0) {
        payload.input[imageField] = allInputImages;
    }
    
    // Only text-to-image supports output_format usually
    if (kieModel === MEDIA_MODELS.image.id) {
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
        logToFile(`FAILOVER TRIGGERED: ${primaryError.message}. Switching to the image text-to-image route (${MEDIA_MODELS.image.id})...`);
        
        // FAILOVER: Fall back to text-to-image if image fetch failed on primary model
        const failoverPayload = {
            model: MEDIA_MODELS.image.id,
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
        const dsCaption = await callDeepSeekWithUsage(captionPrompt, { timeoutMs: 5000 });
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
                /**
                 * THE LAST-RESORT CAPTION SAYS NOTHING ABOUT PROPERTY.
                 *
                 * It used to hardcode "Check out this premium property! DM for more details." — and a
                 * live film-academy creative carried exactly that line, because both caption models had
                 * failed and this string went out to a business that has never sold a property. A
                 * fallback is the copy most likely to be seen with the least thought behind it, so it
                 * has to be true for every industry: name the business, name the offering if there is
                 * one, give the contact.
                 */
                finalCaption = effectiveIsBrandOnly || !propertyTitle
                    ? `Discover what ${businessName || 'we'} can do for you. Call ${effectiveContact} to find out more.`
                    : `${propertyTitle} — ask ${businessName || 'us'} for the details. Call ${effectiveContact}.`;
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