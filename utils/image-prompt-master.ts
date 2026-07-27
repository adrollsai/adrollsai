import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

// ============================================================================
// MASTER PROMPT — Photorealistic Commercial Photography Baseline
// ============================================================================

export const MASTER_PROMPT = `You are an elite commercial photography and visual production AI. Your task is not to create digital art or 3D renders, but to generate images that are visually indistinguishable from authentic high-end photographs captured in the real world.

When reference images are provided, preserve the architecture, layout, products, branding, proportions, geometry, and key design elements exactly. Do not redesign, reinterpret, or invent structural changes unless explicitly instructed. The goal is to transform the provided visual into a realistic photographic scene.

Default visual style:
- Ultra-photorealistic commercial photography.
- Bright, airy, and clean light theme by default. Use high-exposure morning sunlight, crisp natural shadows, and a clean commercial lighting aesthetic. Avoid dark, dim, moody, or sunset/twilight settings unless explicitly requested.
- Premium editorial and advertising quality.
- Natural, believable lighting with physically plausible reflections, shadows, and materials.
- Real-world camera optics and exposure behavior.
- Balanced dynamic range with authentic highlight and shadow retention.
- Natural color science without oversaturation or artificial contrast.
- Rich micro-details and texture variation.

Camera characteristics:
- Image should appear captured by an experienced commercial photographer using premium modern camera equipment, with a natural photographic aesthetic appropriate for the subject matter.
- Realistic perspective, lens behavior, and depth of field.
- Subtle computational photography characteristics without exaggerated HDR.
- Slight natural imperfections consistent with real photography.
- The result should feel authentic and suitable for use in a high-end advertising campaign.

Human subjects (when included):
- Focus exclusively on close-up portrait shots (chest up or head-and-shoulders framing) of fully visible, beautiful, photorealistic humans (e.g. happy families, elegant couples, or successful professionals) showing natural, happy, and smiling expressions of joy. Avoid distant, tiny, or blurry figures. The human subjects must be prominent and placed in the foreground.
- The human subjects must look highly attractive, beautiful, successful, and aspirational.
- Skin must have true-to-life detailing (natural skin pores, fine textures, real skin creases, and subtle micro-details) and look completely authentic, avoiding any plastic, airbrushed, synthetic, or shiny AI-generated look.
- Eyes must look clear, lifelike, and expressive.
- The ethnicity of the humans should match the geographical region of the business (e.g. South Asian/Indian ethnicity if the business context or product is located in India, Caucasian/Western otherwise).
- Avoid common AI errors like distorted fingers, unnatural expressions, extra limbs, or synthetic-looking eyes.
- Candid expressions and natural facial asymmetry should be prioritized.

Materials and environment:
- Surfaces should display realistic physical properties and subtle imperfections.
- Glass, metal, wood, stone, concrete, water, and vegetation should behave naturally under available light.
- Add believable environmental details and lived-in context where appropriate.
- Avoid repetitive patterns, sterile perfection, or synthetic-looking textures.

Critical quality requirements:
- The final result must look like a genuine photograph taken by a professional photographer.
- The image should never resemble a CGI render, architectural visualization, illustration, concept art, or AI-generated artwork.
- Avoid common AI artifacts including plastic skin, over-symmetry, distorted anatomy, unrealistic smiles, floating objects, duplicated elements, warped text, or excessive sharpness.
- Prefer subtle realism and believable imperfections over idealized perfection.

If there is any conflict between artistic stylization and photographic realism, always prioritize photographic realism.`;

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
  real_estate: `Vertical module — Real Estate, Land, & Architecture:
The objective is to produce highly premium, modern, and high-converting real estate ad layouts. Draw layout and design inspiration from elite digital real estate graphics (such as those seen on Pinterest or Architectural Digest social feeds).

Layout & Visual Structure Rules:
1. Floating Asset Visual: If generating land or plots, portray it as an isometric 3D block of land floating cleanly in space with realistic soil layers, green grass, and trees. Place a glowing, high-contrast semi-transparent wireframe or digital blueprint overlay outlining villa/home structures directly on the land to represent planning, future value, and modern architectural potential.
2. Bright Atmosphere & Natural Lighting: The scene should have a bright, airy, and clean light theme. Use bright morning sunlight, clear blue skies, and high-exposure commercial architecture lighting. Avoid dark, moody, twilight, or sunset settings unless specifically requested.
3. Design Layout & Spacing: Keep the visual clean, crisp, and uncluttered. If using gradient vignettes for legibility under text, ensure they are subtle light-translucent overlays, keeping the overall scene bright.
4. Typography Styling & Pairing: Use premium, modern, and stylized typography (e.g. elegant serif headers paired with clean minimalist geometric sans-serif sub-headers). Avoid unstyled, generic lettering. Ensure all text is extremely crisp, legible, and integrated cleanly with proper letter-spacing.
5. Human Subjects: Include close-up or medium shots of fully visible, beautiful, photorealistic humans (e.g. smiling faces, expressions of joy/satisfaction) enjoying the property or space.
6. Brand & Info Integration: The brand logo must be positioned as a small, elegant seal/monogram in a corner (e.g. top-left or top-right) to act as a discrete stamp of quality. Website and contact information should be aligned horizontally at the bottom margin in a tiny, well-spaced clean font.`,

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

  saas: `Vertical module — Technology & SaaS:
The objective is modern tech product photography and lifestyle imagery. Show devices, screens, and workspaces in clean, contemporary environments. Humans interacting with technology should look natural and focused. The result should resemble tech editorial from publications like Wired or Apple marketing campaigns.`,

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
    imageMap.push(`  - Image ${numPropertyImages + 1}: BUSINESS LOGO (branding asset only — place in corner)`);
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
- Do NOT copy, reproduce, or imitate the specific building, house structure, architectural elements, or physical objects from the reference creative image.
- The property/building visual MUST come strictly from the user's property/product photos (Image 1..N) or property details.
- FAITHFULLY REPRODUCE SIGNATURE LAYOUT & CONTAINER GEOMETRY: Place the user's property photo inside the exact signature container frame, silhouette, shape mask, or grid layout described in the design blueprint.
- LUXURY TYPOGRAPHY SYSTEM: Main headline text MUST be rendered in ultra-high-end haute-couture typography (such as an elegant serif font with refined stroke contrast or a sleek high-fashion geometric font). Never use cheap yellow gradients or crude Arial fonts. Use subtle champagne gold foil, warm ivory-white, or metallic bronze lettering with authentic directional lighting highlights. Sub-headers and location tags MUST feature wide, generous letter-spacing (wide tracking) for an expensive, agency-level aesthetic.

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
    imageMap.push(`  - Image ${i + 1}: PROPERTY/PRODUCT photo (content asset only — use as the primary visual source for the real estate property)`);
  }
  if (hasLogo) {
    imageMap.push(`  - Image ${numPropertyImages + 1}: BUSINESS LOGO (branding asset only — place cleanly in a corner, blend its background smoothly, do NOT make it a hero/subject)`);
  }

  return `=== CRITICAL IMAGE SOURCE ROLES (HIGHEST PRIORITY) ===
Each input image is labeled and mapped to its role below:
${imageMap.join('\n')}

MANDATORY RULES:
1. The property photos (Image 1 to Image ${numPropertyImages}) are content assets. Keep the generated building/property visual extremely close, faithful, and visually consistent with these actual photos. Do NOT invent unrelated structures or change the architectural design of the building.
2. The logo (Image ${numPropertyImages + 1}) is branding only. Place it elegantly as a stamp of quality. Do NOT stretch, warp, or place it at the center of the scene.
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

2. ANTI-CLUTTER RULE:
   - Keep the creative clean, breathable, and visually premium. Less is more.
   - Only include the MOST ESSENTIAL information from the product input — typically: product/service name, one key benefit or price point, and brand identity.
   - Do NOT overload the image with excessive text overlays, multiple bullet points, long descriptions, or too many data points.
   - Text overlays should be minimal, high-impact, and easily readable at a glance.
   - Prefer visual storytelling over text-heavy layouts.

3. BUSINESS LOGO (MANDATORY BY DEFAULT):
   - The business logo MUST be integrated into the creative visually as a clean, professional branding stamp.
   - Place the logo as a subtle but visible seal/watermark in a corner (top-left, top-right, or bottom-right).
   - If a logo image is provided in the input images, use its visual graphic/icon.
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

  const prompt = `You are a business classification expert. Based on the following business profile, classify the business into exactly ONE of these industry categories: ${supportedList}.

Business Name: "${businessName || 'N/A'}"
Business Description: "${businessInfo || 'N/A'}"
Mission/Tagline: "${missionStatement || 'N/A'}"

Rules:
- If the business sells or markets properties, land, apartments, homes, plots, villas, or construction — classify as "real_estate".
- If the business is a restaurant, cafe, bakery, food delivery, catering, or sells food/beverage products — classify as "food".
- If the business sells clothing, accessories, shoes, jewelry, or apparel — classify as "fashion".
- If the business sells skincare, cosmetics, haircare, wellness, or beauty products — classify as "beauty".
- If the business sells physical products online (electronics, gadgets, home goods, etc.) — classify as "ecommerce".
- If the business sells or markets vehicles, car dealerships, or automotive parts — classify as "automotive".
- If the business is a software company, app, SaaS platform, or tech service — classify as "saas".
- If the business provides professional services (consulting, legal, accounting, marketing agency, education, healthcare) — classify as "services".
- If none of the above match clearly — classify as "general".

Output ONLY the single lowercase category string (e.g. "real_estate"). No explanation, no quotes, no extra text.`;

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
      id: 'editorial_archdigest',
      name: 'Architectural Digest Editorial',
      lighting: 'Golden Hour warm sunlight casting soft linear architectural shadows',
      composition: 'Dramatic asymmetrical low-angle architectural perspective with off-center hero framing and high-end luxury editorial spacing',
      typography: 'Elegant serif headline paired with refined minimalist geometric sub-headers',
      promptInstructions: 'DESIGN ARCHETYPE: Architectural Digest Editorial. Create a dramatic, asymmetrical visual composition with low-angle perspective, refined luxury spacing, elegant serif headers, and warm golden hour sunlight.'
    },
    {
      id: 'bold_billboard',
      name: 'Bold High-Converting Social Billboard',
      lighting: 'Crisp bright high-exposure morning sunlight with vibrant contrast',
      composition: 'High-impact promotional layout featuring bold benefit badges, sharp geometric color blocks, and high visual contrast',
      typography: 'Ultra-bold geometric sans-serif lettering with prominent size hierarchy and badge overlays',
      promptInstructions: 'DESIGN ARCHETYPE: Bold High-Converting Social Billboard. Create a high-energy, vibrant promotional ad layout with prominent benefit badges, bold geometric typography, and crisp commercial lighting.'
    },
    {
      id: 'scandinavian_minimalist',
      name: 'Minimalist Scandinavian Luxury',
      lighting: 'Soft diffused natural daylight with airy white-balanced highlights',
      composition: 'Ultra-clean minimalist layout with generous negative space, understated framing, and soft translucent backdrop cards',
      typography: 'Minimalist lightweight geometric sans-serif typography with generous kerning and letter spacing',
      promptInstructions: 'DESIGN ARCHETYPE: Minimalist Scandinavian Luxury. Create an ultra-clean, serene layout with generous negative space, soft ambient daylight, and minimal geometric typography.'
    },
    {
      id: 'cinematic_lifestyle',
      name: 'Cinematic Lifestyle Story',
      lighting: 'Warm ambient filmic sunlight with natural lens flare and soft atmospheric glow',
      composition: 'Candid lifestyle hero shot with soft shallow depth-of-field background, warm organic textures, and cinematic 35mm photography feel',
      typography: 'Subtle, modern luxury serif header integrated cleanly into the natural scene composition',
      promptInstructions: 'DESIGN ARCHETYPE: Cinematic Lifestyle Story. Create a warm, candid 35mm film-style photography scene with shallow depth of field, organic textures, and natural lifestyle framing.'
    },
    {
      id: 'glassmorphism_infographic',
      name: 'Premium Glassmorphism & Infographic Card',
      lighting: 'Bright studio lighting with subtle translucent reflections and 3D depth highlights',
      composition: 'Modern tech-forward layout featuring floating frosted glass specs cards (highlighting key features, location, and BHK details) with 3D shadow depth',
      typography: 'Clean modern sans-serif typography on translucent glass backdrop pills',
      promptInstructions: 'DESIGN ARCHETYPE: Premium Glassmorphism & Infographic Card. Create a modern layout featuring floating frosted glass cards for property highlights and key metrics, with rich 3D depth and clean modern typography.'
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
  seedString?: string
): HumanPersona {
  const combinedText = `${propertyTitle || ''} ${propertyDescription || ''} ${userInstructions || ''}`.toLowerCase();

  const isCommercial = /\b(office|commercial|retail|shop|co-working|business|desk|workspace|store|industrial)\b/.test(combinedText);
  const isStudioOr1BHK = /\b(1bhk|1 bhk|studio|studio apartment|1 bed|single)\b/.test(combinedText);
  const isFamilyProperty = /\b(3bhk|4bhk|5bhk|villa|kothi|bungalow|duplex|penthouse|family|townhouse)\b/.test(combinedText);
  const isLand = /\b(plot|plots|farmland|land|farmhouse|acres|bigha)\b/.test(combinedText);

  const personas: HumanPersona[] = [
    {
      id: 'solo_professional',
      name: 'Single Independent Buyer / Professional',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include a close-up portrait shot (chest up) of a stylish, confident young independent professional or entrepreneur (man or woman in late 20s or 30s) in smart casual attire (e.g. linen shirt or blazer) showing a candid, genuine smile of joy while holding a coffee cup or sitting near a sunlit window. Authentic skin textures with fine pores, avoid airbrushed look.'
    },
    {
      id: 'young_family',
      name: 'Young Modern Family',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include a warm portrait shot of a happy, attractive young modern family (parents in 30s with a young child) sharing a cheerful, authentic moment of laughter together in a bright, modern living area. Authentic photorealistic expressions and real skin textures.'
    },
    {
      id: 'solo_lifestyle',
      name: 'Solo Lifestyle Aspirant',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include a candid portrait shot of a relaxed individual (early 30s) enjoying a peaceful morning coffee on a sunlit balcony or reading near a floor-to-ceiling glass window, conveying tranquility and aspirational luxury living.'
    },
    {
      id: 'modern_couple',
      name: 'Modern Elegant Couple',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include a portrait of a modern, stylish couple (late 20s or 30s) sharing an authentic, unposed moment of laughter and affection on a terrace or living area. Authentic facial detailing and natural skin textures.'
    },
    {
      id: 'mature_homeowner',
      name: 'Mature Luxury Homeowner',
      hasHumans: true,
      promptDirective: 'HUMAN PERSONA: Include a portrait of a successful, distinguished homeowner or investor (40s-50s) in elegant casual attire enjoying a serene moment in a high-end luxury space, expressing success and peaceful satisfaction.'
    },
    {
      id: 'no_humans',
      name: 'Pure Architectural & Interior Focus (No Humans)',
      hasHumans: false,
      promptDirective: 'HUMAN PERSONA (STRICT DIRECTIVE): Do NOT include any humans or people in this creative image. Focus 100% of the visual spotlight on the gorgeous property architecture, luxury interior design, crisp lighting, and graphic typography overlays.'
    }
  ];

  if (isCommercial) {
    const commercialOptions = [personas[0], personas[4], personas[5]];
    return commercialOptions[Math.floor(Math.random() * commercialOptions.length)];
  }
  if (isStudioOr1BHK) {
    const soloOptions = [personas[0], personas[2], personas[3], personas[5]];
    return soloOptions[Math.floor(Math.random() * soloOptions.length)];
  }
  if (isFamilyProperty) {
    const familyOptions = [personas[1], personas[3], personas[4], personas[5]];
    return familyOptions[Math.floor(Math.random() * familyOptions.length)];
  }
  if (isLand) {
    const landOptions = [personas[5], personas[4], personas[1]];
    return landOptions[Math.floor(Math.random() * landOptions.length)];
  }

  let seed = 0;
  const combinedStr = (seedString || '') + Math.random().toString();
  for (let i = 0; i < combinedStr.length; i++) {
    seed = (seed * 37 + combinedStr.charCodeAt(i)) % 1000000;
  }
  const index = Math.abs(seed) % personas.length;
  return personas[index];
}
