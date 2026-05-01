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
        model 
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

    // --- DIRECT RESPONSE DESIGN FRAMEWORK PROMPT ---
    let finalImagePrompt = `Create a high-converting, professional Meta ad design for: "${propertyTitle}". \n\n`;
    finalImagePrompt += `CONTEXT: ${propertyDescription}. \n`;
    if (userInstructions) finalImagePrompt += `REQUIREMENTS: ${userInstructions}. \n`;
    finalImagePrompt += `STYLE: Premium real estate photography, clean lighting, bold typography. \n`;
    finalImagePrompt += `Aspect Ratio: ${aspectRatio}.`;

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
    
    logToFile(`KIE PAYLOAD: ${JSON.stringify(payload, null, 2)}`);

    // 1. Guarantee the Image Generation Task is requested first
    const kieResult = await createKieTask(payload);

    if (!kieResult || kieResult.error || !kieResult.taskId) {
      logToFile(`Kie AI Task failed: ${kieResult?.error}`);
      throw new Error(`Design server error: ${kieResult?.error || "Empty response"}`);
    }
    
    logToFile(`KIE TASK CREATED: ${kieResult.taskId}`);

    // 2. Try the Caption Generation Safely
    let generatedCaption = "Check out this premium property! DM for more details.";
    try {
        const { text } = await generateText({
          model: google('gemini-3-flash-preview'),
          prompt: `Write a high-converting real estate ad caption for: ${propertyTitle}. Context: ${propertyDescription}. Business: ${businessName}. Contact: ${contactNumber || 'DM for details!'}. Output ONLY the caption, NO markdown.`,
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