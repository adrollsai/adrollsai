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
        model // NEW: Model toggle from frontend
    } = body;

    // Fetch user's business profile for ad copy context
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name')
      .eq('id', user.id)
      .single()

    const businessName = profile?.business_name || 'Your Business';

    console.log("--- DIRECT GENERATION START ---")
    
    const allInputImages = [...(propImages || [])];
    
    if (logoUrl) {
        allInputImages.push(logoUrl);
    }

    if (templateUrl) {
        allInputImages.push(templateUrl);
    }

    // --- ALEX HORMOZI DESIGN FRAMEWORK PROMPT ---
    let finalImagePrompt = `Create a high-converting, professional Facebook ad design using the ALEX HORMOZI framework for the product: "${propertyTitle}". \n\n`;
    
    finalImagePrompt += `DESIGN RULES:\n`;
    finalImagePrompt += `1. VISUAL HOOK: Ensure a clear 'Dream Outcome' is visualized.\n`;
    finalImagePrompt += `2. BOLD TYPOGRAPHY: Use strong, authoritative headlines. Make text POP with high contrast.\n`;
    finalImagePrompt += `3. VALUE STACK: Visually highlight 2-3 key benefits or the 'Grand Slam Offer'.\n`;
    finalImagePrompt += `4. MINIMAL CLUTTER: Focus on direct response. Only essential and attention-grabbing elements.\n\n`;

    finalImagePrompt += `PRODUCT CONTEXT: ${propertyDescription}. \n`;
    if (userInstructions) finalImagePrompt += `USER REQUIREMENTS: ${userInstructions}. \n`;
    finalImagePrompt += `VISUAL STYLE: High-fidelity, commercial-grade imagery, professional studio lighting. \n`;

    if (logoUrl) {
        finalImagePrompt += `\n*** LOGO INSTRUCTIONS ***\n`;
        finalImagePrompt += `Include the brand logo in the design layout (e.g., top corner or bottom footer) naturally.\n`;
    }

    if (templateUrl) {
        finalImagePrompt += `\n*** REFERENCE STYLE ***\n`;
        finalImagePrompt += `The last image is a REFERENCE DESIGN. Adopt its layout and color palette but apply it to the "${propertyTitle}". --control_image_last_is_reference\n`;
    }

    finalImagePrompt += `\nAspect Ratio: ${aspectRatio}.`;
    if (contactNumber) finalImagePrompt += ` Display contact info prominently: ${contactNumber}.`;

    console.log("[LOG] Final Image Prompt:", finalImagePrompt);

    // KIE API Payload
    const payload = {
      "model": model || "google/nano-banana-2", // Uses Banana 2.0 or GPT 2.0 based on UI toggle
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
      Your task is to write a highly converting social media ad caption.
      
      PRODUCT: ${propertyTitle}
      DETAILS: ${propertyDescription}
      COMPANY: ${businessName}
      CONTACT: ${contactNumber || 'DM us!'}
      EXTRA: ${userInstructions || 'None'}

      FRAMEWORK:
      1. HOOK: Immediate attention-grabber.
      2. OFFER: Irresistible deal.
      3. VALUE STACK: Bulleted massive benefits.
      4. SCARCITY: Why act now.
      5. CTA: Direct instruction with contact info.
    `;

    // Execute concurrently
    const [kieResult, generatedCaption] = await Promise.all([
        createKieTask(payload),
        generateKieChat(copyPrompt, "gemini-3-flash")
    ]);

    if ('error' in kieResult) {
      throw new Error(`Kie AI Task creation failed: ${kieResult.error}`)
    }
    
    return NextResponse.json({ 
        taskId: kieResult.taskId,
        caption: generatedCaption,
        marketingAngle: "Alex Hormozi Framework Applied" 
    })

  } catch (error: any) {
    console.error("API Error:", error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}