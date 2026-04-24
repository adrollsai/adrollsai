import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createKieTask } from '@/utils/external-apis'; 

export async function POST(request: Request) {
  try {
    // 1. Check Auth
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Inspect Incoming Data
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

    console.log("--- DIRECT GENERATION START ---")
    
    // 3. CONSTRUCT INPUT IMAGES ARRAY
    // Order matters: [Product Images..., Logo?, Reference?]
    const allInputImages = [...(propImages || [])];
    
    // INJECT LOGO as an input image so the model "sees" it
    if (logoUrl) {
        allInputImages.push(logoUrl);
    }

    // INJECT REFERENCE (Must be LAST for the control flag to work)
    if (templateUrl) {
        allInputImages.push(templateUrl);
    }

    // 4. CONSTRUCT THE PROMPT
    let finalImagePrompt = `Create a high-converting, professional Facebook ad design for the product: "${propertyTitle}". \n\n`;

    // Context
    finalImagePrompt += `PRODUCT CONTEXT: ${propertyDescription}. \n`;
    if (userInstructions) finalImagePrompt += `USER REQUIREMENTS: ${userInstructions}. \n`;

    finalImagePrompt += `VISUAL STYLE: High quality, commercial photography, engaging, professional lighting. \n`;

    // LOGO INSTRUCTION
    if (logoUrl) {
        finalImagePrompt += `\n*** LOGO INSTRUCTIONS ***\n`;
        finalImagePrompt += `One of the input images is a brand logo. You MUST include this logo in the final design. Place it clearly (e.g., top corner or bottom footer) without distorting it.\n`;
    }

    // REFERENCE INSTRUCTION
    if (templateUrl) {
        finalImagePrompt += `\n*** REFERENCE IMAGE INSTRUCTIONS ***\n`;
        finalImagePrompt += `The LAST image provided is a REFERENCE DESIGN.\n`;
        finalImagePrompt += `1. Capture ONLY the design language, layout, and composition from this reference image.\n`;
        finalImagePrompt += `2. Do NOT copy the specific content or objects from the reference image.\n`;
        finalImagePrompt += `3. Apply this extracted design style strictly to the "${propertyTitle}".\n`;
        
        // This flag tells the model the specific role of the last image
        finalImagePrompt += " --control_image_last_is_reference"; 
    }

    // Specs
    finalImagePrompt += `\nAspect Ratio: ${aspectRatio}.`;
    if (contactNumber) finalImagePrompt += ` Display contact info: ${contactNumber}.`;

    // 5. DEBUG LOGS (Check your server terminal for these)
    console.log("[LOG] Final Prompt:", finalImagePrompt);
    console.log("[LOG] Image Inputs Order:", JSON.stringify(allInputImages, null, 2));

    // 6. PREPARE PAYLOAD FOR NANO BANANA 2
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
    
    // 7. EXECUTE TASK
    const kieResult = await createKieTask(payload);

    if ('error' in kieResult) {
      throw new Error(`Kie AI Task creation failed: ${kieResult.error}`)
    }
    
    return NextResponse.json({ 
        taskId: kieResult.taskId,
        marketingAngle: "Custom Strategy" 
    })

  } catch (error: any) {
    console.error("API Error:", error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}