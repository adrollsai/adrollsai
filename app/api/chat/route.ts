import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createKieTask } from '@/utils/external-apis';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google'; 
import fs from 'fs';
import path from 'path';

const DEBUG_LOG = path.join(process.cwd(), 'image_gen_debug.log');

function logToFile(msg: string) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${msg}\n`;
  console.log(`[ImageGen] ${msg}`); // Also log to console for dev server
  try {
    fs.appendFileSync(DEBUG_LOG, entry, { encoding: 'utf8' });
  } catch (e: any) {
    console.error("CRITICAL: Failed to write to log file:", e.message);
  }
}

export async function POST(request: Request) {
  try {
    logToFile("--- NEW IMAGE GEN REQUEST RECEIVED ---");
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      logToFile("ERROR: Unauthorized request");
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      logToFile("ERROR: Failed to parse request JSON");
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    
    logToFile(`PAYLOAD RECEIVED: ${JSON.stringify(body, null, 2)}`);
    
    const { 
        userInstructions, 
        propertyDescription, 
        propertyTitle,       
        contactNumber, 
        logoUrl,
        propImages, 
        templateUrl, 
        aspectRatio = "1:1",
        model,
        isDirect = false // New flag to force fast model
    } = body;

    // Fetch user profile for business context
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name')
      .eq('id', user.id)
      .single()

    const businessName = profile?.business_name || 'Your Business';

    logToFile(`STARTING GENERATION | MODEL: ${model}`);
    
    // Consolidate images
    const allInputImages = [...(propImages || [])];
    if (logoUrl) allInputImages.push(logoUrl);
    if (templateUrl) allInputImages.push(templateUrl);

    // --- HORMORZI-STYLE DIRECT RESPONSE PROMPT ---
    let finalImagePrompt = `PERSONA: World-class Direct Response Graphic Ads Designer (20+ years exp) using Alex Hormozi high-conversion frameworks.
OBJECTIVE: Design a "WOW-factor", hyper-realistic Meta Ad graphic that stops the scroll immediately.

TITLE/OFFER: "${propertyTitle}"
DESCRIPTION/CONTEXT: "${propertyDescription}"
BUSINESS NAME: "${businessName}"

DESIGN RULES:
1. HYPER-REALISM: The image must look like a professional photograph taken with a high-end camera (Sony A7R V or Canon EOS R5). 
2. NO ARTIFICIAL SHEEN: Avoid that typical "AI look". No plasticy textures, no artificial glowing sheen, and no saturated "HDR-style" over-processing.
3. NATURAL LIGHTING: Use soft, natural light (Golden Hour or professional studio lighting). Shadows should be soft and realistic.
4. PEOPLE: Include people ONLY if they look natural, authentic, and add value to the scene (e.g., a happy family in a home, a professional in an office). They should look like real people, not models from a stock catalog.
5. MAIN HOOK: Create a bold, attention-grabbing headline that stops the scroll. 
6. LOGO INTEGRATION: YOU MUST INCLUDE THE PROVIDED BUSINESS LOGO. Place it professionally in the corner or a prominent position.
7. VISUALS: Use the provided images to create a super attractive, premium, and clean layout. 
8. CLUTTER-FREE: Give important info clearly but keep the design sophisticated and "out-of-the-box".
9. NO GENERIC STOCK: Make it look like a high-budget premium agency design.

USER INSTRUCTIONS: ${userInstructions || 'None'}
ASPECT RATIO: ${aspectRatio}`;

    let kieModel = isDirect ? 'nano-banana-2' : 'gpt-image-2-text-to-image';
    let imageField = 'image_input'; // Default for text-to-image and nano

    // If we have images, switch to Image-to-Image for GPT Image 2.0
    if (!isDirect && allInputImages.length > 0) {
        kieModel = 'gpt-image-2-image-to-image';
        imageField = 'input_urls';
    }
    
    // Explicitly check for requested model names
    if (model === 'image-2.0' || model === 'gpt/gpt-image-2-text-to-image') {
        kieModel = allInputImages.length > 0 ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image';
        if (allInputImages.length > 0) imageField = 'input_urls';
    } else if (model === 'nano' || model === 'nano-banana-2') {
        kieModel = 'nano-banana-2';
        imageField = 'image_input';
    }

    let payload: any = {
      "model": kieModel,
      "input": {
        "prompt": finalImagePrompt,
        "aspect_ratio": aspectRatio,
        "resolution": "1K"
      }
    };
    
    // Assign the correct image field based on the model
    payload.input[imageField] = allInputImages;
    
    // Only text-to-image supports output_format usually
    if (kieModel === 'gpt-image-2-text-to-image') {
        payload.input.output_format = "png";
    }

    logToFile(`KIE PAYLOAD (Attempt 1 - ${kieModel}): ${JSON.stringify(payload, null, 2)}`);

    let kieResult;
    try {
        kieResult = await createKieTask(payload);
        if (!kieResult || kieResult.error || !kieResult.taskId) {
            const errMsg = kieResult?.error || "Task creation failed";
            logToFile(`PRIMARY MODEL ERROR: ${errMsg}`);
            throw new Error(errMsg);
        }
    } catch (primaryError: any) {
        logToFile(`FAILOVER TRIGGERED: ${primaryError.message}. Switching to nano-banana-2...`);
        
        // FAILOVER to nano-banana-2
        if (kieModel !== 'nano-banana-2') {
            const failoverModel = 'nano-banana-2';
            
            // SIMPLIFIED PROMPT for failover to avoid content policy rejections
            const simplifiedPrompt = `High-converting ad design for: "${propertyTitle}". 
Context: "${propertyDescription}". 
Brand: "${businessName}". 
Premium design, clean layout, bold headline.`;

            const failoverPayload = {
                model: failoverModel,
                input: {
                    prompt: simplifiedPrompt,
                    image_input: allInputImages,
                    aspect_ratio: aspectRatio,
                    resolution: "1K"
                }
            };
            
            logToFile(`KIE PAYLOAD (Attempt 2 - ${failoverModel}): ${JSON.stringify(failoverPayload, null, 2)}`);
            kieResult = await createKieTask(failoverPayload);
        } else {
            throw primaryError;
        }
    }

    if (!kieResult || kieResult.error || !kieResult.taskId) {
      const finalError = kieResult?.error || "Final attempt failed";
      logToFile(`Kie AI Task failed permanently: ${finalError}`);
      throw new Error(`Design server error: ${finalError}`);
    }
    
    logToFile(`✅ SUCCESS: KIE TASK CREATED: ${kieResult.taskId}`);

    // 2. Try the Caption Generation Safely
    let generatedCaption = "Check out this premium property! DM for more details.";
    try {
        const { text } = await generateText({
          model: google('gemini-3-flash-preview'),
          prompt: `You are a world-class Direct Response Copywriter. 
Write a high-converting Meta ad caption for: "${propertyTitle}". 
Context: "${propertyDescription}". 
Business: "${businessName}". 
Contact: "${contactNumber || 'DM for details!'}". 

RULES: 
- Use Alex Hormozi frameworks (Hook, Retain, Reward). 
- Use bullet points and emojis. 
- No bold markdown (**). 
- Make it stop the scroll.
- Output ONLY the caption, NO extra text.`,
        });
        generatedCaption = text;
        logToFile("Caption generated successfully.");
    } catch (chatError: any) {
        logToFile(`Caption generation failed: ${chatError.message}`);
    }

    return NextResponse.json({ 
        taskId: kieResult.taskId,
        caption: generatedCaption,
    })

  } catch (error: any) {
    logToFile(`FATAL ERROR: ${error.message}`);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}