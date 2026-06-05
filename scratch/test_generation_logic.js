const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const { callGemini, createKieImageTask } = require('../utils/external-apis');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const targetUserId = "bc63c065-9bcc-4793-bedc-f0960406425b"; // Test User ID
const resolvedProductName = "Adrolls Premium Agency";
const resolvedContext = "We automate lead generation and WhatsApp marketing for local businesses in India to double their revenue in 30 days without expensive agency fees.";

async function run() {
    console.log("=== STARTING END-TO-END GENERATION TEST ===");
    
    // 1. Fetch business profile details
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('business_name, contact_number, email, custom_domain, brand_color, logo_url')
        .eq('id', targetUserId)
        .maybeSingle();

    const contactInfoText = `
BUSINESS CONTACT INFO:
- Brand/Business Name: ${profile?.business_name || resolvedProductName || "Premium Listings"}
- Contact Phone Number: ${profile?.contact_number || "+91 98724 90091"}
- Contact Email: ${profile?.email || "info@bluesquareinfra.com"}
- Custom Connected Domain: ${profile?.custom_domain || `app.adrolls.in/shared/${targetUserId}`}
- Brand Base Accent Color: ${profile?.brand_color || "#9e755c"}
- Business Logo Image URL: ${profile?.logo_url || ""}
`;

    let propertyImagesList = [];
    let propertyDataText = "";
    let formFieldsText = "Full Name, WhatsApp Number, City";

    // 2. Parallel image generation using Kie.ai (simulated or real task)
    console.log("[Test] Product has no images. Generating 5 relevant images using gpt-image-2-text-to-image model...");
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
        console.log(`[Test] Created Kie image generation tasks: ${JSON.stringify(taskIds)}`);

        // Poll the tasks in parallel (up to 100 seconds)
        const completedUrls = [];
        const startTime = Date.now();
        const timeoutMs = 100000; 
        
        const pendingTasks = taskIds.map((tid, idx) => ({ id: tid, index: idx, status: 'pending', url: null }));

        while (pendingTasks.some(t => t.status === 'pending') && (Date.now() - startTime) < timeoutMs) {
            console.log("[Test] Polling task statuses...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            
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
                            const resultData = checkData.result || checkData.data?.result || checkData.data;
                            const imageUrl = resultData?.image_url || resultData?.imageUrl || resultData?.url || resultData?.output_url || resultData?.outputUrl;
                            if (imageUrl) {
                                task.status = 'succeeded';
                                task.url = imageUrl;
                            }
                        } else if (status === 'failed' || status === 'error') {
                            task.status = 'failed';
                        }
                    }
                } catch (err) {
                    console.error(`[Test] Error polling task ${task.id}:`, err);
                }
            });
            
            await Promise.all(pollPromises);
        }

        pendingTasks.forEach(task => {
            if (task.url) {
                completedUrls.push(task.url);
            }
        });

        console.log(`[Test] Generated ${completedUrls.length} images successfully:`, completedUrls);
        if (completedUrls.length > 0) {
            propertyImagesList = completedUrls;
        }
    } catch (err) {
        console.error("[Test] Kie Image generation failed:", err);
    }

    // 3. Construct the Hormozi framework prompt
    console.log("[Test] Constructing Gemini system prompt...");
    const systemPrompt = `You are a world-class front-end developer and elite direct-response landing page copywriter specializing in high-converting landing pages.
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
   - CRITICAL RULE: Do NOT hide reviews inside a slider, tab, or carousel. Lay all visual proof, video placeholders, and text reviews out cleanly in a grid or stack so the user is overwhelmed with proof just by scrolling. Make it heavily visual (candid photos/avatars of real customers, star ratings, and text testimonials).

3. "HOW IT WORKS" (Reduce Effort):
   - Explain the process of getting started or using the product in EXACTLY 3 or 4 simple steps. If it is more than 4 steps, it increases perceived effort and hurts conversions. Keep it incredibly simple.

4. THE "SCANNER" RULE FOR ALL HEADLINES:
   - Assume the visitor will ONLY read the H2s and H3s on the page.
   - Never use generic section labels like "How It Works", "Features", "Amenities", "Testimonials", or "What Customers Say".
   - Instead, every H2 itself must be the distinct value proposition, unique differentiator, or the actual customer result.

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
- Output ONLY the pure raw HTML string. No intro, conversational chat, or outro.`;

    console.log("[Test] Calling Gemini...");
    const aiRawResult = await callGemini(systemPrompt);
    console.log("[Test] Received Gemini output.");

    const htmlResult = aiRawResult
        .replace(/^```html\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim();

    console.log(`[Test] Cleaned HTML length: ${htmlResult.length}`);
    
    // Save to landing_pages
    const slug = `test-adrolls-${Date.now().toString().slice(-4)}`;
    console.log(`[Test] Saving test landing page with slug: ${slug}...`);
    
    const { data: pageRecord, error: dbError } = await supabaseAdmin
        .from('landing_pages')
        .upsert({
            user_id: targetUserId,
            slug,
            title: `${resolvedProductName} | High-Converting Listing`,
            product_name: resolvedProductName,
            html_content: htmlResult,
            form_id: null,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
        
    if (dbError) {
        console.error("[Test] Database save error:", dbError);
    } else {
        console.log("✅ SUCCESS: E2E Generation completed! Saved page record ID:", pageRecord.id);
        console.log(`View it here: http://localhost:3000/shared/${targetUserId}/${slug}`);
        
        // Also run verification checks on the saved page using fetch!
        const verifyRes = await fetch(`http://localhost:3000/shared/${targetUserId}/${slug}`);
        const servedHtml = await verifyRes.text();
        console.log(`Served HTML verification status: ${verifyRes.status}`);
        console.log(`Served HTML length: ${servedHtml.length}`);
        console.log(`Contains class="dynamic-landing-form": ${servedHtml.includes('class="dynamic-landing-form"')}`);
        console.log(`Contains generated image: ${propertyImagesList.length > 0 ? servedHtml.includes(propertyImagesList[0]) : "N/A"}`);
    }
}

run().catch(console.error);
