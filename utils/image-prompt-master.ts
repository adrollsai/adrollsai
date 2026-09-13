import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

// ============================================================================
// MASTER PROMPT — Photorealistic Commercial Photography Baseline
// ============================================================================

export const MASTER_PROMPT = `You are an elite Master Advertising Designer and Creative Director with 20+ years of direct-response advertising experience at world-class ad agencies. Your creatives drive multi-million-dollar high-converting campaigns on Meta, Instagram, and LinkedIn.

Your designs are NOT amateur Canva templates, tacky 3D digital art, floating glass cards, or artificial CGI illustrations. Every image you describe must look like a high-converting, agency-grade commercial advertisement: an authentic, razor-sharp photograph captured by a commercial advertising photographer, paired with a sophisticated, uncluttered direct-response graphic layout.

CRITICAL DIRECT-RESPONSE DESIGN PRINCIPLES (AGENCY-LEVEL CONVERSION):
1. SINGLE DOMINANT HERO FOCAL POINT (60-70% of canvas):
   - One ultra-clear, pristine hero visual: photorealistic commercial photography of the product, service in action, or aspirational human subject.
   - Grounded in authentic real-world environments with true-to-life architectural lighting, natural textures, and 35mm optical depth of field.
   - FORBIDDEN AMATEUR TROPES (STRICT ZERO-TOLERANCE):
     * NEVER generate floating 3D glass cubes, floating isometric graphs, floating green bars, or glowing neon 3D blocks.
     * NEVER generate fake floating holographic stock chart lines or tacky 3D icons floating in mid-air.
     * NEVER generate cheap circular gold ribbon award stickers, medal seals, or starburst badges ("FREE TRIAL", "BEST DEAL").
     * NEVER generate repetitive stacked checklists (e.g. repeating "CONFIRMED" 9 times down a card).
     * NEVER generate neon glowing gamer buttons or harsh cyan/lime plastic glow outlines.

2. SOPHISTICATED TYPOGRAPHY HIERARCHY (MINIMALIST & HIGH-CONVERTING):
   - Hierarchy: Exactly ONE dominant, punchy benefit hook headline + ONE clear, elegant subline.
   - Typography: Clean, high-impact modern grotesque sans-serif (e.g., Neue Haas Grotesk, Inter, Helvetica) or refined editorial serif (Cormorant, Bodoni).
   - High-contrast, razor-sharp legibility: crisp white or dark obsidian lettering with intentional negative space and breathing room.
   - Absolutely FORBID amateur yellow gradients, curved WordArt, or bevel/emboss drop-shadow effects.

3. PRISTINE ANTI-SMUDGE BRAND LOGO INTEGRATION:
   - When a business logo is provided or requested, position it as a crisp, razor-sharp vector mark in the top-left or top-right corner.
   - STRICT ANTI-SMUDGE DIRECTIVE: The brand logo mark and brand name lettering must be rendered with razor-sharp edges and pristine geometric fidelity. Strictly DO NOT smudge, melt, blur, distort, warp, or airbrush the logo icon or font lettering. It must look like an official, high-resolution vector brand mark placed cleanly over the creative.

4. CLEAN, HIGH-CONVERTING FOOTER STRIP:
   - Bottom margin: A sleek, flat, minimalist footer strip or high-contrast contact banner featuring the phone number or website with generous padding.
   - Clean, modern phone icon and crisp legible digits. No cluttered fine print or tacky badges.

5. PHOTOGRAPHIC REALISM & AUTHENTIC HUMANS (WHEN INCLUDED):
   - Commercial studio or natural sunlight with rich dynamic range, soft directional shadows, and authentic reflections.
   - Human subjects must look like genuine, charismatic professionals or happy customers with natural skin texture, visible micro-pores, and authentic candid smiles. Strictly NO plastic, airbrushed, or synthetic AI faces.`;

// ============================================================================
// ORGANIC / SMARTPHONE OVERRIDE
// When isOrganic=true, this replaces the camera characteristics section
// ============================================================================

export const ORGANIC_OVERRIDE = `Camera characteristics override (RAW & ORGANIC):
- The image must look like an unedited, authentic photo taken by a regular person on a recent flagship smartphone camera (e.g. iPhone 16, Pixel 9, Samsung S25).
- Subtle computational photography characteristics: natural HDR, slight lens softness at edges.
- Natural, slightly imperfect ambient lighting — no artificial studio glow or rim lighting.
- Candid, unpolished composition with real-world background clutter.
- Slight natural imperfections: micro motion blur, casual framing, ambient noise grain.`;

// ============================================================================
// VERTICAL MODULES — Industry-specific production add-ons
// ============================================================================

export const VERTICAL_MODULES: Record<string, string> = {
  real_estate: `Vertical module — Real Estate, Land, & Architecture (Direct-Response High Converting):
The objective is to produce ultra-premium, high-converting real estate ad creatives that drive site visits and qualified buyer inquiries. Draw visual inspiration from Architectural Digest, luxury developer brochures, and top-performing Meta real estate ad campaigns.

Direct-Response Real Estate Visual Rules:
1. Authentic Real-World Architecture: The property MUST be depicted as a real, tangible physical property captured by an architectural photographer. Show the actual building facade with warm sunlight, landscaped gardens, paved driveways, elegant balconies, or grand floor-to-ceiling glass interiors. Strictly NEVER generate floating 3D dirt cubes, isometric game blocks, or synthetic CGI wireframes floating in space. Every scene must be grounded in a realistic real-world environment.
2. High-Converting Visual Composition:
   - 60-70% Hero: Magnificent, sun-drenched exterior facade or luxury living room overlooking lush green surroundings with 35mm lens depth.
   - Clean Typography: Bold, elegant headline calling out the premier lifestyle or location, paired with a clean subline.
   - Strictly avoid cluttered floating badges, tacky gold medals, or cartoonish graphics.
3. Atmosphere & Natural Lighting: Bright morning or golden-hour sunlight with crisp architectural shadows, clear skies, and warm ambient indoor lighting visible through grand windows.
4. Clean Footer CTA & Branding: Business logo positioned as a pristine, razor-sharp mark in an upper corner (no smudged lettering). Contact number and website integrated into a sleek, minimalist bar at the bottom margin with high legibility.`,

  food: `Vertical module — Food & Restaurant:
The objective is realistic editorial food photography. Preserve the dish, plating, and ingredients faithfully while emphasizing freshness, texture, and appetite appeal. Use natural window light or warm ambient restaurant lighting. Avoid exaggerated steam, unrealistic glossiness, or artificial perfection. Show real tableware, textured surfaces, and environmental context (wooden table, marble counter, restaurant interior). The result should resemble a photograph from a premium restaurant campaign or food magazine like Bon Appétit.`,

  fashion: `Vertical module — Fashion & Apparel:
The objective is premium editorial fashion photography. Preserve exact garment design, fabric texture, colors, and fit. Models should look naturally posed with authentic body language. Lighting should emphasize fabric drape and texture realistically. The result should resemble a high-end lookbook or fashion editorial from Vogue or GQ.`,

  beauty: `Vertical module — Beauty & Skincare:
The objective is premium beauty and skincare commercial photography. Preserve exact product design, packaging, colors, and branding. Skin should look naturally healthy with real texture (pores, light freckles) — not airbrushed or plastic. Use soft, diffused natural light. The result should resemble a high-end beauty campaign from brands like Glossier or La Mer.`,

  ecommerce: `Vertical module — Product & E-commerce:
The objective is premium commercial product photography. Preserve the exact design, shape, branding, colors, and proportions of the product. Lighting should emphasize materials realistically — the shine of metal, the softness of fabric, the transparency of glass. Show the product in a lifestyle context or clean studio setting. The result should resemble a high-end Apple, Nike, or premium e-commerce campaign photograph.`,

  automotive: `Vertical module — Automotive:
The objective is premium automotive commercial photography. Preserve the exact vehicle model, paint color, body lines, and proportions. Show realistic reflections, paint depth, and environmental lighting. The result should resemble a manufacturer's official press photograph or a premium automotive magazine cover.`,

  saas: `Vertical module — Technology, AI & SaaS:
The objective is seasoned, agency-grade tech advertising (inspired by Stripe, Apple, Linear, and Ramp).
Show high-converting, authoritative visual storytelling:
- High-impact human interactions: A smiling modern business owner or growth executive in a sunlit contemporary workspace, experiencing genuine relief and success.
- Crisp hardware/software integration: Sleek modern laptop or smartphone displaying a clean, minimal interface, or a striking split-screen contrasting manual operational chaos with automated clarity.
- Strictly FORBID cheap floating 3D neon cubes, floating isometric charts, fake floating hologram graphs, or repetitive checklist badges. Keep typography bold, minimal, and authoritative.`,

  services: `Vertical module — Professional Services:
The objective is authentic professional services photography showing real people in real work environments. Capture genuine interactions, professional settings, and warm interpersonal moments. The result should resemble corporate photography from a premium branding agency.`,

  general: `Vertical module — General Commercial:
The objective is versatile, premium commercial photography suitable for advertising. Adapt the visual style to match the subject matter naturally. Emphasize authenticity, warmth, and professional quality. The result should be suitable for use in a high-end multi-channel advertising campaign.`
};

// ============================================================================
// RENDERING PRIORITIES — Reality bias hierarchy
// ============================================================================

export const RENDERING_PRIORITIES = `Rendering priorities (highest to lowest):
1. Preserve reference image fidelity.
2. Maintain physical and architectural accuracy.
3. Achieve photographic realism.
4. Create an attractive commercial composition.
5. Add aesthetic enhancements only if they do not reduce realism.`;

// ============================================================================
// AUTHENTICITY RULE — The single most important backend instruction
// ============================================================================

export const AUTHENTICITY_RULE = `The primary objective is to maximize perceived authenticity. A viewer should believe the image is a genuine photograph captured in the real world. Whenever there is a trade-off between beauty and realism, choose realism. Small natural imperfections are desirable because they increase believability.`;

// ============================================================================
// REFERENCE CREATIVE PREAMBLE BUILDER
// Places reference creative instructions at the TOP of the prompt with
// explicit priority weighting so the model doesn't drift or ignore them.
// ============================================================================

export function buildReferenceCreativePreamble(
  numPropertyImages: number,
  hasLogo: boolean,
  hasReference: boolean
): string {
  if (!hasReference) return '';

  // Build explicit image disambiguation so the model knows which image is which
  const imageMap: string[] = [];
  for (let i = 0; i < numPropertyImages; i++) {
    imageMap.push(`  - Image ${i + 1}: PROPERTY/PRODUCT photo (content asset only — use as hero visual)`);
  }
  if (hasLogo) {
    imageMap.push(`  - Image ${numPropertyImages + 1}: BUSINESS LOGO (branding asset only — place cleanly in corner as razor-sharp vector mark)`);
  }

  return `=== CRITICAL DESIGN INSTRUCTION (HIGHEST PRIORITY) ===

REFERENCE PRIORITY: 10/10
CONTENT PRIORITY: 8/10
TEXT PRIORITY: 6/10

IMAGE DISAMBIGUATION (each input image is labeled below):
${imageMap.join('\n')}

The visual layout design, element placements, and aesthetic theme of the reference creative are described in text details within the prompt. 

STRICT EXCLUSION & UNIVERSAL REPRODUCTION RULES FOR REFERENCE STYLE:
- The reference image is ONLY a style, color, and layout guide.
- Do NOT copy, reproduce, or imitate specific physical subjects, buildings, or products from the reference creative image.
- The hero visual MUST come strictly from the user's uploaded product/brand photos (Image 1..N) or product/service details.
- FAITHFULLY REPRODUCE SIGNATURE LAYOUT & CONTAINER GEOMETRY: Place the user's hero visual inside the clean signature layout described in the design blueprint.
- AGENCY DIRECT-RESPONSE TYPOGRAPHY: Render text in modern, bold, clean typography with high contrast and generous whitespace. Strictly avoid cheesy 3D bevels, tacky gold ribbon stickers, or amateur floating glass boxes.
- PRISTINE LOGO REPRODUCTION: If a logo image is provided, display it with 100% razor-sharp fidelity in an upper corner. Strictly NEVER smudge, warp, melt, blur, or distort the logo icon or font lettering.

The final generated ad MUST closely match the reference's:
- Layout structure and spatial composition
- Typography hierarchy and text placement
- Color palette treatment, lighting atmosphere, and overall aesthetic
- Element positioning (where headlines, images, logos, and CTAs are placed)

Do NOT create a random layout from scratch.
Use the design style and layout described below as the primary design blueprint.

The property/product photos are CONTENT ASSETS ONLY — they replace the hero visual in the layout.
The logo image is BRANDING ONLY — it replaces any logo in the reference layout or goes in a corner.

=== END CRITICAL DESIGN INSTRUCTION ===

`;
}

export function buildImageDisambiguationPreamble(
  numPropertyImages: number,
  hasLogo: boolean
): string {
  if (numPropertyImages === 0 && !hasLogo) return '';

  const imageMap: string[] = [];
  for (let i = 0; i < numPropertyImages; i++) {
    imageMap.push(`  - Image ${i + 1}: HERO PRODUCT/BRAND photo (content asset only — use as the primary visual hero for the product, property, or service)`);
  }
  if (hasLogo) {
    imageMap.push(`  - Image ${numPropertyImages + 1}: BUSINESS LOGO (branding asset only — place cleanly in corner as a sharp vector mark, do NOT make it a hero/subject)`);
  }

  return `=== CRITICAL IMAGE SOURCE ROLES (HIGHEST PRIORITY) ===
Each input image is labeled and mapped to its role below:
${imageMap.join('\n')}

MANDATORY RULES:
1. The product/brand photos (Image 1 to Image ${numPropertyImages}) are content assets. Keep the generated hero visual extremely close, faithful, and visually consistent with these actual photos. Do NOT invent unrelated products or alter the core subject.
2. The logo (Image ${numPropertyImages + 1}) is branding only. Place it as a crisp, razor-sharp mark in an upper corner. Strictly DO NOT stretch, warp, smudge, melt, or blur the logo text or icon.
=== END IMAGE ROLES ===

`;
}

// ============================================================================
// CONTENT INTEGRITY RULES — Anti-hallucination, anti-clutter, branding defaults
// ============================================================================

export const CONTENT_INTEGRITY_RULES = `Content Integrity & Branding Rules (MANDATORY — apply to EVERY creative):

1. ZERO HALLUCINATION POLICY:
   - You must ONLY include text, facts, numbers, prices, features, claims, and details that are EXPLICITLY provided in the product/business input.
   - Do NOT invent, fabricate, assume, or embellish ANY information — no made-up prices, no fake discounts, no imaginary features, no fictional testimonials, no assumed locations or addresses.
   - If a piece of information (e.g. price, offer, phone number, website) is NOT provided in the input, do NOT include it in the creative. Leave it out entirely rather than guessing.
   - Do NOT add generic marketing claims like "#1 in the city", "Best quality", "Award-winning" unless these exact claims are provided in the input.

2. ANTI-CLUTTER & ANTI-AMATEUR GIMMICKS RULE:
   - Keep the creative clean, breathable, and visually premium. Less is more.
   - Only include the MOST ESSENTIAL information: exactly one bold benefit hook headline, one supporting subline, brand logo, and contact info.
   - STRICT BAN: Absolutely NO floating 3D glass cubes, fake floating graphs/charts, repetitive checklist pills, circular gold ribbon seals, or neon glowing gamer buttons.
   - Text overlays should be minimal, high-impact, and easily readable at a glance.
   - Prefer visual storytelling over text-heavy layouts.

3. BUSINESS LOGO (MANDATORY BY DEFAULT — STRICT ANTI-SMUDGE):
   - The business logo MUST be integrated into the creative visually as a clean, razor-sharp brand mark.
   - Place the logo in an upper corner (top-left or top-right) with clean negative space.
   - If a logo image is provided in the input images, reproduce its exact shape, icon, and lettering cleanly.
   - STRICT ANTI-SMUDGE DIRECTIVE: Under no circumstances should the logo mark or typography be smudged, melted, warped, or distorted. Render it with crisp, clean vector-sharp edges.
   - CRITICAL: Do NOT write, print, or draw any literal text phrases, labels, or placeholders in the image such as "logo", "business logo", "put logo here", "logo here", or blank placeholder circles. The final image must be completely clean of layout instructions or design annotations.
   - EXCEPTION: Only omit the logo if the user EXPLICITLY requests "no logo" or "remove the logo" in their instructions.

4. CONTACT INFORMATION (MANDATORY BY DEFAULT):
   - If contact information (phone number, website, email, or address) is provided in the input, it MUST be included in the creative.
   - Place contact details in a clean, minimal bar or strip at the bottom of the creative, using a small, well-spaced, legible font.
   - Do NOT clutter the creative with contact info — keep it subtle and professional.
   - If NO contact info is provided in the input, do NOT fabricate any — simply omit the contact section.
   - EXCEPTION: Only omit contact info if the user EXPLICITLY requests "no contact info" or similar in their instructions.

5. INFORMATION HIERARCHY:
   - Primary: Hero visual (product/property/service image) — takes up 60-70% of the canvas.
   - Secondary: Brand name + one key message/headline — concise and impactful.
   - Tertiary: Logo (corner) + Contact info (bottom strip).
   - Everything else is optional and should only be included if explicitly provided AND if it doesn't clutter the layout.`;

// ============================================================================
// SUPPORTED INDUSTRIES
// ============================================================================

export const SUPPORTED_INDUSTRIES = [
  'real_estate',
  'food',
  'fashion',
  'beauty',
  'ecommerce',
  'automotive',
  'saas',
  'services',
  'general'
] as const;

export type Industry = typeof SUPPORTED_INDUSTRIES[number];

// ============================================================================
// HELPER: Get vertical module for an industry
// ============================================================================

export function getVerticalModule(industry: string): string {
  return VERTICAL_MODULES[industry] || VERTICAL_MODULES['general'];
}

// ============================================================================
// BUILDER: Assemble the full master system prompt
// ============================================================================

export function buildImageSystemPrompt(industry: string, isOrganic: boolean = false): string {
  const verticalModule = getVerticalModule(industry);

  const cameraSection = isOrganic ? ORGANIC_OVERRIDE : '';

  return `=== SYSTEM-LEVEL VISUAL PRODUCTION RULES ===
(These rules define the foundational visual grammar for ALL image generation. The image prompt you write MUST follow these rules.)

${MASTER_PROMPT}

${cameraSection}

${verticalModule}

${RENDERING_PRIORITIES}

${AUTHENTICITY_RULE}

${CONTENT_INTEGRITY_RULES}

=== END VISUAL PRODUCTION RULES ===`;
}

// ============================================================================
// DETECTOR: Auto-classify user's industry via Gemini
// ============================================================================

export async function detectIndustry(
  businessName: string,
  businessInfo: string,
  missionStatement: string
): Promise<Industry> {
  const supportedList = SUPPORTED_INDUSTRIES.join(', ');

  const prompt = `You are an elite business classification expert. Based on the following business profile, classify the business into exactly ONE of these industry categories: ${supportedList}.

Business Name: "${businessName || 'N/A'}"
Business Description: "${businessInfo || 'N/A'}"
Mission/Tagline: "${missionStatement || 'N/A'}"

Strict Classification Rules:
- CRITICAL FOR SAAS / AI / SOFTWARE / AGENCIES: If the business is a software platform, AI tool, CRM, app, digital marketing system, voice calling automation, or tech service that serves real estate clients (e.g. "AI sales & marketing department for real estate", "CRM for property brokers"), you MUST classify it as "saas" (or "services"), NEVER "real_estate". Only classify as "real_estate" if the business itself directly sells, rents, brokers, or constructs physical land, buildings, homes, apartments, or villas.
- If the business directly sells, rents, or markets physical properties, land, apartments, homes, plots, villas, or construction — classify as "real_estate".
- If the business is a restaurant, cafe, bakery, food delivery, catering, or sells food/beverage products — classify as "food".
- If the business sells clothing, accessories, shoes, jewelry, or apparel — classify as "fashion".
- If the business sells skincare, cosmetics, haircare, wellness, or beauty products — classify as "beauty".
- If the business sells physical products online (electronics, gadgets, home goods, etc.) — classify as "ecommerce".
- If the business sells or markets vehicles, car dealerships, or automotive parts — classify as "automotive".
- If the business is a software company, app, SaaS platform, AI platform, or tech service — classify as "saas".
- If the business provides professional services (consulting, legal, accounting, marketing agency, education, healthcare) — classify as "services".
- If none of the above match clearly — classify as "general".

Output ONLY the single lowercase category string (e.g. "saas" or "real_estate"). No explanation, no quotes, no extra text.`;

  try {
    let result;
    try {
      result = await generateText({
        model: google('gemini-3.5-flash'),
        prompt,
      });
    } catch {
      result = await generateText({
        model: google('gemini-3-flash-preview'),
        prompt,
      });
    }

    const detected = result.text.trim().toLowerCase().replace(/['"]/g, '');

    if (SUPPORTED_INDUSTRIES.includes(detected as Industry)) {
      console.log(`[Industry Detection] Classified "${businessName}" as: ${detected}`);
      return detected as Industry;
    }

    console.warn(`[Industry Detection] Gemini returned unsupported industry "${detected}". Falling back to "general".`);
    return 'general';
  } catch (err: any) {
    console.error(`[Industry Detection] Failed to classify industry: ${err.message}. Falling back to "general".`);
    return 'general';
  }
}

// ============================================================================
// DYNAMIC VISUAL ARCHETYPE & HUMAN PERSONA VARIATION ENGINE
// Ensures every creative generation without custom prompts has distinct design,
// lighting, camera angles, color palettes, and diverse human personas.
// ============================================================================

export interface VisualArchetype {
  id: string;
  name: string;
  lighting: string;
  composition: string;
  typography: string;
  promptInstructions: string;
}

export interface HumanPersona {
  id: string;
  name: string;
  hasHumans: boolean;
  promptDirective: string;
}

export function getRandomVisualArchetype(
  propertyTitle?: string,
  propertyDescription?: string,
  seedString?: string
): VisualArchetype {
  const archetypes: VisualArchetype[] = [
    {
      id: 'high_authority_direct_response',
      name: 'High-Authority Direct Response',
      lighting: 'Crisp commercial daylight with high dynamic range, soft directional architectural shadows, and clean reflections',
      composition: 'Bold authoritative layout inspired by Stripe and Apple: clean negative space, single striking focal subject, and razor-sharp typographic hierarchy',
      typography: 'Dominant ultra-clean bold grotesque sans-serif headline with generous tracking and high contrast',
      promptInstructions: 'DESIGN ARCHETYPE: High-Authority Direct Response. Create a sleek, authoritative ad composition with clean negative space, bold modern typography, a single dominant hero visual, and a pristine minimalist footer. Strictly avoid floating 3D cubes, fake chart graphs, or sticker ribbons.'
    },
    {
      id: 'editorial_archdigest',
      name: 'High-End Commercial Editorial',
      lighting: 'Golden Hour warm sunlight casting soft linear shadows with premium ambient rim-light',
      composition: 'Dramatic asymmetrical low-angle perspective with off-center hero framing and high-end luxury editorial spacing',
      typography: 'Refined editorial serif headline paired with crisp minimalist sub-headers',
      promptInstructions: 'DESIGN ARCHETYPE: High-End Commercial Editorial. Create a dramatic visual composition with refined spacing, elegant typography, and authentic warm sunlight. Keep layout uncluttered and breathable.'
    },
    {
      id: 'bold_social_conversion',
      name: 'Bold High-Converting Social Ad',
      lighting: 'Bright, high-exposure commercial morning light with vibrant, natural contrast',
      composition: 'High-impact conversion layout featuring a strong visual hook, clean flat color contrast, and uncluttered breathing room',
      typography: 'Punchy, ultra-bold modern sans-serif headline commanding immediate scroll-stopping attention',
      promptInstructions: 'DESIGN ARCHETYPE: Bold High-Converting Social Ad. Create an energetic, scroll-stopping direct-response ad with bold headline typography, authentic commercial photography, and a clean contact strip. No tacky badges or 3D clipart.'
    },
    {
      id: 'scandinavian_minimalist',
      name: 'Minimalist Modern Luxury',
      lighting: 'Soft diffused natural daylight with airy white-balanced highlights',
      composition: 'Ultra-clean minimalist layout with generous negative space, understated framing, and flat modern graphic elegance',
      typography: 'Minimalist lightweight geometric sans-serif typography with generous kerning and letter spacing',
      promptInstructions: 'DESIGN ARCHETYPE: Minimalist Modern Luxury. Create an ultra-clean, serene layout with generous negative space, soft ambient daylight, and minimal geometric typography.'
    },
    {
      id: 'cinematic_lifestyle',
      name: 'Cinematic Lifestyle Story',
      lighting: 'Warm ambient filmic sunlight with natural lens flare and soft atmospheric glow',
      composition: 'Candid lifestyle hero shot with soft shallow depth-of-field background, warm organic textures, and cinematic 35mm photography feel',
      typography: 'Subtle, modern luxury header integrated cleanly into the natural scene composition',
      promptInstructions: 'DESIGN ARCHETYPE: Cinematic Lifestyle Story. Create a warm, candid 35mm film-style photography scene with shallow depth of field, organic textures, and natural lifestyle framing.'
    }
  ];

  let seed = 0;
  const combinedStr = (seedString || '') + (propertyTitle || '') + (propertyDescription || '') + Math.random().toString();
  for (let i = 0; i < combinedStr.length; i++) {
    seed = (seed * 31 + combinedStr.charCodeAt(i)) % 1000000;
  }
  const index = Math.abs(seed) % archetypes.length;
  return archetypes[index];
}

export function getRandomHumanPersona(
  propertyTitle?: string,
  propertyDescription?: string,
  userInstructions?: string,
  seedString?: string,
  detectedIndustry?: string
): HumanPersona {
  const combinedText = `${propertyTitle || ''} ${propertyDescription || ''} ${userInstructions || ''}`.toLowerCase();

  const isSaaSOrTech = detectedIndustry === 'saas' || /\b(ai|saas|software|platform|dashboard|crm|voice agent|automation|app|tech|marketing tool|leads engine)\b/.test(combinedText);
  const isFood = detectedIndustry === 'food' || /\b(food|restaurant|cafe|bakery|dish|cuisine|coffee|dining|meal|burger|pizza)\b/.test(combinedText);
  const isFashionOrBeauty = ['fashion', 'beauty'].includes(detectedIndustry || '') || /\b(fashion|clothing|skincare|cosmetics|beauty|serum|apparel|wear|jewelry)\b/.test(combinedText);
  const isRealEstate = detectedIndustry === 'real_estate' || (/\b(villa|kothi|bungalow|duplex|penthouse|flat|apartment|plots|land|property|acres|bigha|bhk)\b/.test(combinedText) && !isSaaSOrTech);

  if (isSaaSOrTech) {
    const techPersonas: HumanPersona[] = [
      {
        id: 'tech_founder',
        name: 'Modern Tech Founder / Business Owner',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a candid close-up portrait shot (chest up) of a confident, smiling modern tech founder or business leader (late 20s or 30s) in smart-casual attire (e.g. stylish crewneck or linen overshirt), looking with genuine joy and relief while glancing at a modern smartphone or laptop in a sunlit architectural glass workspace. Authentic skin textures with natural pores, avoid airbrushed look.'
      },
      {
        id: 'growth_marketer',
        name: 'Energetic Growth Marketer',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a candid portrait shot of an energetic marketing executive or operator (late 20s or early 30s) wearing headphones or smart casuals, celebrating a breakthrough campaign outcome with an authentic, joyful expression in a bright contemporary agency studio.'
      },
      {
        id: 'approachable_expert',
        name: 'Trusted Industry Specialist',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a close-up portrait of an approachable, distinguished business professional (30s-40s) with warm, welcoming eyes and an authentic smile of confidence, set against a blurred modern workspace with soft ambient lighting.'
      },
      {
        id: 'no_humans_tech',
        name: 'Pure Platform Spotlight (No Humans)',
        hasHumans: false,
        promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans or people in this creative image. Focus 100% of the visual spotlight on sleek modern technology, clean high-converting copywriting hierarchy, crisp commercial lighting, and agency-grade typography. Strictly avoid floating 3D cubes, fake chart holograms, or glowing neon buttons.'
      }
    ];
    let seed = 0;
    for (let i = 0; i < (seedString || combinedText).length; i++) seed = (seed * 31 + (seedString || combinedText).charCodeAt(i)) % 1000;
    return techPersonas[Math.abs(seed) % techPersonas.length];
  }

  if (isFood) {
    const foodPersonas: HumanPersona[] = [
      {
        id: 'happy_diner',
        name: 'Delighted Diner',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a warm, candid portrait of an attractive customer sharing an authentic moment of culinary delight and pleasure in a warm ambient restaurant atmosphere.'
      },
      {
        id: 'passionate_chef',
        name: 'Artisan Chef',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a close-up portrait of a passionate culinary artisan or chef in a clean apron, smiling proudly with authentic craftsmanship.'
      },
      {
        id: 'no_humans_food',
        name: 'Pure Food Focus (No Humans)',
        hasHumans: false,
        promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans. Focus 100% of the visual canvas on the mouth-watering food presentation, natural textures, fresh garnishes, and warm appetizing lighting.'
      }
    ];
    let seed = 0;
    for (let i = 0; i < (seedString || combinedText).length; i++) seed = (seed * 31 + (seedString || combinedText).charCodeAt(i)) % 1000;
    return foodPersonas[Math.abs(seed) % foodPersonas.length];
  }

  if (isFashionOrBeauty) {
    const fashionPersonas: HumanPersona[] = [
      {
        id: 'chic_model',
        name: 'Chic Lifestyle Model',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a high-fashion editorial close-up portrait of a chic, effortlessly styled individual showcasing authentic natural skin texture, glowing healthy skin pores, and relaxed natural elegance in soft daylight.'
      },
      {
        id: 'no_humans_product',
        name: 'Pure Product & Material Focus (No Humans)',
        hasHumans: false,
        promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans. Focus 100% on the luxury product textures, bottle/fabric craftsmanship, pristine studio lighting, and elegant typography.'
      }
    ];
    let seed = 0;
    for (let i = 0; i < (seedString || combinedText).length; i++) seed = (seed * 31 + (seedString || combinedText).charCodeAt(i)) % 1000;
    return fashionPersonas[Math.abs(seed) % fashionPersonas.length];
  }

  if (isRealEstate) {
    const realEstatePersonas: HumanPersona[] = [
      {
        id: 'solo_professional',
        name: 'Single Independent Buyer / Professional',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a close-up portrait shot (chest up) of a stylish, confident young professional or entrepreneur (man or woman in late 20s or 30s) in smart casual attire showing a candid, genuine smile of joy while holding a coffee cup near a sunlit window. Authentic skin textures with fine pores.'
      },
      {
        id: 'young_family',
        name: 'Young Modern Family',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a warm portrait shot of a happy, attractive young modern family (parents in 30s with a young child) sharing a cheerful, authentic moment of laughter together in a bright, modern living area. Authentic photorealistic expressions and real skin textures.'
      },
      {
        id: 'mature_homeowner',
        name: 'Mature Luxury Homeowner',
        hasHumans: true,
        promptDirective: 'HUMAN PERSONA: Include a portrait of a successful, distinguished homeowner or investor (40s-50s) in elegant casual attire enjoying a serene moment in a high-end luxury space, expressing success and peaceful satisfaction.'
      },
      {
        id: 'no_humans_arch',
        name: 'Pure Architectural & Interior Focus (No Humans)',
        hasHumans: false,
        promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans or people in this creative image. Focus 100% of the visual spotlight on the gorgeous property architecture, luxury interior design, crisp lighting, and graphic typography overlays.'
      }
    ];
    let seed = 0;
    for (let i = 0; i < (seedString || combinedText).length; i++) seed = (seed * 37 + (seedString || combinedText).charCodeAt(i)) % 1000;
    return realEstatePersonas[Math.abs(seed) % realEstatePersonas.length];
  }

  // Universal fallback personas for General / Services / Unknown
  const universalPersonas: HumanPersona[] = [
    {
      id: 'smiling_professional',
      name: 'Confident Smiling Professional',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include a close-up portrait shot (chest up) of a warm, confident professional or business owner (late 20s or 30s) in stylish smart casual attire showing a candid, genuine smile of success and satisfaction in a bright, clean contemporary space. Natural skin texture with real pores.'
    },
    {
      id: 'satisfied_customer',
      name: 'Delighted Customer / Client',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include an authentic portrait of a happy, relatable customer or client enjoying the service or product with genuine relief and joy. Natural lighting and authentic micro-expressions.'
    },
    {
      id: 'no_humans_universal',
      name: 'Pure Brand & Commercial Design (No Humans)',
      hasHumans: false,
      promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans or people in this creative image. Focus 100% of the visual spotlight on the hero product or service, premium graphic layouts, high-converting copy hierarchy, and crisp commercial lighting.'
    }
  ];

  let seed = 0;
  const combinedStr = (seedString || '') + Math.random().toString();
  for (let i = 0; i < combinedStr.length; i++) {
    seed = (seed * 37 + combinedStr.charCodeAt(i)) % 1000000;
  }
  const index = Math.abs(seed) % universalPersonas.length;
  return universalPersonas[index];
}
