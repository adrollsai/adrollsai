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
        aspectRatio = "1:1"
    } = body;

    // Fetch user's business profile to pass into the ad copy
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

    let finalImagePrompt = `Create a high-converting, professional Facebook ad design for the product: "${propertyTitle}". \n\n`;
    finalImagePrompt += `PRODUCT CONTEXT: ${propertyDescription}. \n`;
    if (userInstructions) finalImagePrompt += `USER REQUIREMENTS: ${userInstructions}. \n`;
    finalImagePrompt += `VISUAL STYLE: High quality, commercial photography, engaging, professional lighting. \n`;

    if (logoUrl) {
        finalImagePrompt += `\n*** LOGO INSTRUCTIONS ***\n`;
        finalImagePrompt += `One of the input images is a brand logo. You MUST include this logo in the final design. Place it clearly (e.g., top corner or bottom footer) without distorting it.\n`;
    }

    if (templateUrl) {
        finalImagePrompt += `\n*** REFERENCE IMAGE INSTRUCTIONS ***\n`;
        finalImagePrompt += `The LAST image provided is a REFERENCE DESIGN.\n`;
        finalImagePrompt += `1. Capture ONLY the design language, layout, and composition from this reference image.\n`;
        finalImagePrompt += `2. Do NOT copy the specific content or objects from the reference image.\n`;
        finalImagePrompt += `3. Apply this extracted design style strictly to the "${propertyTitle}".\n --control_image_last_is_reference`;
    }

    finalImagePrompt += `\nAspect Ratio: ${aspectRatio}.`;
    if (contactNumber) finalImagePrompt += ` Display contact info: ${contactNumber}.`;

    console.log("[LOG] Final Image Prompt:", finalImagePrompt);

    const payload = {
      "model": "nano-banana-2", 
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
      Your task is to write a highly converting, high-energy social media ad caption for the following product or service.
      
      PRODUCT/SERVICE TITLE: ${propertyTitle}
      DETAILS: ${propertyDescription}
      COMPANY NAME: ${businessName}
      CONTACT NUMBER: ${contactNumber || 'DM us for details!'}
      EXTRA INSTRUCTIONS: ${userInstructions || 'None'}

      COPYWRITING FRAMEWORK:
      1. HOOK: Grab attention immediately calling out the ideal buyer.
      2. GRAND SLAM OFFER: Present the offering as an irresistible, no-brainer deal.
      3. VALUE STACKING: List the massive benefits logically and emotionally (bullet points).
      4. SCARCITY/URGENCY: Give them a genuine reason to act right now.
      5. CTA: Strong, clear Call-To-Action instructing them exactly what to do next (including the contact number).

      Keep it structured, punchy, use appropriate emojis, and make it ready to post on Facebook/Instagram. Ensure the tone matches the specific product and respects any extra instructions provided.
    `;

    // Execute both calls concurrently for better performance
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