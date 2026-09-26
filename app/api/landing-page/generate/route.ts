import { NextResponse } from 'next/server'

export const maxDuration = 60
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { callDeepSeekWithUsage, callGeminiWithUsage } from '@/utils/external-apis'
import { hasEnoughCredits, calculateLLMCost, deductCreditsByCost } from '@/utils/credits'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        let user: any = null
        const mockUserHeader = request.headers.get('x-mock-user')
        if (process.env.NODE_ENV === 'development' && mockUserHeader) {
            console.log(`[Lander API] Dev mode auth bypass active. Using mock user: ${mockUserHeader}`);
            user = { id: mockUserHeader }
        } else {
            const { data: authData } = await supabase.auth.getUser()
            user = authData?.user
        }
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
        let targetUserId = user.id

        const url = new URL(request.url)
        const impersonateId = url.searchParams.get('impersonate')
        
        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    const isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId)
                    const { data: subAccount } = await supabase
                        .from('profiles')
                        .select('id')
                        .eq('id', impersonateId)
                        .eq('agency_id', currentProfile?.agency_id || user.id)
                        .single()

                    if (isParent || subAccount) {
                        targetUserId = impersonateId
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
                    }
                } else {
                    targetUserId = impersonateId
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
            }
        }

        const body = await request.json()
        const { 
            id,
            slug: requestSlug,
            productName, 
            context, 
            propertyId,
            customInstructions,
            formId, 
            mode = 'generate', 
            instructions, 
            currentHtml,
            imageUrls,
            pageType = 'standard',
            industry = 'general',
            designTheme = 'modern'
        } = body

        // Check credit balance dynamically (must have enough credits for generation / editing)
        const requiredCredits = 1 

        const hasCredits = await hasEnoughCredits(supabaseAdmin, targetUserId, requiredCredits)
        if (!hasCredits) {
            return NextResponse.json({ 
                error: `Insufficient credits. You need at least ${requiredCredits} Nobo Credits to perform this AI generation step.` 
            }, { status: 402 })
        }

        // 1. Fetch business profile details for automatic contact pre-fill & branding
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, contact_number, email, custom_domain, brand_color, logo_url, mission_statement')
            .eq('id', targetUserId)
            .maybeSingle()

        if (mode === 'generate' && !productName && !propertyId && pageType !== 'business') {
            return NextResponse.json({ error: "Product name, business name, or inventory listing selection is required." }, { status: 400 })
        }

        if (mode === 'edit' && (!instructions || !currentHtml)) {
            return NextResponse.json({ error: "Conversational edit instructions and current HTML code are required." }, { status: 400 })
        }

        // 2. Fetch Selected Property Inventory details if propertyId is provided or page is for entire business
        let propertyDataText = ""
        let propertyImagesList: string[] = []
        let resolvedProductName = productName || (pageType === 'business' ? (profile?.business_name || '') : "")
        let resolvedContext = context || (pageType === 'business' ? (profile?.mission_statement || '') : "")
        let propertyRera = ""
        let propertyFloorPlan = "https://i.ibb.co/NdSPkfxQ/3bhk.webp"
        let propertyPrice = ""
        let propertyYoutubeUrl = ""

        if (pageType === 'business') {
            const { data: activeProps } = await supabaseAdmin
                .from('properties')
                .select('*')
                .eq('user_id', targetUserId)
                .neq('show_on_landing_page', false)

            let propertyDetails = ""
            if (activeProps && activeProps.length > 0) {
                propertyDetails = activeProps.map((p, idx) => `
Listing ${idx + 1}:
- Title: ${p.title}
- Description: ${p.description || "N/A"}
- Price: ${p.price || "N/A"}
- Location: ${p.address || "N/A"}
- Image: ${p.image_url && !p.image_url.includes('placehold.co') && !p.image_url.includes('placeholder') ? p.image_url : "N/A"}
`).join('\n')
                propertyImagesList = activeProps.map(p => p.image_url).filter(img => img && !img.includes('placehold.co') && !img.includes('placeholder')) as string[]
            }

            propertyDataText = `
ACTIVE BUSINESS PRODUCTS/LISTINGS INVENTORY:
${propertyDetails || "No listings currently active."}
`
        } else if (propertyId) {
            const { data: property } = await supabaseAdmin
                .from('properties')
                .select('*')
                .eq('id', propertyId)
                .maybeSingle()
            
            if (property) {
                resolvedProductName = resolvedProductName || property.title
                resolvedContext = resolvedContext || property.description || ""
                
                propertyImagesList = (property.images || []).filter((img: string) => img && !img.includes('placehold.co') && !img.includes('placeholder'))
                if (property.image_url && !property.image_url.includes('placehold.co') && !property.image_url.includes('placeholder') && !propertyImagesList.includes(property.image_url)) {
                    propertyImagesList.unshift(property.image_url)
                }

                if (property.rera_number) {
                    propertyRera = property.rera_number
                }
                if (property.floor_plan_url && !property.floor_plan_url.includes('placehold.co') && !property.floor_plan_url.includes('placeholder')) {
                    propertyFloorPlan = property.floor_plan_url
                }
                if (property.price) {
                    propertyPrice = property.price
                }
                if (property.youtube_url) {
                    propertyYoutubeUrl = property.youtube_url
                }

                propertyDataText = `
PROPERTY INVENTORY CONTEXT:
- Title: ${property.title}
- Description: ${property.description || "N/A"}
- Price Range: ${property.price || "N/A"}
- Location/Address: ${property.address || "N/A"}
- RERA ID/Number: ${property.rera_number || "N/A"}
- Floor Plan URL: ${property.floor_plan_url || "N/A"}
- Brochure Document URL: ${property.brochure_url || "N/A"}
- YouTube Video URL: ${property.youtube_url || "N/A"}
- Property Images List: ${JSON.stringify(propertyImagesList)}
`
            }
        }

        const isIndia = (profile?.contact_number || '').includes('+91') || 
                        (profile?.contact_number || '').startsWith('91') || 
                        (resolvedContext || '').toLowerCase().includes('india') || 
                        (resolvedContext || '').toLowerCase().includes('₹') ||
                        (resolvedContext || '').toLowerCase().includes('rs.') ||
                        (resolvedProductName || '').toLowerCase().includes('bioque') ||
                        (resolvedProductName || '').toLowerCase().includes('bluesquare') ||
                        (profile?.email || '').endsWith('.in')

        const contactPhone = profile?.contact_number || "+91 98726 69935"
        const cleanPhone = contactPhone.replace(/[^0-9]/g, '')
        const businessName = profile?.business_name || resolvedProductName || "Premium Business"
        const businessEmail = profile?.email || "info@nobogent.com"
        const domainBase = profile?.custom_domain || `app.nobogent.com/shared/${targetUserId}`
        const brandColor = profile?.brand_color || "#2563eb"
        const logoUrl = profile?.logo_url || ""

        const contactInfoText = `
BUSINESS CONTACT & BRAND IDENTITY:
- Business/Brand Name: ${businessName}
- Contact Phone: ${contactPhone}
- WhatsApp Number (raw digits): ${cleanPhone}
- Contact Email: ${businessEmail}
- Canonical Domain: ${domainBase}
- Brand Primary Color: ${brandColor}
- Business Logo URL: ${logoUrl || "None provided (use styled text brand name in header)"}
- Target Market / Geography: ${isIndia ? "India (use INR ₹ currency formatting if price mentioned)" : "International"}
`

        // 3. Fetch connected form if available to enrich the prompt context
        let formFieldsText = "Full Name, WhatsApp Number, City"
        if (formId) {
            const { data: form } = await supabaseAdmin
                .from('qualification_forms')
                .select('*')
                .eq('id', formId)
                .maybeSingle()
            if (form) {
                const baseLabels = form.fields && form.fields.length > 0
                    ? form.fields.map((f: any) => f.label).join(', ')
                    : "Full Name, WhatsApp Number, City"
                formFieldsText = baseLabels

                if (Array.isArray(form.custom_questions)) {
                    const customLabels = form.custom_questions.map((q: any) => q.label).join(', ')
                    if (customLabels) formFieldsText += `, ${customLabels}`
                }
            }
        }

        // Schema.org type resolver based on industry/niche
        const resolvedIndustry = industry || (propertyId ? 'real_estate' : 'general')
        let schemaType = "LocalBusiness"
        if (resolvedIndustry === 'real_estate' || propertyId) schemaType = "RealEstateAgent"
        else if (resolvedIndustry === 'saas') schemaType = "SoftwareApplication"
        else if (resolvedIndustry === 'health') schemaType = "MedicalBusiness"
        else if (resolvedIndustry === 'agency') schemaType = "ProfessionalService"
        else if (resolvedIndustry === 'fitness') schemaType = "HealthAndBeautyBusiness"
        else if (resolvedIndustry === 'ecommerce') schemaType = "Product"

        // Theme palette definitions
        let themeDirectives = ""
        if (designTheme === 'luxury_gold') {
            themeDirectives = `
DESIGN THEME: Luxury Gold & Midnight Noir (Astro Bioque Estates style)
- Background: Deep sleek dark mode (#070C18 to #0B0F19) with luxury gold gradients (#D4AF37 to #F9E7B9).
- Text: Crisp white (#FFFFFF) and champagne gold (#F3E5AB) with slate subtitles (#94A3B8).
- Accents: 1px subtle gold borders (rgba(212, 175, 55, 0.25)) and golden glow buttons (background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%), text: #070C18 font-extrabold).
`
        } else if (designTheme === 'vibrant_bold') {
            themeDirectives = `
DESIGN THEME: Vibrant High-Energy & Dynamic Gradients
- Background: Modern high-contrast clean background (#FAFAFC) with electric violet and royal blue gradients.
- Accents: High-impact vibrant CTA buttons with subtle pulse animations, glossy badges, and energetic modern typography.
`
        } else if (designTheme === 'clean_minimal') {
            themeDirectives = `
DESIGN THEME: Swiss Minimalist & Editorial Luxury
- Background: Soft milk paper white (#FAFAFA) and warm charcoal (#111827).
- Typography: High editorial contrast, generous whitespace, refined hairline borders (#E5E7EB), and black/white micro-buttons.
`
        } else {
            themeDirectives = `
DESIGN THEME: Modern Premium SaaS & High-Converting Direct Response
- Background: Clean high-contrast slate (#F8FAFC) with pure white (#FFFFFF) elevated cards.
- Accents: Custom brand color accents based on '${brandColor}' with rich dark slate text (#0F172A) and soft shadows (box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05)).
`
        }

        // Real Estate specific instructions if applicable
        let realEstateSection = ""
        if (propertyId || resolvedIndustry === 'real_estate') {
            realEstateSection = `
REAL-ESTATE LISTING SPECIFICATIONS:
${propertyRera ? `- Prominently display verified RERA Registration Number: "${propertyRera}".` : ''}
${propertyPrice ? `- Prominently display the Price/Starting Range: "${propertyPrice}".` : ''}
- Floor Plan Section: Display floor plan "${propertyFloorPlan}" with configuration switcher buttons.
- Connectivity & Landmarks Accordion: Distances to nearby airport, highways, hospitals, and educational hubs.
- Amenities Grid: 6+ luxury amenities (Clubhouse, Swimming Pool, 24/7 Tier-3 Security, EV Charging, Landscaped Greens, High-Speed Elevators) with SVG icons.
`
        }

        let youtubeEmbedSection = ""
        if (propertyYoutubeUrl) {
            youtubeEmbedSection = `
YOUTUBE VIDEO EMBED:
- Video URL: "${propertyYoutubeUrl}"
- Embed this video in a responsive 16:9 aspect ratio container directly inside a feature showcase card.
`
        }

        // Resolve slug early
        let slug = requestSlug
        if (!slug) {
            if (pageType === 'business') {
                slug = 'index'
            } else {
                const baseSlug = (resolvedProductName || 'page')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '')
                    
                slug = mode === 'generate' 
                    ? `${baseSlug}-${Date.now().toString().slice(-4)}` 
                    : baseSlug
            }
        }

        const publicPageUrl = `https://${domainBase}/${slug}`

        // Construct DeepSeek V4.1 Flash System Prompt
        let systemPrompt = ""
        if (mode === 'generate') {
            if (pageType === 'raw_survey') {
                systemPrompt = `You are a world-class front-end engineer and direct-response architect using modern Astro JS & Tailwind CSS principles.
Generate a minimal, lightning-fast Raw Survey Qualification Page in pure HTML.

### CRITICAL GOAL:
A focused, distraction-free page with:
1. Header callout text with bold value proposition.
2. 2-3 product images in a responsive grid or header banner. (Images: ${JSON.stringify(propertyImagesList)}).
3. The dynamic lead qualification container EXACTLY like this:
   '<div id="qualification-form-container" data-page-type="survey" data-button-text="Next"></div>'
   Do NOT write form inputs or buttons inside this container; the platform injects them inline dynamically.

### GOOGLE SEO & LLM OPTIMIZATION (ASTRO STANDARD):
- Full semantic <head> with <title>, <meta name="description">, <meta name="robots" content="index, follow, max-image-preview:large">.
- Schema.org JSON-LD structured data ("@type": "${schemaType}") with business info.
- Google Fonts (Outfit, Inter) and Tailwind CDN.

### OUTPUT FORMAT:
- Return ONLY valid HTML starting with "<!DOCTYPE html>" and ending with "</html>".
- ABSOLUTELY NO markdown code blocks (\`\`\`html). Output pure raw HTML.`
            } else if (pageType === 'survey') {
                systemPrompt = `You are an elite front-end developer and conversion copywriter.
Generate a high-converting, single-card Survey & Qualification Page in pure HTML.

### LAYOUT STRUCTURE:
- Fullscreen centered card layout on a clean backdrop.
- At the top of the card: Visual showcase of "${resolvedProductName}" (Images: ${JSON.stringify(propertyImagesList)}).
- Directly beneath the visuals inside the card: The qualification container:
  '<div id="qualification-form-container" data-page-type="survey" data-button-text="Next"></div>'
  Do NOT write form elements inside; the platform injects the questions immediately inline.
- Underneath the form container: 3 brief bullet points of why to apply (zero risk, immediate response, privacy protected).
- Mobile sticky Call & WhatsApp buttons.

### GOOGLE SEO & LLM OPTIMIZATION:
- Semantic <head> with <title>, <meta name="description">, OpenGraph, Twitter, and Schema.org JSON-LD.
- Return ONLY the raw HTML string starting with "<!DOCTYPE html>" and ending with "</html>". No markdown blocks.`
            } else if (pageType === 'business') {
                systemPrompt = `You are a world-class web architect and Astro JS expert.
Generate a complete, responsive, full-feature business website homepage in pure HTML for "${businessName}".

### BUSINESS IDENTITY & CONTEXT:
${contactInfoText}
Mission & Services: "${resolvedContext}"
${propertyDataText}
${themeDirectives}

### CORE SECTIONS REQUIRED:
1. **Sticky Header / Navigation**:
   - Logo / Business Name
   - Nav anchors: Services, Featured Listings/Products, About, FAQs, Contact
   - Primary Call CTA button ("Call Now" or "Book Consultation")
2. **Hero Section (Hormozi Value Equation)**:
   - Trust Badge ("⭐ Top Rated | Verified Excellence")
   - Dream Outcome H1 Headline (Clear value, no fluff)
   - Frictionless Sub-headline
   - Dual CTAs: Primary ("Explore Portfolio" or "Connect with Us") + Secondary ("Watch Video" / "Call Us")
   - 3 Trust Checkmarks / Risk Reversal badges
3. **Key Stats & Social Proof Banner**:
   - 4 compelling statistics (e.g. "10+ Years Experience", "1,200+ Satisfied Clients", "₹500Cr+ Portfolio Delivered", "4.9/5 Average Rating")
4. **Services / Value Proposition Grid**:
   - 3-4 structured cards with custom inline SVG icons detailing core offerings and client benefits.
5. **Dynamic Products / Inventory Showcase Container (MANDATORY)**:
   - You MUST place EXACTLY this structural container:
     '<div id="business-products-container"></div>'
     The platform dynamically injects the active products / property catalog grid into this container.
6. **"Wall of Love" Social Proof Grid**:
   - 3 genuine-sounding client testimonials with reviewer names, roles/locations, and 5-star ratings.
7. **Interactive FAQ Accordion**:
   - 4-5 common questions answered with a working inline JavaScript toggle function \`toggleFaq(btn)\`.
8. **Lead Capture & Contact Section**:
   - Enclose the qualification container:
     '<div id="qualification-form-container" data-page-type="standard" data-button-text="Submit Enquiry"></div>'
9. **Mobile Bottom Floating Bar**:
   - Sticky bar on mobile with Call Now (\`tel:${cleanPhone}\`) and WhatsApp (\`https://wa.me/${cleanPhone}\`).
10. **Semantic Footer**:
    - Logo, description, contact details, navigation links, and copyright notice.

### GOOGLE SEO & LLM OPTIMIZATION (ASTRO STANDARD):
- Full semantic tags (<header>, <nav>, <main>, <section>, <article>, <footer>).
- Complete <head> with <title>, <meta name="description">, <meta name="robots" content="index, follow, max-image-preview:large">, canonical link "${publicPageUrl}", OpenGraph, and Twitter tags.
- Schema.org JSON-LD structured data with "@graph" including:
  * Primary "@type": "${schemaType}" with business details.
  * "@type": "FAQPage" with question and acceptedAnswer entities matching on-page FAQs.
- Return ONLY valid HTML starting with "<!DOCTYPE html>" and ending with "</html>". No markdown blocks.`
            } else {
                // High-Converting Full-Length Standard Landing Page (Alex Hormozi Framework & Industry Standard)
                systemPrompt = `You are a world-class front-end developer, Astro JS architect, and direct-response marketing master.
Generate a comprehensive, full-length, high-converting landing page in pure HTML for "${resolvedProductName}".

### CONTEXT & BUSINESS IDENTITY:
* Offer/Service: "${resolvedProductName}"
* Industry / Niche: "${resolvedIndustry}"
* Offer Context: "${resolvedContext}"
* Custom Directives: "${customInstructions || 'Create an irresistible, high-converting, long-form presentation'}"
${contactInfoText}
${propertyDataText}
${realEstateSection}
${youtubeEmbedSection}
${themeDirectives}

### TOKEN BUDGET & COMPLETION MANDATE (CRITICAL):
- Keep the <head> clean, concise, and token-efficient. Preconnect Google Fonts (Outfit, Plus Jakarta Sans), load Tailwind CDN (<script src="https://cdn.tailwindcss.com"></script>), and add a compact Schema.org JSON-LD ("@type": "${schemaType}"). Do NOT dump hundreds of duplicate FAQ lines into the Schema in <head>.
- Do NOT write bloated custom CSS animations or repetitive CSS keyframes; use Tailwind classes directly.
- Use clean, concise 1-2 line inline SVGs for icons.
- You MUST thoroughly write ALL 12 sections listed below from start to finish.
- You MUST ALWAYS conclude cleanly with "</body></html>" without cutting off.

### MANDATORY FULL-LENGTH 12-SECTION STRUCTURE:
1. **Sticky Header / Navigation**:
   - Brand logo or styled brand title ("${businessName}"), navigation links (Overview, Pathway, Features, Compare, Reviews, FAQs), phone call link ("${contactPhone}"), and primary CTA button ("Free Assessment" or "Book Consultation").
2. **Hero Section (Hormozi Value Equation - Dream Outcome)**:
   - Trust Pill Badge (e.g. "⭐ Rated 4.9/5 by 1,200+ Clients · 98.4% Historic Approval").
   - Dream-Outcome H1 Headline: Articulate the ultimate goal with zero fluff (e.g. "Achieve Your [Outcome] Without [Pain/Rejection] in [Timeframe]").
   - Frictionless Sub-headline explaining how the expert process eliminates anxiety and delays.
   - 3 Trust Checkmarks (e.g. "100% Transparency", "Zero Obligation Consultation", "Direct Expert Handling").
   - Dual Call-to-Action Buttons:
     * Primary CTA: "Claim Your Free Consultation →" with \`onclick="document.getElementById('qualification-form-container')?.scrollIntoView({ behavior: 'smooth' })"\`
     * Secondary CTA: "Chat on WhatsApp" (\`https://wa.me/${cleanPhone}\`)
   - Hero Media: Showcase card with provided visuals (${JSON.stringify(propertyImagesList)}) or a high-converting offer badge card.
3. **Key Stats & Authority Marquee**:
   - 4 compelling statistics in a high-contrast proof banner (e.g., "98.4% Success Rate", "1,200+ Successful Cases", "4 Key Pathways", "10-14 Months Avg").
   - "Recognized & Aligned With" logo/text marquee with relevant regulatory or governing bodies.
4. **The Problem & Cost of Inaction ("Why Most Applicants Struggle or Get Rejected")**:
   - 3 deep-dive problem cards exposing common pitfalls (e.g., rule changes, miscalculated criteria/NOC codes, missed deadlines, rejection risks).
   - High-impact copy contrasting the cost of trial-and-error vs expert legal strategy.
5. **The Signature 4-Step Strategic Roadmap / Pathway**:
   - A visual 4-step process from initial audit to final success:
     * Step 1: In-depth Profile Diagnostic & Eligibility Strategy
     * Step 2: Documentation & Credential Fast-Tracking
     * Step 3: Targeted Category & Nomination Maximization
     * Step 4: Final Submission, Verification & Approval
6. **Comprehensive 6-Card Features & Deliverables Grid**:
   - 6 rich cards with outcome-driven descriptions and clean inline SVG icons:
     1) Comprehensive Strategic Optimization & Bonus Points Audit
     2) Expedited Credential Assessment & Evaluation Support
     3) Targeted Category & High-Demand Stream Prioritization
     4) Certified / Expert Legal Supervision & Quality Review
     5) Fast-Track Document Preparation & Police/Medical Coordination
     6) Dedicated 1-on-1 Senior Case Manager Support
7. **Side-by-Side Comparison Matrix ("Why Us vs Traditional Agencies vs Doing It Alone")**:
   - A clean, modern HTML table or 3-column card comparison covering Approval Rate, Personalized Strategy, Turnaround Time, Milestone Pricing, and Dedicated Support.
8. **"Wall of Love" (4 Detailed Client Case Studies & Testimonials)**:
   - 4 authentic-sounding client success stories with client names, roles/locations, metrics (e.g. CRS jump or timeline), quotes, and 5-star ratings.
9. **Transparent Investment & Milestone Pricing Overview**:
   - A clear card presenting the transparent fee structure (e.g. Starting from ₹75,000, 100% milestone-based, no hidden costs).
10. **Interactive FAQ Accordion (6 High-Value Objections)**:
    - 6 detailed questions and answers handling top customer hesitation (timelines, job offer requirements, point cutoffs, payment milestones, eligibility guarantees, documentation checklists).
    - Include the working inline toggle script:
      \`<script>function toggleFaq(btn){const c=btn.nextElementSibling;const ic=btn.querySelector('.faq-icon');if(c)c.classList.toggle('hidden');if(ic)ic.classList.toggle('rotate-180');}</script>\`
11. **Lead Qualification & Consultation Section**:
    - An elevated, high-converting card enclosing EXACTLY this structural container:
      '<div id="qualification-form-container" data-button-text="Claim Your Free Consultation"></div>'
    - Do NOT write form elements inside; the platform injects them automatically.
12. **Mobile Sticky Quick-Action Bar & Semantic Footer**:
    - Sticky bottom bar visible on mobile (< 640px) with Call Now (\`tel:${cleanPhone}\`) and WhatsApp (\`https://wa.me/${cleanPhone}\`).
    - Full footer with brand info, legal disclaimers, contact email, phone, and copyright notice.

### OUTPUT FORMAT:
- Return ONLY valid HTML starting with "<!DOCTYPE html>" and ending with "</html>".
- ABSOLUTELY DO NOT wrap the output in markdown code blocks (\`\`\`html). Output pure raw HTML string.`
            }
        } else {
            // Edit mode
            const isExpansionRequested = 
                /length|longer|extend|expand|short|more section|detailed|flesh out|add more|comprehensive/i.test(instructions || '') ||
                (currentHtml && currentHtml.length < 16000)

            systemPrompt = `You are a master front-end developer, Astro JS architect, and direct-response marketing expert.
You are updating an existing landing page according to the user's instructions.

USER INSTRUCTIONS:
"${instructions}"

PAGE CONTEXT & BRAND:
* Offer/Product: "${resolvedProductName}"
* Business Name: "${businessName}"
* Context & Benefits: "${resolvedContext}"
${contactInfoText}
${propertyDataText}
${realEstateSection}
${youtubeEmbedSection}
${themeDirectives}
${imageUrls && imageUrls.length > 0 ? `* Attached Reference Images: ${JSON.stringify(imageUrls)}` : ''}

CURRENT HTML:
${currentHtml}

${isExpansionRequested ? `
CRITICAL EXPANSION MANDATE:
The user specifically requested a lengthy, expansive, and comprehensive landing page.
Ensure the landing page is a rich, full-length presentation with ALL 12 sections:
1. Sticky Navigation Bar
2. Hormozi-style Dream-Outcome Hero Section with dual CTAs and badges
3. Key Stats Proof Banner (4 metrics) and Authority Marquee
4. Problem Deep-Dive (3 in-depth cards on why applicants struggle or get delayed)
5. 4-Step Strategic Roadmap
6. 6 In-Depth Feature & Deliverable Cards with icons
7. Side-by-Side Comparison Table ("Why Us vs Others vs Doing It Alone")
8. "Wall of Love" (4 detailed client case studies with star ratings)
9. Transparent Investment & Milestone Pricing Overview
10. 6 Interactive FAQs with working toggle script (\`toggleFaq\`)
11. Qualification container: '<div id="qualification-form-container" data-button-text="..."></div>'
12. Mobile Sticky Call/WhatsApp Bar & full Footer.
` : `
Apply the user's requested modifications accurately while preserving the existing layout, styles, and full-length structure.
`}

CRITICAL RULES:
1. Preserve the structural container '<div id="qualification-form-container" ...></div>' and '<div id="business-products-container"></div>' (and all their attributes).
2. Keep <head> token-efficient (Google Fonts, Tailwind CDN, compact config, no bloated custom CSS).
3. Budget tokens so you complete every section and ALWAYS terminate cleanly with "</body></html>".
4. Return ONLY valid, complete HTML. ABSOLUTELY NO markdown code blocks (\`\`\`html). Output pure raw HTML string.`
        }

        const payload: any = {
            user_id: targetUserId,
            slug,
            title: `${resolvedProductName || 'Offer'} | ${businessName}`,
            product_name: resolvedProductName || businessName,
            html_content: mode === 'edit' ? currentHtml : '<!-- Generating page content with DeepSeek V4.1 Flash... -->',
            form_id: formId || null,
            updated_at: new Date().toISOString()
        }
        if (id) {
            payload.id = id
        } else {
            payload.created_at = new Date().toISOString()
        }

        // Create or update record in public.landing_pages first
        const { data: pageRecord, error: dbError } = await supabaseAdmin
            .from('landing_pages')
            .upsert(payload, {
                onConflict: id ? 'id' : 'user_id, slug'
            })
            .select()
            .single()

        if (dbError) {
            console.error("❌ Failed to save landing page:", dbError)
            return NextResponse.json({ error: "Failed to persist landing page to database: " + dbError.message }, { status: 500 })
        }

        // Create a tracking record in campaign_jobs
        const { data: job, error: jobErr } = await supabaseAdmin
            .from('campaign_jobs')
            .insert({
                user_id: user.id,
                target_user_id: targetUserId,
                status: 'processing',
                payload: {
                    type: 'landing_page_generation',
                    model: 'deepseek-v4.1-flash',
                    mode,
                    page_id: pageRecord.id,
                    product_name: resolvedProductName,
                    slug
                }
            })
            .select()
            .single()

        if (jobErr) {
            console.error("❌ Failed to create tracking campaign job:", jobErr)
            return NextResponse.json({ error: "Failed to initialize background task tracking." }, { status: 500 })
        }

        // Execute DeepSeek V4.1 Flash generation (with Gemini fallback for 100% reliability)
        let cleanedHtml = mode === 'edit' ? currentHtml : ''
        try {
            console.log(`[Lander API] Calling DeepSeek V4.1 Flash for job ${job.id} / page ${pageRecord.id} in mode: ${mode}...`)
            let aiRawResult = ""
            let usedModel = "deepseek-chat"
            let promptTokens = 0
            let completionTokens = 0

            try {
                const dsRes = await callDeepSeekWithUsage(systemPrompt, {
                    system: "You are a world-class front-end developer, Astro JS architect, and direct-response marketing expert specializing in high-converting landing pages and websites.",
                    maxTokens: 8192,
                    temperature: 0.35,
                    model: "deepseek-chat"
                })
                aiRawResult = dsRes.text
                usedModel = dsRes.modelName
                promptTokens = dsRes.promptTokens
                completionTokens = dsRes.completionTokens
                console.log(`[Lander API] DeepSeek Flash generation completed (${promptTokens} prompt tokens, ${completionTokens} completion tokens).`)

                // If output was truncated before </html>, trigger seamless continuation to complete remaining sections
                if (!aiRawResult.includes('</html>')) {
                    console.log(`[Lander API] Output truncated before </html>. Executing seamless DeepSeek Flash continuation...`)
                    try {
                        const continuationPrompt = `You are a master front-end developer and Astro JS architect.
You were generating this high-converting landing page in pure HTML, but your output reached the token limit right here:

\`\`\`html
${aiRawResult.slice(-1200)}
\`\`\`

CONTINUATION MANDATE:
Continue generating the remaining sections starting EXACTLY from where you stopped.
Ensure you complete:
- Any in-progress section
- Pricing / Offer breakdown
- The 6-Question Interactive FAQ Accordion (with toggleFaq script)
- The Lead Qualification container: '<div id="qualification-form-container" data-button-text="..."></div>'
- The Mobile Sticky Call/WhatsApp bar and Semantic Footer
- Terminate cleanly with </body></html>.

Output ONLY raw HTML continuing from the cutoff. Do NOT repeat previous text. Do NOT wrap in markdown code blocks.`

                        const contRes = await callDeepSeekWithUsage(continuationPrompt, {
                            system: "You are a master front-end developer specializing in complete, high-converting landing pages.",
                            maxTokens: 4096,
                            temperature: 0.35,
                            model: "deepseek-chat"
                        })

                        if (contRes.text) {
                            aiRawResult += '\n' + contRes.text
                            promptTokens += contRes.promptTokens
                            completionTokens += contRes.completionTokens
                            console.log(`[Lander API] Continuation succeeded. Added ${contRes.text.length} chars. Total length: ${aiRawResult.length}`)
                        }
                    } catch (contErr: any) {
                        console.warn(`[Lander API] Continuation attempt failed: ${contErr.message}`)
                    }
                }
            } catch (dsErr: any) {
                console.warn(`[Lander API] DeepSeek Flash failed, falling back to Gemini. Error: ${dsErr.message}`)
                const geminiRes = await callGeminiWithUsage(systemPrompt, imageUrls)
                aiRawResult = geminiRes.text
                usedModel = geminiRes.modelName
                promptTokens = geminiRes.promptTokens
                completionTokens = geminiRes.completionTokens
            }

            // Deduct credits dynamically based on token usage
            const generateInr = calculateLLMCost(usedModel, promptTokens, completionTokens)
            await deductCreditsByCost(supabaseAdmin, targetUserId, generateInr, 'ai_generation', `AI Landing Page - DeepSeek Flash Generation (${mode})`)

            // Clean markdown formatting if LLM wrapped in code block
            const htmlResult = aiRawResult
                .replace(/^```html\s*/i, '')
                .replace(/^```\s*/, '')
                .replace(/\s*```$/, '')
                .trim()

            // Normalize spaces
            cleanedHtml = htmlResult.replace(/\u00a0/g, ' ')

            // Ensure DOCTYPE exists
            if (!cleanedHtml.toLowerCase().includes('<!doctype html>')) {
                cleanedHtml = `<!DOCTYPE html>\n${cleanedHtml}`
            }

            // Auto-heal truncated HTML if model ended before closing tags
            if (!cleanedHtml.includes('</html>')) {
                console.warn(`[Lander API] Output was truncated by token limit. Healing and appending required closing sections...`);
                // Strip dangling partial tag at the end (e.g. <span class="font-extrab)
                cleanedHtml = cleanedHtml.replace(/<[^>]*$/, '').trim();

                // Guarantee qualification form container
                if (!cleanedHtml.includes('id="qualification-form-container"')) {
                    cleanedHtml += `\n<!-- Qualification Container Injected by Nobogent Studio -->\n<section id="inquiry" class="py-16 px-4 bg-slate-50 dark:bg-slate-900/50">\n    <div class="max-w-xl mx-auto">\n        <div id="qualification-form-container" data-page-type="${pageType}" data-button-text="Submit Details"></div>\n    </div>\n</section>\n`;
                }

                // Guarantee FAQ script if toggleFaq is present
                if (cleanedHtml.includes('toggleFaq') && !cleanedHtml.includes('function toggleFaq')) {
                    cleanedHtml += `\n<script>\nfunction toggleFaq(btn) {\n    const content = btn.nextElementSibling;\n    const icon = btn.querySelector('.faq-icon');\n    if (content) content.classList.toggle('hidden');\n    if (icon) icon.classList.toggle('rotate-180');\n}\n</script>\n`;
                }

                // Guarantee mobile floating sticky bar
                if (!cleanedHtml.includes(`tel:${cleanPhone}`)) {
                    cleanedHtml += `\n<div class="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 sm:hidden z-40 flex gap-2">\n    <a href="tel:${cleanPhone}" class="flex-1 bg-slate-900 text-white text-xs font-bold py-3 rounded-xl text-center">Call Now</a>\n    <a href="https://wa.me/${cleanPhone}" target="_blank" class="flex-1 bg-emerald-600 text-white text-xs font-bold py-3 rounded-xl text-center">WhatsApp</a>\n</div>\n`;
                }

                cleanedHtml += `\n</body>\n</html>`;
            } else {
                // Document completed normally - ensure critical platform hooks are present
                if (!cleanedHtml.includes('id="qualification-form-container"')) {
                    const containerSnippet = `\n<!-- Qualification Container Injected by Nobogent Studio -->\n<section id="inquiry" class="py-16 px-4 bg-slate-50 dark:bg-slate-900/50">\n    <div class="max-w-xl mx-auto">\n        <div id="qualification-form-container" data-page-type="${pageType}" data-button-text="Submit Details"></div>\n    </div>\n</section>\n`
                    if (cleanedHtml.includes('<footer')) {
                        cleanedHtml = cleanedHtml.replace('<footer', `${containerSnippet}<footer`)
                    } else if (cleanedHtml.includes('</body>')) {
                        cleanedHtml = cleanedHtml.replace('</body>', `${containerSnippet}</body>`)
                    } else {
                        cleanedHtml += containerSnippet
                    }
                }

                if (cleanedHtml.includes('toggleFaq') && !cleanedHtml.includes('function toggleFaq')) {
                    const faqScript = `\n<script>\nfunction toggleFaq(btn) {\n    const content = btn.nextElementSibling;\n    const icon = btn.querySelector('.faq-icon');\n    if (content) content.classList.toggle('hidden');\n    if (icon) icon.classList.toggle('rotate-180');\n}\n</script>\n`
                    if (cleanedHtml.includes('</body>')) {
                        cleanedHtml = cleanedHtml.replace('</body>', `${faqScript}</body>`)
                    } else {
                        cleanedHtml += faqScript
                    }
                }

                if (cleanedHtml.includes('openQualificationModal') && !cleanedHtml.includes('function openQualificationModal')) {
                    const modalScript = `\n<script>\nfunction openQualificationModal() {\n    const el = document.getElementById('qualification-form-container') || document.getElementById('survey-wizard-container');\n    if (el) {\n        el.scrollIntoView({ behavior: 'smooth' });\n    } else if (typeof window.openModal === 'function') {\n        window.openModal();\n    }\n}\n</script>\n`
                    if (cleanedHtml.includes('</body>')) {
                        cleanedHtml = cleanedHtml.replace('</body>', `${modalScript}</body>`)
                    } else {
                        cleanedHtml += modalScript
                    }
                }
            }

            // Save final HTML content to landing page
            const { error: pageUpdateErr } = await supabaseAdmin
                .from('landing_pages')
                .update({
                    html_content: cleanedHtml,
                    updated_at: new Date().toISOString()
                })
                .eq('id', pageRecord.id)

            if (pageUpdateErr) {
                throw pageUpdateErr
            }

            // Update job status to completed
            await supabaseAdmin
                .from('campaign_jobs')
                .update({
                    status: 'completed',
                    updated_at: new Date().toISOString()
                })
                .eq('id', job.id)

            console.log(`[Lander API] Successfully generated and updated landing page ${pageRecord.id}`)
        } catch (genError: any) {
            console.error(`[Lander API] Generation error for job ${job.id}:`, genError)
            
            await supabaseAdmin
                .from('campaign_jobs')
                .update({
                    status: 'failed',
                    message: genError.message || "Landing page generation failed.",
                    updated_at: new Date().toISOString()
                })
                .eq('id', job.id)

            if (!cleanedHtml || cleanedHtml.includes('Generating page content')) {
                // High-converting, Astro-ready responsive fallback template
                cleanedHtml = `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
    <title>${resolvedProductName || 'Offer'} | ${businessName}</title>
    <meta name="description" content="Discover exclusive offerings from ${businessName}. Contact our specialists today.">
    <meta name="robots" content="index, follow, max-image-preview:large">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        brand: '${brandColor}'
                    },
                    fontFamily: {
                        sans: ['Plus Jakarta Sans', 'sans-serif'],
                        display: ['Outfit', 'sans-serif']
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-slate-50 text-slate-900 font-sans antialiased max-w-full overflow-x-hidden">
    <header class="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80 py-4 px-4 sm:px-8">
        <div class="max-w-6xl mx-auto flex justify-between items-center">
            <div class="font-display font-black text-xl text-slate-900">${businessName}</div>
            <div class="flex items-center gap-3">
                ${contactPhone ? `<a href="tel:${cleanPhone}" class="text-xs font-bold text-slate-600 hover:text-slate-900 hidden sm:inline-block">${contactPhone}</a>` : ''}
                <button onclick="document.getElementById('qualification-form-container')?.scrollIntoView({ behavior: 'smooth' })" class="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 py-2.5 rounded-full transition-all shadow-sm">Get Started</button>
            </div>
        </div>
    </header>
    <main class="max-w-5xl mx-auto px-4 py-12 sm:py-20 flex flex-col gap-12">
        <section class="text-center space-y-5 max-w-3xl mx-auto">
            <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-xs font-bold uppercase tracking-wider">
                <span>⚡ Premium Verified Offer</span>
            </div>
            <h1 class="font-display text-3xl sm:text-5xl lg:text-6xl font-black text-slate-900 leading-[1.1] tracking-tight">${resolvedProductName || 'Exclusive Opportunity'}</h1>
            <p class="text-slate-600 text-sm sm:text-lg leading-relaxed">${resolvedContext || 'Experience verified excellence tailored to your goals. Submit your inquiry below to connect with our team.'}</p>
        </section>
        <section class="bg-white p-6 sm:p-10 rounded-3xl border border-slate-200 shadow-xl max-w-md mx-auto w-full">
            <div id="qualification-form-container" data-button-text="Submit Details"></div>
        </section>
    </main>
    <div class="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 sm:hidden z-40 flex gap-2">
        <a href="tel:${cleanPhone}" class="flex-1 bg-slate-900 text-white text-xs font-bold py-3 rounded-xl text-center">Call Now</a>
        <a href="https://wa.me/${cleanPhone}" target="_blank" class="flex-1 bg-emerald-600 text-white text-xs font-bold py-3 rounded-xl text-center">WhatsApp</a>
    </div>
</body>
</html>`
                await supabaseAdmin
                    .from('landing_pages')
                    .update({ html_content: cleanedHtml, updated_at: new Date().toISOString() })
                    .eq('id', pageRecord.id)
            }
        }

        const updatedPageRecord = {
            ...pageRecord,
            html_content: cleanedHtml
        }

        return NextResponse.json({
            success: true,
            jobId: job.id,
            page: updatedPageRecord,
            publicUrl: publicPageUrl
        })

    } catch (error: any) {
        console.error("Lander Generate API Error:", error)
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
    }
}
