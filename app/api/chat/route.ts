import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createKieTask, generateKieChat } from '@/utils/external-apis'; 

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
        userInstructions, 
        propertyDescription, 
        propertyTitle,       
        contactNumber, 
        logoUrl,
        propImages, 
        templateUrl, 
        aspectRatio = "1:1",
        model // Received from the UI toggle (Banana vs GPT 2.0)
    } = body;

    // Fetch user profile for business context
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name')
      .eq('id', user.id)
      .single()

    const businessName = profile?.business_name || 'Your Business';

    console.log(`--- GENERATION START | MODEL: ${model} ---`)
    
    // Consolidate images: Property images first, then logo, then template
    const allInputImages = [...(propImages || [])];
    
    if (logoUrl) {
        allInputImages.push(logoUrl);
    }

    if (templateUrl) {
        allInputImages.push(templateUrl);
    }

    // --- ALEX HORMOZI DESIGN FRAMEWORK PROMPT ---
    let finalImagePrompt = `Create a high-converting, professional Meta ad design for the product: "${propertyTitle}". \n\n`;
    finalImagePrompt += `DESIGN PHILOSOPHY (ALEX HORMOZI FRAMEWORK):\n`;
    finalImagePrompt += `2. BOLD TYPOGRAPHY: Use large, authoritative, high-contrast text for the main headline.\n`;
    finalImagePrompt += `4. ZERO CLUTTER: Every element must drive the direct-response goal.\n\n`;
    
    finalImagePrompt += `PRODUCT CONTEXT: ${propertyDescription}. \n`;
    if (userInstructions) finalImagePrompt += `USER REQUIREMENTS: ${userInstructions}. \n`;
    finalImagePrompt += `VISUAL STYLE: Professional commercial photography, premium lighting, engaging composition. \n`;

    if (logoUrl) {
        finalImagePrompt += `\n*** LOGO INSTRUCTIONS ***\n`;
        finalImagePrompt += `Integrate the brand logo cleanly into the design (e.g., top corner or bottom footer) without distortion.\n`;
    }

    if (templateUrl) {
        finalImagePrompt += `\n*** REFERENCE DESIGN ***\n`;
        finalImagePrompt += `The LAST image is a reference. Capture its design language, layout, and composition style. --control_image_last_is_reference`;
    }

    finalImagePrompt += `\nAspect Ratio: ${aspectRatio}.`;
    if (contactNumber) finalImagePrompt += ` Display contact info: ${contactNumber}.`;

    // Map model selection to KIE API identifiers
    const kieModel = (model === 'gpt/gpt-image-2-text-to-image') 
        ? 'gpt-image-2-text-to-image' 
        : 'nano-banana-2';

    const payload = {
      "model": kieModel,
      "input": {
        "prompt": finalImagePrompt,
        "image_input": allInputImages, 
        "aspect_ratio": aspectRatio,
        "resolution": "1K",
        "output_format": "png"
      }
    };
    
    // --- COPY GENERATION (ALEX HORMOZI FRAMEWORK) ---
    const copyPrompt = `
      You are an elite direct-response copywriter trained in Alex Hormozi's "$100M Offers" framework.
      Write a high-converting caption for:
      
      TITLE: ${propertyTitle}
      DETAILS: ${propertyDescription}
      COMPANY: ${businessName}
      CONTACT: ${contactNumber || 'DM for details!'}

      FRAMEWORK:
      1. HOOK: Call out the buyer.
      2. OFFER: The no-brainer deal.
      3. VALUE STACK: Benefit bullets.
      4. SCARCITY/URGENCY: Why now.
      5. CTA: Direct instruction.
    `;

    // Execute image task and caption generation concurrently
    const [kieResult, generatedCaption] = await Promise.all([
        createKieTask(payload),
        generateKieChat(copyPrompt, "gemini-3-flash")
    ]);

    // Validation to prevent the 'null taskId' error
    if (!kieResult || kieResult.error || !kieResult.taskId) {
      throw new Error(`Kie AI Task creation failed: ${kieResult?.error || "Empty response from API"}`);
    }
    
    return NextResponse.json({ 
        taskId: kieResult.taskId,
        caption: generatedCaption,
        marketingAngle: "Alex Hormozi Framework Applied" 
    })

  } catch (error: any) {
    console.error("API Error Trace:", error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}