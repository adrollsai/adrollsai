import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { callGemini } from '@/utils/external-apis'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
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
            productName, 
            context, 
            propertyId,
            customInstructions,
            formId, 
            mode = 'generate', 
            instructions, 
            currentHtml 
        } = body

        if (mode === 'generate' && !productName && !propertyId) {
            return NextResponse.json({ error: "Product name or inventory listing selection is required for page generation." }, { status: 400 })
        }

        if (mode === 'edit' && (!instructions || !currentHtml)) {
            return NextResponse.json({ error: "Conversational edit instructions and current HTML code are required." }, { status: 400 })
        }

        // 1. Fetch Selected Property Inventory details if propertyId is provided
        let propertyDataText = ""
        let propertyImagesList: string[] = []
        let resolvedProductName = productName || ""
        let resolvedContext = context || ""
        let propertyRera = "PBRERA-SAS79-PR0777"
        let propertyFloorPlan = "https://i.ibb.co/NdSPkfxQ/3bhk.webp"
        let propertyPrice = "₹ 1.7 Cr"

        if (propertyId) {
            const { data: property } = await supabase
                .from('properties')
                .select('*')
                .eq('id', propertyId)
                .maybeSingle()
            
            if (property) {
                resolvedProductName = resolvedProductName || property.title
                resolvedContext = resolvedContext || property.description || ""
                propertyImagesList = property.images || []
                if (property.image_url && !propertyImagesList.includes(property.image_url)) {
                    propertyImagesList.unshift(property.image_url)
                }
                if (property.rera_number) {
                    propertyRera = property.rera_number
                }
                if (property.floor_plan_url) {
                    propertyFloorPlan = property.floor_plan_url
                }
                if (property.price) {
                    propertyPrice = property.price
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
- Property Images List: ${JSON.stringify(propertyImagesList)}
`
            }
        }

        // 2. Fetch business profile details for automatic contact pre-fill & branding
        const { data: profile } = await supabase
            .from('profiles')
            .select('business_name, contact_number, email, custom_domain, brand_color, logo_url')
            .eq('id', targetUserId)
            .maybeSingle()

        const contactInfoText = `
BUSINESS CONTACT INFO:
- Brand/Business Name: ${profile?.business_name || resolvedProductName || "Premium Listings"}
- Contact Phone Number: ${profile?.contact_number || "+91 98724 90091"}
- Contact Email: ${profile?.email || "info@bluesquareinfra.com"}
- Custom Connected Domain: ${profile?.custom_domain || `app.adrolls.in/shared/${targetUserId}`}
- Brand Base Accent Color: ${profile?.brand_color || "#9e755c"}
- Business Logo Image URL: ${profile?.logo_url || ""}
`

        // 3. Fetch connected form if available to enrich the prompt context
        let formFieldsText = "Full Name, WhatsApp Number, City"
        if (formId) {
            const { data: form } = await supabase
                .from('qualification_forms')
                .select('*')
                .eq('id', formId)
                .maybeSingle()
            if (form && Array.isArray(form.custom_questions)) {
                const customLabels = form.custom_questions.map((q: any) => q.label).join(', ')
                if (customLabels) formFieldsText += `, ${customLabels}`
            }
        }

        let systemPrompt = ''
        if (mode === 'generate') {
            systemPrompt = `You are a legendary front-end developer and direct-response real-estate landing page copywriter.
Create a complete, responsive, premium single-page landing page in HTML based on the following property details, contact info, and custom instructions.

PROPERTY DETAILS:
Product/Property Name: "${resolvedProductName}"
General Context/Copy details: "${resolvedContext}"
${propertyDataText}

${contactInfoText}

CUSTOM INSTRUCTIONS / DESIGN PREFERENCES:
"${customInstructions || "Generate an extremely luxurious, high-converting lander."}"

--------------------------------------------------------------------------------
CRITICAL STRUCTURE & DESIGN SPECS (MODEL AND REPLICATE THIS PHILOSOPHY):
Your generated HTML must include all of the following interactive elements and visual standards:

1. MODERN BRAND STYLING & FONTS:
   - Use Google Fonts (e.g. Outfit, Inter or Georgia) for maximum typographic elegance.
   - Ensure the page body is fully scrollable and does NOT cap layout height (do NOT use height: 100vh or overflow: hidden on html/body/main elements).
   - Configure Tailwind via CDN with a custom config extension that maps 'brand' theme colors based on the base brand color '${profile?.brand_color || "#9e755c"}':
     - 'brand.DEFAULT' = Primary color (e.g., '${profile?.brand_color || "#9e755c"}')
     - 'brand.light' = Elegant light pastel/gold tone (e.g., '#c9b2a1')
     - 'brand.dark' = Deep premium tone (e.g., '#7a5743')
     - 'brand.bg' = Soft premium background color (e.g., '#fdfbf7')
     - 'brand.heading' = Deep luxury brown/black tone (e.g., '#4a3324')
     - 'brand.smartbg' = Smart tiles background (e.g., '#453227')

2. STICKY HEADER & CALL TO ACTIONS:
   - Floating header with shadow-sm. Left side has logo image wrapper (the logo container card or logo image itself MUST have elegant rounded corners on the top, e.g. Tailwind 'rounded-t-lg' or 'rounded-t-2xl' style on the top corners). Use logo from '${profile?.logo_url || ""}' if provided, otherwise an elegant text logo: '${profile?.business_name || resolvedProductName}'.
   - Center navigation links matching standard sections: About Us, Floor Plan, Amenities, Connectivity, Gallery, Contact.
   - Right side has phone call link (e.g., href="tel:${profile?.contact_number || "+919872490091"}") showing '${profile?.contact_number || "+91 98724 90091"}' and a button "Request Details".
   - Include RERA ID prominently (e.g. RERA: ${propertyRera}).

3. HERO BLOCK WITH BACKGROUND FADE CAROUSEL:
   - A full-screen covering slide container ('div class="carousel-container"') loaded with slides. Use images from this list: ${JSON.stringify(propertyImagesList.length > 0 ? propertyImagesList : ["https://i.ibb.co/39WNxFm5/banner1.webp", "https://i.ibb.co/hFdg7Lfb/banner2.webp", "https://i.ibb.co/fVjHyFNx/banner3.webp"])}.
   - Include absolute transitions so that they fade between slides every 4 seconds via simple inline JavaScript.
   - Split layout:
     - Left column: "Booking Open" badge, high-converting copy, price badge (ALWAYS display the starting price prominently, e.g. "Starting at ${propertyPrice}" or matching the price details), configurations bullet list, and a prominent call-to-action button which MUST say exactly: "Schedule your exclusive site visit" (do NOT say 'Free Site Visit').
     - Right column: A styled white card with a header "Exclusive Pricing Overview" enclosing EXACTLY this structural container: '<div id="qualification-form-container"></div>'. Do NOT write a form element inside this container! The platform will automatically inject a high-converting form collecting standard fields: ${formFieldsText}.

4. FLOOR PLAN INTERACTIVE SECTION:
   - Buttons to switch between floor configurations (e.g., 3 BHK, 3 BHK + Study, Duplex).
   - Display floor plan image (default to floor_plan_url: '${propertyFloorPlan}').
   - Place an overlay with a blurry backdrop and a secure lock icon overlay:
     - '<div id="floorplan-overlay" class="absolute inset-0 bg-white/40 backdrop-blur-md flex flex-col items-center justify-center">'
     - It contains a lock icon, heading "Submit Enquiry to Unlock Floor Plan", and a button that scrolls or prompts enquiry.
   - Supply the JavaScript function 'changeFloorPlan(button, imgSrc, isLocked, titleText)' to swap the image, title, and show/hide the lock overlay.

5. STEP INTO SMART LIVING FEATURE TILE GRID:
   - Interactive grids/tiles (1 to 7) matching features (smart lighting, voice control, motion sensors, climate control, scheduling, mobile control, enhanced security).
   - Clicking a tile calls 'updateSmartFeature(id)' to smoothly update a side display panel containing the detailed description.

6. AMENITIES GRID:
   - Grid layout showcasing luxurious amenities with beautiful modern icons (e.g. smart home automation, clubhouse, pool, play area, 3-tier security, gymnasium, spa).

7. PROJECT CONNECTIVITY ACCORDION:
   - An accessibility map/image section.
   - Interactive vertical accordions toggling lists (e.g. Accessibility distances, Hospitals & Education distances) with clear visual '+' / '-' icons.

8. RESPONSIVE UNIFIED GALLERY GRID:
   - Do NOT use category switching tabs (Exterior, Interior, etc.) because image classifications are unverified. Instead, place ALL fetched images from this list: ${JSON.stringify(propertyImagesList.length > 0 ? propertyImagesList : ["https://i.ibb.co/ymJVNXMm/gallery1.webp", "https://i.ibb.co/4n0SWSSM/gallery2.webp", "https://i.ibb.co/B2YD1rnG/gallery3.webp", "https://i.ibb.co/vCLCYrt9/gallery4.webp"])} directly inside one single, elegant high-fidelity CSS gallery grid using hover-scale animations.

9. UNIFIED CTA SCROLL BEHAVIOR & MULTIPLE FORMS:
   - You MUST include exactly the structural container '<div id="qualification-form-container"></div>' in prominent converting positions (such as inside the hero right column card AND inside the footer CTA card) to maximize lead capture rate. Every time you include it, wrap it in a beautiful styling card (white background, rounded corners, soft shadow) so that it integrates seamlessly.
   - Clicking on header "Request Details", hero CTAs, floor plan buttons, or other generic CTA links should smoothly scroll the visitor directly to the nearest form or the main form container.

10. MOBILE BOTTOM FLOATING CTA BAR:
    - Include a fixed bottom bar visible only on mobile screens with Call Now button (tel:${profile?.contact_number || "+919872490091"}) and WhatsApp button (https://wa.me/${(profile?.contact_number || "919872490091").replace(/[^0-9]/g, "")}) for immediate touch-to-connect conversions.

OUTPUT FORMAT:
- Return ONLY the raw, complete, valid HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
- ABSOLUTELY DO NOT wrap the output in markdown code blocks (e.g., do NOT start with \`\`\`html or end with \`\`\`).
- Output ONLY the pure raw HTML string. No intro, conversational chat, or outro.`
        } else {
            systemPrompt = `You are a master front-end developer.
Edit the provided landing page HTML strictly according to the user's instructions.
User Instructions: "${instructions}"

CURRENT HTML:
${currentHtml}

CRITICAL RULES:
1. Preserve the structural container '<div id="qualification-form-container"></div>' exactly as it is, so that the lead form continues to function perfectly.
2. Retain all existing styling, layout elements, assets, and copywriting, modifying ONLY the parts requested by the user.
3. Return ONLY the raw, complete, valid updated HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
4. ABSOLUTELY DO NOT wrap the output in markdown code blocks. Output ONLY the pure raw updated HTML string. No conversational text.`
        }

        console.log(`[Lander API] Calling Gemini in mode: ${mode}...`)
        const aiRawResult = await callGemini(systemPrompt)
        
        // Clean markdown formatting if LLM failed to follow the instruction
        const htmlResult = aiRawResult
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/\s*```$/, '')
            .trim()

        // Generate unique slug
        const baseSlug = resolvedProductName
            ? resolvedProductName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '')
            : 'listing'
            
        const slug = mode === 'generate' 
            ? `${baseSlug}-${Date.now().toString().slice(-4)}` 
            : baseSlug

        // Create or update record in public.landing_pages
        const { data: pageRecord, error: dbError } = await supabase
            .from('landing_pages')
            .upsert({
                user_id: targetUserId,
                slug,
                title: `${resolvedProductName || 'Offer'} | High-Converting Listing`,
                product_name: resolvedProductName || 'Property Listing',
                html_content: htmlResult,
                form_id: formId || null,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id, slug'
            })
            .select()
            .single()

        if (dbError) {
            console.error("❌ Failed to save landing page:", dbError)
            return NextResponse.json({ error: "Failed to persist landing page to database." }, { status: 500 })
        }

        const domainBase = profile?.custom_domain || `app.adrolls.in/shared/${targetUserId}`
        const publicUrl = `https://${domainBase}/${slug}`

        return NextResponse.json({
            success: true,
            page: pageRecord,
            publicUrl
        })

    } catch (error: any) {
        console.error("Lander Generate API Error:", error)
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
    }
}
