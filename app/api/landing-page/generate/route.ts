import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { callGemini, createKieImageTask } from '@/utils/external-apis'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function extractImageUrl(checkData: any): string | null {
    if (!checkData) return null;
    const dataObj = checkData.data || checkData;
    
    // 1. Direct resultUrl fields
    const directUrl = dataObj.image_url || 
                      dataObj.imageUrl || 
                      dataObj.url || 
                      dataObj.output_url || 
                      dataObj.outputUrl;
                      
    if (directUrl && typeof directUrl === 'string' && directUrl.startsWith('http')) {
        return directUrl;
    }
    
    // 2. Try resultJson
    const resultJson = dataObj.resultJson || checkData.resultJson;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson);
            const parsedUrls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || parsed.full_result_urls || [parsed.url];
            const firstUrl = Array.isArray(parsedUrls) ? parsedUrls[0] : parsedUrls;
            if (firstUrl && typeof firstUrl === 'string' && firstUrl.startsWith('http')) {
                return firstUrl;
            }
        } catch (e) {
            console.error("[Lander API] Error parsing resultJson for image:", e);
        }
    }
    
    // 3. Nested result object fallback
    const result = dataObj.result;
    if (result) {
        const nestedUrl = result.image_url || result.imageUrl || result.url;
        if (nestedUrl && typeof nestedUrl === 'string' && nestedUrl.startsWith('http')) {
            return nestedUrl;
        }
        if (Array.isArray(result.resultUrls) && result.resultUrls.length > 0) {
            return result.resultUrls[0];
        }
    }
    
    return null;
}

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
            pageType = 'standard'
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
        let propertyRera = ""
        let propertyFloorPlan = "https://i.ibb.co/NdSPkfxQ/3bhk.webp"
        let propertyPrice = "₹ 1.7 Cr"
        let propertyYoutubeUrl = ""

        if (propertyId) {
            const { data: property } = await supabaseAdmin
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

        // 2. Fetch business profile details for automatic contact pre-fill & branding
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, contact_number, email, custom_domain, brand_color, logo_url')
            .eq('id', targetUserId)
            .maybeSingle()

        const contactInfoText = `
BUSINESS CONTACT INFO:
- Brand/Business Name: ${profile?.business_name || resolvedProductName || "Premium Listings"}
- Contact Phone Number: ${profile?.contact_number || "+91 98726 69935"}
- Contact Email: ${profile?.email || "info@nobogent.com"}
- Custom Connected Domain: ${profile?.custom_domain || `app.nobogent.com/shared/${targetUserId}`}
- Brand Base Accent Color: ${profile?.brand_color || "#9e755c"}
- Business Logo Image URL: ${profile?.logo_url || ""}
`

        // 3. Fetch connected form if available to enrich the prompt context
        let formFieldsText = ""
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
        if (!formFieldsText) {
            formFieldsText = "Full Name, WhatsApp Number, City"
        }

        // 4. Generate 5 relevant images using Kie.ai if no images exist
        if (mode === 'generate' && propertyImagesList.length === 0) {
            console.log(`[Lander API] Product "${resolvedProductName}" has no images. Generating 5 relevant images using gpt-image-2-text-to-image model...`);
            
            const promptDescriptions = [
                `A professional, high-converting hero banner photograph for ${resolvedProductName}. Context: ${resolvedContext}. Real, organic and natural looking people experiencing the dream outcome of ${resolvedProductName} in their daily lives, smiling candidly, taken with a high-end camera, natural soft lighting.`,
                `A candid, authentic social proof wall of love photograph for ${resolvedProductName}. Real, organic and natural looking people, smiling happily, sharing their positive experience with the brand/product ${resolvedProductName}, captured in natural lighting.`,
                `An organic lifestyle photo representing the success of using ${resolvedProductName}. Features a real, natural looking person or family utilizing this product/service in their modern home, feeling relaxed and satisfied.`,
                `A step-by-step process representation for ${resolvedProductName}. Highlights real, organic looking people interacting with the product/service easily and naturally, showing a high level of usability.`,
                `A premium, clean brand contextual image for ${resolvedProductName}. Focus on details, real people with a human touch, natural shadows, soft warm lighting.`
            ];

            try {
                const taskPromises = promptDescriptions.map(p => 
                    createKieImageTask(
                        `AESTHETIC: RAW & ORGANIC. Use a smartphone-photo style. It must look like an unedited, authentic photo taken by a regular person, not a professional photographer.
LIGHTING: Natural, slightly imperfect, no studio glow.
PEOPLE: Include real, organic and natural looking people to have a human touch. They should look candid, happy, and authentic.
PROMPT: ${p}`,
                        "gpt-image-2-text-to-image"
                    )
                );
                
                const taskIds = await Promise.all(taskPromises);
                console.log(`[Lander API] Created Kie image generation tasks: ${JSON.stringify(taskIds)}`);

                // Poll the tasks in parallel (up to 100 seconds)
                const completedUrls: string[] = [];
                const startTime = Date.now();
                const timeoutMs = 100000; // 100 seconds polling limit
                
                const pendingTasks = taskIds.map((tid, idx) => ({ id: tid, index: idx, status: 'pending', url: null as string | null }));

                while (pendingTasks.some(t => t.status === 'pending') && (Date.now() - startTime) < timeoutMs) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s between polls
                    
                    const pollPromises = pendingTasks.map(async (task) => {
                        if (task.status !== 'pending' || !task.id) return;
                        
                        try {
                            const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${task.id}`, {
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${process.env.KIE_API_KEY}`
                                }
                            });
                            
                            if (res.ok) {
                                const checkData = await res.json();
                                const status = checkData.status || checkData.data?.status || checkData.data?.state;
                                if (status === 'succeeded' || status === 'completed' || status === 'success') {
                                    const imageUrl = extractImageUrl(checkData);
                                    if (imageUrl) {
                                        task.status = 'succeeded';
                                        task.url = imageUrl;
                                    }
                                } else if (status === 'failed' || status === 'error') {
                                    task.status = 'failed';
                                }
                            }
                        } catch (err) {
                            console.error(`[Lander API] Error polling task ${task.id}:`, err);
                        }
                    });
                    
                    await Promise.all(pollPromises);
                }

                pendingTasks.forEach(task => {
                    if (task.url) {
                        completedUrls.push(task.url);
                    }
                });

                console.log(`[Lander API] Generated ${completedUrls.length} images successfully:`, completedUrls);
                
                if (completedUrls.length > 0) {
                    propertyImagesList = completedUrls;
                }
            } catch (err: any) {
                console.error("[Lander API] Kie Image generation failed:", err);
            }
        }
        let imageAnalysisResults = ""
        if (mode === 'generate' && propertyImagesList.length > 0) {
            console.log(`[Lander API] Performing multimodal image analysis on ${propertyImagesList.length} images...`)
            try {
                const analysisPrompt = `You are an expert design and marketing AI. You are given a list of image URLs associated with the product/property "${resolvedProductName}".
Analyze these images and perform the following:
1. Describe what each image shows.
2. Suggest the best placement for each image in a high-converting landing page HTML code (e.g. hero banner background, features showcase, interior gallery, testimonial avatar, or section backdrop).
3. Provide clear design guidelines on how to structure the HTML/CSS layout around these images to maximize visual appeal.

Here are the image URLs for reference:
${propertyImagesList.map((url, idx) => `Image ${idx}: ${url}`).join('\n')}

Format your response as a detailed summary that a frontend developer can easily follow.`
                
                imageAnalysisResults = await callGemini(analysisPrompt, propertyImagesList)
                console.log("[Lander API] Image Analysis Successful:", imageAnalysisResults)
            } catch (e: any) {
                console.error("[Lander API] Failed to perform image analysis:", e)
                imageAnalysisResults = "Failed to perform automated image analysis. Place the images logically within the layout based on general best practices."
            }
        }

        let imageAnalysisSection = ""
        if (imageAnalysisResults) {
            imageAnalysisSection = `
### IMAGE LAYOUT & PLACEMENT ANALYSIS (CRITICAL)
Below is the visual analysis and layout recommendations for the product images. You MUST follow these layout placement recommendations and use the specified image URLs in the corresponding sections/cards of your HTML code:
${imageAnalysisResults}
`
        }

        let systemPrompt = ''
        if (mode === 'generate') {
            if (pageType === 'raw_survey') {
                systemPrompt = `You are a world-class front-end developer and elite copywriter.
Create a complete, responsive, premium raw survey form page in HTML based on the details below.
The page MUST focus entirely on presenting a minimal, clean, centered survey layout with NO extra copy, sections, features list, FAQs, or content whatsoever. Just a clear callout at the top, a gallery/grid/slider of a couple of product photos immediately below it, and the dynamic form container beneath the photos.

### CRITICAL ACCURACY RULE (MANDATORY):
- You must ONLY include, describe, or reference the exact information passed as context in this prompt (such as titles, description context, and actual assets).
- Absolutely DO NOT hallucinate, assume, or generate registration numbers, RERA IDs, approvals, or any parameters/specifications not explicitly provided.

### INPUT VARIABLES
* Brand/Product Name: "${resolvedProductName}"
* Core Offer/Product Context: "${resolvedContext}"
* Target Audience & Brand Info: 
${contactInfoText}
${propertyDataText}
${imageAnalysisSection}

### LAYOUT STRUCTURE (RAW SURVEY PAGE):
1. **Header Callout (Top)**:
   - Display a prominent, elegant callout message instructing the visitor to fill out the form to get the price list, brochure, and dynamic details (e.g. "Fill out the quick form below to receive the price list, brochure, and exclusive details").
   - Use bold, high-contrast, clean typography.
2. **Product Photos (Middle)**:
   - Below the header text, display a premium visual section containing a couple of high-quality photos.
   - If images are available in this list: ${JSON.stringify(propertyImagesList)}, show a clean grid of 2-3 images or a beautiful image slider.
   - If the list is empty, display a clean placeholder gradient block or typography element. Do NOT use external generic stock placeholder domains.
3. **Form Container (Bottom)**:
   - Below the photos, mount the qualification container EXACTLY like this: '<div id="qualification-form-container" data-page-type="survey" data-button-text="Next"></div>'.
   - Do NOT write a form element, inputs, or any button HTML inside this container, and do NOT write any "Start Survey" trigger cards or trigger buttons. The platform dynamically injects the survey questions, and the first question must render inline immediately.

### STYLING & DESIGN GUIDELINES (LIGHT THEME BY DEFAULT):
- Use a soft, clean light theme background (no dark themes unless explicitly requested).
- Configured Tailwind via CDN with a custom config extension that maps 'brand' theme colors based on the base brand color '${profile?.brand_color || "#9e755c"}'.
- Keep margins, paddings, and card shadows clean, minimal, and modern.
- Ensure the page body is fully scrollable and does NOT cap layout height (do NOT use height: 100vh or overflow: hidden on html/body/main elements).

### OUTPUT FORMAT:
- Return ONLY the raw, complete, valid HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
- ABSOLUTELY DO NOT wrap the output in markdown code blocks. Output ONLY the pure raw HTML string.`
            } else if (pageType === 'survey') {
                systemPrompt = `You are a world-class front-end developer and elite copywriter.
Create a complete, responsive, premium survey form page in HTML based on the details below.
The page MUST focus entirely on presenting a single, beautifully centered survey card. It must load super fast, look extremely professional, and have a minimal visual footprint with no extra landing page content.

### CRITICAL ACCURACY RULE (MANDATORY):
- You must ONLY include, describe, or reference the exact information passed as context in this prompt (such as titles, description context, and actual assets).
- Absolutely DO NOT hallucinate, assume, or generate registration numbers, RERA IDs, approvals, or any parameters/specifications not explicitly provided.

### INPUT VARIABLES
* Brand/Product Name: "${resolvedProductName}"
* Core Offer/Product Context: "${resolvedContext}"
* Target Audience & Brand Info: 
${contactInfoText}
${propertyDataText}
${imageAnalysisSection}

### LAYOUT STRUCTURE (SURVEY ONLY PAGE):
- **Fullscreen Centered Single-Card Design:** Center the survey card vertically and horizontally on the page so that the visitor is immediately focused on the survey. The page must have a light, clean, elegant background (no dark mode backgrounds).
- **Property Visuals on Top:** 
  - At the top of the card (as a header image or banner), display a clean, elegant visual showcase of the property.
  - If images are available in this list: ${JSON.stringify(propertyImagesList)}, display a high-quality header image or a simple auto-rotating gallery/slider of these images using inline CSS/JS at the top of the card.
  - If the list is empty, display an elegant typography layout with a premium gradient background instead. Do NOT use stock placeholders or placeholder domains.
- **Survey Container:** 
  - Directly underneath the header image / gallery (inside the card), mount the qualification container EXACTLY like this: '<div id="qualification-form-container" data-page-type="survey" data-button-text="Next"></div>'.
  - Put the '#qualification-form-container' directly below the images/slider inside the card. Ensure that no other sections, highlights, grids, description text, or configuration tables are placed above this container. The survey container MUST be immediately below the visuals.
  - Wrap the container inside the card in a clean styling box (like bg-slate-50/50, rounded corners, padding) so it integrates seamlessly.
  - Any highlights, text descriptions, or configurations, if generated at all, MUST be placed below the survey form container (never above it).
  - Do NOT write a form element, inputs, or any button HTML inside this container, and do NOT write any "Start Survey" trigger cards or trigger buttons. The platform dynamically injects the survey questions, and the first question must render inline immediately.

### STYLING & DESIGN GUIDELINES (LIGHT THEME BY DEFAULT):
- **Default to Light Theme:** The entire page and card must default to a clean, light, high-contrast premium theme. Use soft light backgrounds (e.g., '#f8fafc' or '#fdfbf7'), dark slate text ('#0f172a'), and the custom brand color as interactive accents. Do NOT use dark backgrounds (black, charcoal, deep gray) unless explicitly requested in custom instructions.
- Configured Tailwind via CDN with a custom config extension that maps 'brand' theme colors based on the base brand color '${profile?.brand_color || "#9e755c"}':
  - 'brand.DEFAULT' = Primary color (e.g., '${profile?.brand_color || "#9e755c"}')
  - 'brand.light' = Elegant light pastel/gold tone (e.g., '#c9b2a1')
  - 'brand.dark' = Deep premium tone (e.g., '#7a5743')
  - 'brand.bg' = Soft premium background color (e.g., '#fdfbf7')
  - 'brand.heading' = Deep luxury brown/black tone (e.g., '#4a3324')
- Use elegant Google Fonts (e.g. Outfit, Inter or Georgia) for premium typography.
- Clean, premium aesthetic with subtle micro-animations or hover states on interactive components.
- Do NOT include any navigation bars, footers, grids of testimonials, how-it-works, FAQs, accordions, or extra content. Only show the centered survey card with property visuals.
- Ensure the page body is fully scrollable and does NOT cap layout height (do NOT use height: 100vh or overflow: hidden on html/body/main elements).

### OUTPUT FORMAT:
- Return ONLY the raw, complete, valid HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
- ABSOLUTELY DO NOT wrap the output in markdown code blocks (e.g., do NOT start with \`\`\`html or end with \`\`\`).
- Output ONLY the pure raw HTML string. No intro, conversational chat, or outro.`
            } else {
                // Determine if this is a real estate listing
                let realEstateDetails = ""
                if (propertyId) {
                    realEstateDetails = `
REAL-ESTATE LISTING SPECIFICATIONS:
${propertyRera ? `- Prominently display the RERA ID/Number: "${propertyRera}".` : ''}
- Floor Plan Section: Display the floor plan image "${propertyFloorPlan}" with buttons to switch configurations (e.g. 3 BHK, Duplex). Place an overlay with blurry backdrop and a secure lock icon overlay: '<div id="floorplan-overlay" class="absolute inset-0 bg-white/40 backdrop-blur-md flex flex-col items-center justify-center">Submit Enquiry to Unlock Floor Plan</div>'. Supply the JavaScript function 'changeFloorPlan(button, imgSrc, isLocked, titleText)' to handle config changes.
- Project Connectivity: An accessibility distances accordion/section detailing distances with clear visual '+' / '-' icons.
- Smart Living features grid.
- Amenities Grid.
`
                }



                let youtubeEmbedSection = ""
                if (propertyYoutubeUrl) {
                    youtubeEmbedSection = `
### YOUTUBE VIDEO EMBED INSTRUCTIONS (CRITICAL)
- YouTube Video URL: "${propertyYoutubeUrl}"
- You MUST embed this YouTube video in a highly visible, premium section on the landing page (e.g., directly below the hero section or inside a feature showcase card/video presentation section).
- Parse the YouTube URL to extract the 11-character video ID, and generate a responsive iframe pointing to "https://www.youtube.com/embed/<VIDEO_ID>".
- Ensure the iframe is wrapped in a responsive Tailwind container with professional styling (e.g., class="w-full aspect-video rounded-2xl shadow-lg border border-slate-200/60 overflow-hidden").
`
                }

                systemPrompt = `You are a world-class front-end developer and elite direct-response landing page copywriter specializing in high-converting landing pages.
Create a complete, responsive, premium single-page landing page in HTML based on the details below, strictly following Alex Hormozi's "Value Equation" conversion framework.

### CRITICAL ACCURACY RULE (MANDATORY):
- You must ONLY include, describe, or reference the exact information passed as context in this prompt (such as titles, description context, and actual assets).
- Absolutely DO NOT hallucinate, assume, or generate registration numbers, RERA IDs, approvals, or any parameters/specifications not explicitly provided.
- If a RERA ID or number is not explicitly provided in the specifications above, DO NOT mention RERA, do not write "RERA Approved", and do not show any fake/placeholder registration numbers.

### INPUT VARIABLES
* Brand/Product Name: "${resolvedProductName}"
* Core Offer/Product Context: "${resolvedContext}"
* Target Audience & Brand Info: 
${contactInfoText}
${propertyDataText}
${imageAnalysisSection}
${youtubeEmbedSection}

### CRITICAL HORMOZI CONVERSION FRAMEWORK (Apply strictly to copy and layout):

1. ABOVE-THE-FOLD (80% of page effort):
   - Headline (Dream Outcome + Time Delay): Articulate the ultimate dream outcome using the "so that" principle. Explicitly state the timeline or speed of the result (Time Delay). Formula: "Do [Thing] so that you can [Dream Outcome] in [Timeframe]". Never use vague copy or simply state the company name.
   - Sub-headline (Reduce Effort & Sacrifice): Explain how the headline's result is achieved while making it feel effortless. Use a "without [Common Pain Points / Fears]" structure.
   - Hero Media: If images are available in this list: ${JSON.stringify(propertyImagesList)}, display a visual representation of the dream outcome (e.g. a beautiful background fade slider or carousel cycling through the images via inline JS).
     * CRITICAL RULE: If the list is empty (no images are available), DO NOT use generic stock placeholders, placehold.co, or placeholder images. Instead, generate a highly elegant typographic hero section that relies on beautiful fonts, high-contrast CTA buttons, background patterns, and structured copy.
   - Call-To-Action (CTA): High-contrast, clear, action-oriented button (e.g. "Schedule your exclusive site visit", "Get Started Now", "Request Details"). Clicking this should smoothly scroll the visitor directly to the nearest form container.
   - Risk Reversals: Immediately beneath the CTA button, code in 3 trust badges or checkmarks (e.g. Money-Back Guarantee, Fast Setup, Secure Checkout) to increase perceived likelihood of success and reduce fear.
   - Lead Qualification Form Card: A styled card enclosing EXACTLY this structural container: '<div id="qualification-form-container" data-button-text="Start Eligibility Check"></div>'. Do NOT write a form element inside this container! The platform will automatically inject a high-converting form collecting fields: ${formFieldsText}. Wrap it in a beautiful styling card (white background, rounded corners, soft shadow) so that it integrates seamlessly. You can customize the button text by editing the 'data-button-text' attribute of this div (e.g. set it to "book exclusive site visit" or whatever specific text the user asks for). You can also add 'data-title' and 'data-description' attributes to customize the title and description inside this card.

2. SOCIAL PROOF (Increase Likelihood of Success):
   - Design a visual "Wall of Love" section.
   - CRITICAL RULE: Do NOT hide reviews inside a slider, tab, or carousel. Lay all visual proof, video placeholders, and text reviews out cleanly in a grid or stack so the user is overwhelmed with proof just by scrolling. Make it heavily visual (candid photos/avatators of real customers, star ratings, and text testimonials).

3. "HOW IT WORKS" (Reduce Effort):
   - Explain the process of getting started or using the product in EXACTLY 3 or 4 simple steps. If it is more than 4 steps, it increases perceived effort and hurts conversions. Keep it incredibly simple.

4. THE "SCANNER" RULE FOR ALL HEADLINES:
   - Assume the visitor will ONLY read the H2s and H3s on the page.
   - Never use generic section labels like "How It Works", "Features", "Amenities", "Testimonials", or "What Customers Say".
   - Instead, every H2 itself must be the distinct value proposition, unique differentiator, or the actual customer result.

${realEstateDetails}

### STYLING & DESIGN GUIDELINES:
- Configured Tailwind via CDN with a custom config extension that maps 'brand' theme colors based on the base brand color '${profile?.brand_color || "#9e755c"}':
  - 'brand.DEFAULT' = Primary color (e.g., '${profile?.brand_color || "#9e755c"}')
  - 'brand.light' = Elegant light pastel/gold tone (e.g., '#c9b2a1')
  - 'brand.dark' = Deep premium tone (e.g., '#7a5743')
  - 'brand.bg' = Soft premium background color (e.g., '#fdfbf7')
  - 'brand.heading' = Deep luxury brown/black tone (e.g., '#4a3324')
- Use elegant Google Fonts (e.g. Outfit, Inter or Georgia) for premium typography.
- Ensure the page body is fully scrollable and does NOT cap layout height (do NOT use height: 100vh or overflow: hidden on html/body/main elements).
- Mobile Bottom Floating CTA Bar: Include a fixed bottom bar visible only on mobile screens with a Call Now button (tel:${profile?.contact_number || "+919872669935"}) and WhatsApp button (https://wa.me/${(profile?.contact_number || "919872669935").replace(/[^0-9]/g, "")}) for immediate touch-to-connect conversions.

### OUTPUT FORMAT:
- Return ONLY the raw, complete, valid HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
- ABSOLUTELY DO NOT wrap the output in markdown code blocks (e.g., do NOT start with \`\`\`html or end with \`\`\`).
- Output ONLY the pure raw HTML string. No intro, conversational chat, or outro.`
            }
        } else {
            systemPrompt = `You are a master front-end developer.
Edit the provided landing page HTML strictly according to the user's instructions.
User Instructions: "${instructions}"
${imageUrls && imageUrls.length > 0 ? `The user has attached the following image(s)/screenshot(s) as visual reference: ${JSON.stringify(imageUrls)}. Analyze these attached images carefully and apply any visual edits, layout fixes, styling corrections, or component updates requested by the user based on what is pointed out in the images.` : ''}

CURRENT HTML:
${currentHtml}

CRITICAL RULES:
1. Preserve the structural container '<div id="qualification-form-container" ...></div>' (and all its attributes), modifying ONLY the attributes or container itself as requested by the user. Do NOT write a form element inside this container.
2. Retain all existing styling, layout elements, assets, and copywriting, modifying ONLY the parts requested by the user.
3. If the user asks to change the form button text, modify the 'data-button-text' attribute on the '<div id="qualification-form-container" ...>' element. Do NOT write button HTML inside that container, only modify the attribute.
4. Return ONLY the raw, complete, valid updated HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
5. ABSOLUTELY DO NOT wrap the output in markdown code blocks. Output ONLY the pure raw updated HTML string. No conversational text.
6. DO NOT delete, alter, or omit any existing page sections, styles, JS scripts, or sections unless explicitly instructed to do so. Your edit must be a direct, surgical modification of the provided CURRENT HTML, maintaining 100% of the other page elements, structure, and images.
7. CRITICAL ACCURACY RULE: You must ONLY include, describe, or reference the exact information passed as context in this prompt. Absolutely DO NOT hallucinate, assume, or generate registration numbers, RERA IDs, approvals, or any parameters/specifications not explicitly provided. If a RERA ID or number is not explicitly provided, DO NOT mention RERA, do not write "RERA Approved", and do not show any fake/placeholder registration numbers.
8. SURVEY LAYOUT RULE: If the instructions request a survey page format, or if the current HTML contains a survey (data-page-type='survey'), you must structure the page as a single fullscreen centered card (light theme). The property visuals/images must be at the top of the card, and the qualification container '<div id="qualification-form-container" data-page-type="survey" data-button-text="Next"></div>' must be placed **directly below** the property images/slider. Ensure all other elements (like highlights or text descriptions), if present, are placed BELOW the survey container. Do NOT generate any "Start Survey" buttons or trigger card HTML; the first question must render immediately.`
        }

        console.log(`[Lander API] Calling Gemini in mode: ${mode}...`)
        const aiRawResult = await callGemini(systemPrompt, imageUrls)
        
        // Clean markdown formatting if LLM failed to follow the instruction
        const htmlResult = aiRawResult
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/\s*```$/, '')
            .trim()

        // Resolve slug
        let slug = requestSlug
        if (!slug) {
            const baseSlug = resolvedProductName
                ? resolvedProductName
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '')
                : 'listing'
                
            slug = mode === 'generate' 
                ? `${baseSlug}-${Date.now().toString().slice(-4)}` 
                : baseSlug
        }

        const payload: any = {
            user_id: targetUserId,
            slug,
            title: `${resolvedProductName || 'Offer'} | High-Converting Listing`,
            product_name: resolvedProductName || 'Property Listing',
            html_content: htmlResult,
            form_id: formId || null,
            updated_at: new Date().toISOString()
        }
        if (id) {
            payload.id = id
        }

        // Create or update record in public.landing_pages
        const { data: pageRecord, error: dbError } = await supabaseAdmin
            .from('landing_pages')
            .upsert(payload, {
                onConflict: id ? 'id' : 'user_id, slug'
            })
            .select()
            .single()

        if (dbError) {
            console.error("❌ Failed to save landing page:", dbError)
            return NextResponse.json({ error: "Failed to persist landing page to database." }, { status: 500 })
        }

        const domainBase = profile?.custom_domain || `app.nobogent.com/shared/${targetUserId}`
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
