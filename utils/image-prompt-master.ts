import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

// ============================================================================
// MASTER PROMPT — Photorealistic Commercial Photography Baseline
// ============================================================================

export const MASTER_PROMPT = `You are an elite Master Advertising Designer and Creative Director with 20+ years of direct-response advertising experience at world-class performance marketing agencies. Your creatives drive multi-million-dollar high-converting sponsored ad campaigns on Meta, Instagram, and LinkedIn.

Every creative you direct must look like an agency-grade, high-converting commercial ad poster: a striking, scroll-stopping combination of authentic photorealistic commercial photography and a polished, high-authority direct-response marketing layout.

PROVEN 6-PART HIGH-CONVERTING AD POSTER ANATOMY (MANDATORY STRUCTURE):
1. TOP CONTRAST CATEGORY BANNER, OFFER PILL & LOCATION TAG:
   - A crisp, prominent contrasting header pill or upper badge bar at the top of the canvas defining the exact offering (e.g. "CANADA PERMANENT RESIDENCY", "UK SKILLED WORKER & STUDENT VISAS", "EXCLUSIVE PRE-LAUNCH LUXURY LIVING", "AI CLIENT ACQUISITION ENGINE").
   - MANDATORY LOCATION HIGHLIGHT: If location, city, sector, or address is provided (e.g. "Downtown Dubai", "Palm Jumeirah", "Sector 82 Mohali"), feature a sleek, high-visibility location tag pill (e.g. "📍 DOWNTOWN DUBAI", "📍 PRIME SECTOR 82") right near the category banner or headline.
   - Bold, uppercase geometric sans-serif lettering with generous padding for immediate scroll-stopping category recognition.

2. ASPIRATIONAL HERO STORYTELLING (55-65% of canvas):
   - Aspirational commercial photography: The hero subject (whether attractive professionals, happy clients, real property facade/interior, or tangible product) captured with authentic commercial lighting and 35mm optical depth.
   - Tangible Artifacts of Success: Characters must interact with real, tangible proof points whenever applicable (e.g., holding verified passports/visas, university admission letters, home keys, laptop with modern software dashboard, product packaging).
   - Authentic Humans & Micro-Expressions: Charismatic, relatable humans with natural skin texture, visible fine pores, and genuine, confident smiles. Ethnicity must match the target demographic/location. Strictly NO plastic, airbrushed, or synthetic AI faces.

3. HIGH-IMPACT BENEFIT HOOK HEADLINE & SUB-HEADLINE:
   - Exactly ONE dominant, punchy benefit hook headline addressing the buyer's primary aspiration or solving their core friction (e.g. "FAST-TRACK PATHWAY TO CANADA", "EXPERIENCE WORLD-CLASS CAREER OPPORTUNITIES", "LIVE. WORK. THRIVE.", "STOP PAYING YOUR LANDLORD'S MORTGAGE").
   - Clean, modern grotesque sans-serif (Inter, Helvetica, Neue Haas Grotesk) or editorial serif with high contrast and immaculate legibility.
   - One concise, high-converting sub-headline delivering clarity and momentum.

4. MANDATORY PRICE BADGE & SLEEK AUTHORITY TRUST PROOF BADGES:
   - MANDATORY PRICE HIGHLIGHT (CRITICAL FOR BUSINESS & REAL ESTATE CONVERSION): When price, starting price, payment plan, or pricing tier is available in the product info (e.g. "Starting at ₹1.2 Cr", "From AED 1,200,000", "1% Monthly Payment Plan", "$49/mo"), render a prominent, high-contrast luxury price badge / pill (e.g. deep obsidian badge with champagne gold border, or frosted white glass pill with crisp typography). Make it unmistakable and prestigious.
   - 2-3 sleek circular or pill-shaped trust proof badges that build instant credibility and social proof (e.g., "DIRECT PR VISA", "HIGH POINTS ASSESSMENT", "LICENSED & REGULATED CONSULTANTS", "FAST-TRACK PNP", "RERA APPROVED", "ZERO BROKERAGE", "FREE ASSESSMENT", "100% VERIFIED", "7-DAY TRIAL").
   - Design: Sleek, modern, vector-styled badges with clean geometric borders (gold, royal blue, or crisp contrast outlines) and bold, legible micro-typography. NOT cartoonish 3D clipart, but sophisticated corporate trust seals.

5. VALUE STACK & KEY INCLUSIONS STRIP:
   - A clean horizontal or bulleted row of 3-4 key deliverables, program tiers, or feature highlights (e.g. "• Skilled Worker  • Student Visa  • Provincial Nominee Programs" or "• 3BHK Luxury Floors  • 100% Power Backup  • Prime Connectivity").
   - High-contrast, easy-to-scan typography that provides immediate value justification.

6. PROFESSIONAL FOOTER CTA BAR & BRANDING:
   - Sleek, high-contrast footer strip at the bottom margin featuring the business name, official website URL, and direct contact phone number with clear phone icon.
   - The brand logo positioned as a pristine, razor-sharp vector mark in an upper corner with strict geometric fidelity (no smudging, melting, or blurring).
   - Official regulatory or trust mark icons (e.g., verified checkmark, licensed consultant crest, RERA tag) placed cleanly in the footer.

FORBIDDEN AMATEUR TROPES (STRICT ZERO-TOLERANCE):
- NEVER generate floating 3D glass cubes, floating green bars, or glowing neon 3D blocks.
- NEVER generate fake floating holographic stock chart lines or tacky 3D gaming icons floating in mid-air.
- NEVER generate cheap, cheesy yellow WordArt gradients or tacky bevel/emboss drop-shadows.
- Keep the overall ad layout structured, authoritative, and stunningly commercial.`;

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
The objective is to produce ultra-premium, high-converting real estate ad posters that drive site visits and qualified buyer inquiries (inspired by top-performing Meta developer campaigns and luxury architectural ads).

Visual Directives:
1. Category & Location Tag: Prominent contrast header pill (e.g. "EXCLUSIVE PRE-LAUNCH", "LUXURY RESIDENTIAL LIVING") paired with a distinct Location Pin/Tag (e.g. "📍 DOWNTOWN DUBAI", "📍 SECTOR 82 MOHALI").
2. Hero Architecture: Sun-drenched exterior facade or luxury living room overlooking lush green landscaping or city skyline, captured by an architectural photographer with warm ambient lighting. Authentic happy residents/homeowners or aspirational couple in situ holding keys or enjoying the space.
3. Hook Headline: Bold location or lifestyle hook (e.g. "STOP PAYING YOUR LANDLORD'S MORTGAGE", "LUXURY YOU CAN ACTUALLY AFFORD", "LIVE IN THE HEART OF TRICITY").
4. MANDATORY PRICE & TRUST BADGES:
   - High-contrast luxury Price Pill (e.g. "STARTING AT AED 1.2M", "FROM ₹1.2 CR*", "1% MONTHLY PAYMENT PLAN") highlighted prominently.
   - 2 to 3 sleek trust badges (e.g. "RERA APPROVED", "ZERO BROKERAGE", "PRE-LAUNCH PRICING", "100% POWER BACKUP", "FLEXIBLE PAYMENT PLAN").
5. Value Stack: Clean row of key specifications (e.g. "• Prime Location • 7-Tier Security • 35,000 Sq. Ft. Clubhouse").
6. Clean Footer: Developer logo, RERA number, website, and direct phone number in a high-contrast footer strip.`,

  services: `Vertical module — Professional Services, Visa, Immigration & Consulting (High-Converting Performance Ad):
The objective is to produce ultra-authoritative, high-converting social media ad posters for professional services, visa & immigration consultancies, law firms, and education agencies (inspired by top performance marketing campaigns).

Visual Directives:
1. Category & Location Tag: High-contrast header banner or pill (e.g. "CANADA PERMANENT RESIDENCY", "UK WORK & STUDENT VISAS") + branch location tag if applicable.
2. Hero Storytelling: Aspirational, charismatic professionals, students, or families captured with commercial studio/sunlit lighting, holding real tangible artifacts of success (e.g. valid passports, official visa approvals, university admission letters) with iconic skyline or modern office in the background.
3. Hook Headline: Bold benefit-driven hook (e.g. "EXPRESS ENTRY & VISA SERVICES - FAST TRACK PATHWAY", "YOUR FUTURE STARTS HERE", "LIVE. WORK. THRIVE. ABROAD").
4. MANDATORY PRICE/FEE & TRUST BADGES: If consultation fee or package price is provided, highlight in a prominent badge. Plus 2 to 3 sleek badges ("DIRECT PR VISA", "HIGH POINTS ASSESSMENT", "LICENSED CONSULTANTS", "FAST-TRACK FILING", "FREE ELIGIBILITY CHECK").
5. Value Stack: Clean row of 3-4 key program tiers or deliverables (e.g. "• Skilled Worker • Student Visa • Provincial Nominee Programs").
6. Clean Footer: Website URL, phone number, and official trust logos in a high-contrast footer strip.`,

  saas: `Vertical module — Technology, AI & SaaS (High-Converting B2B & B2C Ads):
The objective is agency-grade tech advertising (inspired by Stripe, Linear, Ramp, and Apple).

Visual Directives:
1. Category Tag: High-contrast header pill (e.g. "ENTERPRISE AI PLATFORM", "AUTONOMOUS GROWTH ENGINE", "ALL-IN-ONE CRM").
2. Hero Scene: Smiling modern business owner or growth executive in a sunlit contemporary workspace, experiencing genuine relief and success while holding/interacting with a sleek smartphone or laptop displaying clean modern UI metrics.
3. Hook Headline: High-impact benefit hook (e.g. "SCALE YOUR CLIENT ACQUISITION ON AUTOPILOT", "CLOSE 3X MORE DEALS WITH ZERO OVERHEAD").
4. MANDATORY PRICE & TRUST BADGES: If price or trial offer is available (e.g. "$49/MO", "STARTING AT $99", "14-DAY FREE TRIAL"), highlight in a prominent high-contrast pill alongside SOC-2 / No-Code trust badges.
5. Value Stack: Concise row of core capabilities (e.g. "• Instant 2-Min Setup • Zero Coding Required • Seamless CRM Sync").
6. Clean Footer: Web URL and CTA button in a sleek bottom bar.`,

  food: `Vertical module — Food & Restaurant:
The objective is realistic editorial food photography framed as a high-converting promotional ad. Preserve the dish, plating, and ingredients faithfully with appetite appeal. Include prominent price tag if provided (e.g. "FROM $14.99"), location address/tag, header ("CHEF'S SIGNATURE SPECIAL"), quality badges ("100% FRESH INGREDIENTS", "WOOD-FIRED AUTHENTIC", "FREE HOME DELIVERY"), and clear order CTA at the bottom.`,

  fashion: `Vertical module — Fashion & Apparel:
The objective is premium editorial fashion advertising. Preserve exact garment design, fabric texture, and fit. Models naturally posed in high-end lookbook framing with an elegant top collection banner, price badge if provided, luxury typography hook, and brand footer.`,

  beauty: `Vertical module — Beauty & Skincare:
The objective is premium beauty commercial advertising. Preserve product design and packaging. Natural healthy skin with real micro-texture in soft diffused light. Include category pill, prominent price pill if provided, trust badges ("DERMATOLOGIST TESTED", "100% ORGANIC", "CRUELTY FREE"), and purchase CTA.`,

  ecommerce: `Vertical module — Product & E-commerce:
The objective is high-converting commercial product advertising. Preserve exact product proportions, materials, and finish in a lifestyle context. Include top offer banner, prominent price/discount badge ("ONLY $29", "50% OFF TODAY"), 2-3 value badges ("FAST SHIPPING", "MONEY-BACK GUARANTEE", "TOP RATED 4.9/5"), and buy now footer.`,

  automotive: `Vertical module — Automotive:
The objective is premium automotive commercial photography. Preserve exact vehicle lines, reflections, and environmental lighting. Include model banner, price/down-payment badge if provided ("STARTING AT AED 149K" / "0% APR FINANCING"), location tag, performance badge seals, and test drive CTA.`,

  general: `Vertical module — General Commercial & Performance Marketing:
The objective is versatile, high-converting commercial advertising posters suitable for Meta and Instagram sponsored campaigns.
Visual Directives:
1. Category & Location Tag: Prominent header banner or pill identifying the service or product category + location tag if provided.
2. Hero Visual: Aspirational commercial photography showing the product or service in action with authentic human expressions and premium commercial lighting.
3. Hook Headline: Bold, compelling benefit hook headline that addresses customer desires and drives action.
4. MANDATORY PRICE BADGE: Prominently feature product price/tier if provided in a contrast luxury pill.
5. Trust Proof Badges: 2 to 3 sleek circular or pill badges highlighting verified guarantees, speed, or certification.
6. Value Stack: Clean row of 3-4 core value deliverables.
7. Clean Footer: Website URL, phone number, and brand logo in a crisp footer strip.`
};

// ============================================================================
// RENDERING PRIORITIES — Reality bias hierarchy
// ============================================================================

export const RENDERING_PRIORITIES = `Rendering priorities (highest to lowest):
1. Preserve reference image fidelity.
2. Maintain physical and architectural accuracy.
3. Achieve photographic realism.
4. Highlight Price & Location prominently if provided in product info.
5. Create an attractive commercial composition.
6. Add aesthetic enhancements only if they do not reduce realism.`;

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
- MANDATORY PRICE & LOCATION EMPHASIS: If price or location are available in the product details, highlight them prominently using the reference layout's signature badge/pill format.
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

2. MANDATORY BUSINESS HIGHLIGHTS — PRICE & LOCATION (CRITICAL FOR HIGH CONVERSION):
   - We are selling to businesses and high-intent buyers. If price (e.g., 'Starting at ₹1.2 Cr', 'From AED 1.5M', '$49/mo', '1% Monthly Payment Plan') OR location/address (e.g., 'Downtown Dubai', 'Sector 82 Mohali', 'Palm Jumeirah', 'PR7 Airport Road') is present or mentioned anywhere in the product title, description, or property specifications, they MUST be prominently featured and visually emphasized on the creative poster!
   - Price Badge: Render the price in a prominent, high-contrast luxury pill, ribbon, or tag badge (e.g. bold obsidian badge with champagne gold border, or frosted white glass pill with dark lettering). For luxury real estate/business products, format clearly with 'STARTING AT [PRICE]' or 'FROM [PRICE]' or '[PRICE] • FLEXIBLE PAYMENT PLAN'.
   - Location Tag: Render the location prominently near the property title or category bar with a clean minimalist pin icon or pill (e.g., '📍 Downtown Dubai', '📍 Sector 82 Mohali').
   - NEVER hide or bury the price or location in tiny unreadable text if they are provided. They are the #1 decision triggers for buyers.

3. MODERN PERFORMANCE AD ARCHITECTURE:
   - Structure the creative like a top-performing Meta / Instagram / LinkedIn sponsored ad poster:
     * Category & Location Tag: Clean frosted pill or micro-header at top (e.g., "GLOBAL VISA EXPERTS", "EXCLUSIVE LAUNCH", "ENTERPRISE SOLUTION") + location pin pill.
     * Hero Visual: Authentic, aspirational subject with tangible proof artifacts (passports, approval letters, keys, product packaging, premium interfaces).
     * Benefit Hook: 1 bold, high-contrast outcome-driven headline (e.g., "Move to Canada in 2026", "Own Luxury for 1% Monthly", "Scale Without the Overhead").
     * Price Badge: Prominent luxury price pill/ribbon (mandatory when price is available).
     * Trust Proof Badges: 2 to 3 sleek, modern trust chips or value pills (e.g., "Licensed & Regulated", "RERA Certified", "Free Consultation", "Fast-Track Processing", "Guaranteed Quality").
     * Footer CTA Strip: Crisp contrast bar at bottom with clear action button ("Book Assessment", "Download Brochure", "Shop Now") + contact details.
   - STRICT QUALITY STANDARD: Absolutely NO amateur clip-art, cheesy cartoon ribbons, or chaotic font mixing. Badges must be modern, minimal, executive-grade graphic design chips.

4. BUSINESS LOGO (MANDATORY BY DEFAULT — STRICT ANTI-SMUDGE):
   - The business logo MUST be integrated into the creative visually as a clean, razor-sharp brand mark.
   - Place the logo in an upper corner (top-left or top-right) with clean negative space.
   - If a logo image is provided in the input images, reproduce its exact shape, icon, and lettering cleanly.
   - STRICT ANTI-SMUDGE DIRECTIVE: Under no circumstances should the logo mark or typography be smudged, melted, warped, or distorted. Render it with crisp, clean vector-sharp edges.
   - CRITICAL: Do NOT write, print, or draw any literal text phrases, labels, or placeholders in the image such as "logo", "business logo", "put logo here", "logo here", or blank placeholder circles. The final image must be completely clean of layout instructions or design annotations.
   - EXCEPTION: Only omit the logo if the user EXPLICITLY requests "no logo" or "remove the logo" in their instructions.

5. CONTACT INFORMATION (MANDATORY BY DEFAULT):
   - If contact information (phone number, website, email, or address) is provided in the input, it MUST be included in the creative.
   - Place contact details in a clean, minimal bar or strip at the bottom of the creative, using a small, well-spaced, legible font alongside the CTA button.
   - Do NOT clutter the creative with contact info — keep it subtle and professional.
   - If NO contact info is provided in the input, do NOT fabricate any — simply omit the contact section or use the brand domain if available.
   - EXCEPTION: Only omit contact info if the user EXPLICITLY requests "no contact info" or similar in their instructions.

6. INFORMATION HIERARCHY:
   - Primary: Hero visual (product/property/service) — takes up 55-65% of the canvas, photorealistic, with real-world contextual proof.
   - Secondary: Category header pill + bold Benefit Hook headline.
   - Prominent Value/Location: High-contrast Price Badge ("Starting from...") + Location pin tag ("📍...").
   - Tertiary: 2-3 sleek Trust Proof Badges / Value Pills.
   - Foundation: Razor-sharp logo (top corner) + High-contrast Footer CTA bar (bottom strip) with contact details.`;

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
// Reverse-engineered from world-class luxury real estate and performance campaigns (Dubai reference collection).
// Ensures every creative generation has distinct design, lighting, camera angles, color palettes, and layouts.
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
      id: 'dubai_sunset_splendor',
      name: 'Dubai Sunset Splendor (Golden Hour & Bronze Skyline)',
      lighting: 'Warm golden-hour ambient sunlight casting soft linear shadows, champagne gold highlights, and a rich sunset sky with soft peach and twilight blue gradients',
      composition: 'Two-column architectural balance: Aspirational skyline or luxury terrace dominating the visual, clean left/right text alignment with generous atmospheric breathing room, prominent Location Pin Tag (e.g. "📍 DOWNTOWN DUBAI"), and a prominent Starting Price badge in champagne gold',
      typography: 'Dominant modern serif headline (Playfair / Bodoni) paired with crisp geometric sans-serif sublines, wide letter-spacing, and gold foil accents',
      promptInstructions: 'DESIGN ARCHETYPE: Dubai Sunset Splendor. Inspire from luxury Dubai skyline posters: (1) Golden-hour warm atmospheric lighting, (2) Dominant hero visual with generous sky breathing room, (3) Prominent Location Tag (e.g. "📍 DOWNTOWN DUBAI" or product location) near header, (4) Prominent luxury Price Badge (e.g. "STARTING AT [PRICE]" or "FROM [PRICE]") in champagne gold, (5) 3 key benefit icons/badges and a structured footer with logo and contact.'
    },
    {
      id: 'obsidian_gold_executive',
      name: 'Obsidian & Gold Executive (Dark Mode Luxury)',
      lighting: 'Low-key evening luxury illumination with glowing warm amber interior lighting, floor-to-ceiling glass reflections, and subtle metallic rim highlights',
      composition: 'Deep midnight obsidian/charcoal backdrop with organic curved container framing, high-contrast Starting Price pill in metallic gold border ("FROM AED 1,200,000" / "STARTING ₹1.2 CR"), Location pin below title, and a row of 4 quantitative trust metrics (e.g. "10+ Years Experience", "100% Verified Developer", "Flexible 1% Monthly Plan")',
      typography: 'Authoritative luxury serif headline paired with razor-sharp modern sans-serif white and gold typography with maximum contrast',
      promptInstructions: 'DESIGN ARCHETYPE: Obsidian & Gold Executive Dark Mode. Inspire from top-converting Dubai luxury investment ads: (1) Deep midnight charcoal/obsidian background, (2) Illuminated luxury architectural or product hero shot, (3) Prominent Starting Price badge in gold border, (4) Prominent Location pin tag, (5) 3-4 quantifiable trust badges, (6) Executive footer CTA bar.'
    },
    {
      id: 'warm_travertine_minimalist',
      name: 'Sun-Drenched Travertine & Modern Mediterranean',
      lighting: 'Crisp bright morning Mediterranean sunlight casting sharp architectural shadows on textured cream travertine limestone plaster',
      composition: 'Minimalist editorial architectural grid: Organic curved archway framing the hero subject, lush olive green landscaping, frosted glass price tag and location pill embedded into the lower architectural horizon, and generous ivory white space',
      typography: 'Clean Swiss grotesque sans-serif (Neue Haas Grotesk, Helvetica) with high kerning and understated elegance',
      promptInstructions: 'DESIGN ARCHETYPE: Sun-Drenched Travertine Minimalist. (1) Warm textured cream limestone and organic arched framing, (2) Bright natural daylight with clean geometric shadows, (3) Prominent Location pill and Starting Price tag seamlessly integrated into the composition, (4) 2 minimalist credibility chips, (5) Razor-sharp logo and contact footer.'
    },
    {
      id: 'high_authority_price_showcase',
      name: 'High-Authority Price & Location Showcase (Direct-Response Powerhouse)',
      lighting: 'Polished commercial studio daylight with vibrant natural color contrast and luminous clarity',
      composition: 'Direct-response conversion masterpiece: Top category banner, bold lifestyle hook headline, dominant high-contrast Price Ribbon ("STARTING AT [PRICE]" / "FLEXIBLE 1% PAYMENT PLAN"), prominent Location Badge ("📍 [LOCATION]"), 3 trust verification badges (e.g. "RERA Approved", "0% Commission", "Ready to Move"), and bottom CTA strip',
      typography: 'Ultra-bold modern sans-serif headline commanding immediate scroll-stopping attention with high-contrast badge lettering',
      promptInstructions: 'DESIGN ARCHETYPE: High-Authority Price & Location Showcase. (1) Category banner at top, (2) Dominant hero visual (55-65%), (3) High-contrast Price Ribbon highlighting the product price/payment terms prominently, (4) Location pin badge, (5) 3 sleek trust proof seals, (6) High-converting bottom CTA bar.'
    },
    {
      id: 'swiss_editorial_luxury',
      name: 'Swiss Modernist Editorial & White Space',
      lighting: 'Soft diffused natural daylight with high dynamic range and pristine clarity',
      composition: 'Expansive clean white negative space, asymmetrical 2-panel architecture, hero visual occupying top 65%, lower canvas holding pristine typography with prominent Price pill, Location tag, key amenity chips, and razor-sharp logo',
      typography: 'Masterful Swiss modernist typography (Neue Haas Grotesk, Inter) with disciplined grid alignment and perfect visual hierarchy',
      promptInstructions: 'DESIGN ARCHETYPE: Swiss Modernist Editorial. (1) Upper 65% hero visual, (2) Clean white/light lower canvas with generous breathing room, (3) Prominent Price & Location badge hierarchy, (4) Value stack chips, (5) Clean corporate branding footer.'
    },
    {
      id: 'panoramic_horizon_penthouse',
      name: 'Panoramic Horizon Penthouse (Ultra-Luxury Vista)',
      lighting: 'Twilight / golden hour ambient glow over city waters and illuminated skyscrapers',
      composition: 'Sweeping panoramic vista from an infinity pool or high-rise glass balcony, prominent Location highlight ("DUBAI\'S FINEST" / "PRIME LOCATION"), floating transparent glass price pill, and a structured bottom luxury bar with QR code, contact icons, and logo',
      typography: 'Refined dual typography: classic Roman serif title paired with clean modern geometric sans-serif details',
      promptInstructions: 'DESIGN ARCHETYPE: Panoramic Horizon Penthouse. (1) Sweeping high-rise vista overlooking iconic skyline/water, (2) Prominent Location headline and floating luxury price pill, (3) Refined serif/sans typography, (4) Bottom luxury contact bar with QR code scan box, phone icon, and brand mark.'
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
