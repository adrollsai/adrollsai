import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { callGemini, createKieImageTask } from '@/utils/external-apis'

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

        let systemPrompt = ''
        if (mode === 'generate') {
            // Determine if this is a real estate listing
            let realEstateDetails = ""
            if (propertyId) {
                realEstateDetails = `
REAL-ESTATE LISTING SPECIFICATIONS:
- Prominently display the RERA ID/Number: "${propertyRera}".
- Floor Plan Section: Display the floor plan image "${propertyFloorPlan}" with buttons to switch configurations (e.g. 3 BHK, Duplex). Place an overlay with blurry backdrop and a secure lock icon overlay: '<div id="floorplan-overlay" class="absolute inset-0 bg-white/40 backdrop-blur-md flex flex-col items-center justify-center">Submit Enquiry to Unlock Floor Plan</div>'. Supply the JavaScript function 'changeFloorPlan(button, imgSrc, isLocked, titleText)' to handle config changes.
- Project Connectivity: An accessibility distances accordion/section detailing distances with clear visual '+' / '-' icons.
- Smart Living features grid.
- Amenities Grid.
`
            }

            systemPrompt = `You are a world-class front-end developer and elite direct-response landing page copywriter specializing in high-converting landing pages.
Create a complete, responsive, premium single-page landing page in HTML based on the details below, strictly following Alex Hormozi's "Value Equation" conversion framework.

### INPUT VARIABLES
* Brand/Product Name: "${resolvedProductName}"
* Core Offer/Product Context: "${resolvedContext}"
* Target Audience & Brand Info: 
${contactInfoText}
${propertyDataText}

### CRITICAL HORMOZI CONVERSION FRAMEWORK (Apply strictly to copy and layout):

1. ABOVE-THE-FOLD (80% of page effort):
   - Headline (Dream Outcome + Time Delay): Articulate the ultimate dream outcome using the "so that" principle. Explicitly state the timeline or speed of the result (Time Delay). Formula: "Do [Thing] so that you can [Dream Outcome] in [Timeframe]". Never use vague copy or simply state the company name.
   - Sub-headline (Reduce Effort & Sacrifice): Explain how the headline's result is achieved while making it feel effortless. Use a "without [Common Pain Points / Fears]" structure.
   - Hero Media: If images are available in this list: ${JSON.stringify(propertyImagesList)}, display a visual representation of the dream outcome (e.g. a beautiful background fade slider or carousel cycling through the images via inline JS).
     * CRITICAL RULE: If the list is empty (no images are available), DO NOT use generic stock placeholders, placehold.co, or placeholder images. Instead, generate a highly elegant typographic hero section that relies on beautiful fonts, high-contrast CTA buttons, background patterns, and structured copy.
   - Call-To-Action (CTA): High-contrast, clear, action-oriented button (e.g. "Schedule your exclusive site visit", "Get Started Now", "Request Details"). Clicking this should smoothly scroll the visitor directly to the nearest form container.
   - Risk Reversals: Immediately beneath the CTA button, code in 3 trust badges or checkmarks (e.g. Money-Back Guarantee, Fast Setup, Secure Checkout) to increase perceived likelihood of success and reduce fear.
   - Lead Qualification Form Card: A styled white card enclosing EXACTLY this structural container: '<div id="qualification-form-container"></div>'. Do NOT write a form element inside this container! The platform will automatically inject a high-converting form collecting fields: ${formFieldsText}. Wrap it in a beautiful styling card (white background, rounded corners, soft shadow) so that it integrates seamlessly.

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
- Mobile Bottom Floating CTA Bar: Include a fixed bottom bar visible only on mobile screens with a Call Now button (tel:${profile?.contact_number || "+919872490091"}) and WhatsApp button (https://wa.me/${(profile?.contact_number || "919872490091").replace(/[^0-9]/g, "")}) for immediate touch-to-connect conversions.

### OUTPUT FORMAT:
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
