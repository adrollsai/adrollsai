const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// API Keys & Clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIE_API_KEY = process.env.KIE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation
const propertyId = "66dcd35c-a3f6-41dc-9908-662fa37b98f0"; // Highland Mayfield

const trimmedVideoUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/c890a11f-84ce-4592-ab8f-8682927b1a9d/trimmed_videoad_ref.mp4";
const referenceAudioUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/c890a11f-84ce-4592-ab8f-8682927b1a9d/audio_videoad_ref.mp3";

const propertyImages = [
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624036-1w7tqd.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-g0ofd.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-1u4ncjp.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-5hsho.jpg",
  "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/bc63c065-9bcc-4793-bedc-f0960406425b-1781059624037-n2dyb.jpg"
];

async function getImageDescription(url, idx) {
    console.log(`Analyzing image ${idx + 1}...`);
    try {
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const visionPrompt = "Describe the visual details of this real estate property photo in under 40 words. Focus on the main architectural details, materials, colors, and layout shown.";
        
        const result = await model.generateContent([
            visionPrompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: "image/jpeg"
                }
            }
        ]);
        const text = result.response.text().trim();
        console.log(`  -> Image ${idx + 1} description: "${text}"`);
        return text;
    } catch (e) {
        console.warn(`Failed to describe image ${idx + 1}:`, e.message);
        return `A beautiful luxury residential space at Highland Mayfield property.`;
    }
}

async function triggerTask(payload) {
    console.log("Launching Kie task...");
    const res = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${KIE_API_KEY}`
        },
        body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
        throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.code !== 0 && data.code !== 200) {
        throw new Error(`Kie error: ${data.msg || data.error}`);
    }
    return data.data?.taskId;
}

async function run() {
    try {
        if (!KIE_API_KEY) throw new Error("KIE_API_KEY is not defined");
        
        // 1. Describe property images
        const descriptions = [];
        for (let i = 0; i < propertyImages.length; i++) {
            const desc = await getImageDescription(propertyImages[i], i);
            descriptions.push(desc);
        }
        
        const descriptionsText = descriptions
            .map((desc, i) => `- Reference Image ${i + 1} description: "${desc}"`)
            .join('\n');
            
        // 2. Query Profile context
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
            
        const characterDescription = profile.character_description || "A professional middle-aged Indian male with short black hair and glasses, wearing a checkered shirt.";
        const businessName = profile.business_name || "Realty Nation";
        
        // 3. Generate UGC Hinglish Script (2 scenes = 30 seconds)
        console.log("Generating 30s ad script...");
        const scriptPrompt = `You are a world-class Ad Copywriter.
Write a deeply emotional, highly engaging, and highly converting 30-second Hinglish real estate ad script for Highland Mayfields in Sector 118, Airport Road, Mohali.
The script must have EXACTLY 2 sequential 15-second scenes.

Product/Property details:
- Name: Highland Mayfields
- Location: Sector 118, Airport Road, Mohali
- Key details: 3 & 4 BHK apartments, MIVAN construction technology, low-density layout, direct access from PR6 and PR7. Price starts at 2.75 Crores.

Language Rules:
- The spoken dialogue MUST be written in simple, conversational Hinglish but transliterated ENTIRELY into Hindi Devanagari script. Do NOT use any English/Latin letters in the dialogue block.
- For example: 'मोहाली के इस सबसे बेहतरीन लोकेशन पर अपना ड्रीम होम देखें।'
- City names like Mohali must be written in Devanagari as 'मोहाली'.
- Do NOT use complex, formal Hindi words (avoid: susajjit, aalishan, vastukala, pratishthit). Use simple, friendly everyday Hinglish loanwords (like luxury, location, perfect, space, family) transliterated into Devanagari (जैसे लग्ज़री, लोकेशन, परफेक्ट, स्पेस, फ़ैमिली).
- Do NOT include any phone numbers.

Output format must be a single JSON object:
{
  "title": "Short catchy title",
  "finalCaption": "Compelling, high-converting FB ad caption copy (include emojis, call to action, but NO hashtags, NO bold markdown).",
  "scenes": [
    {
      "dialogue": "Scene 1 Hinglish dialogue in Devanagari (under 40 words, comfortably spoken in 15 seconds)",
      "visuals": "Visual cues referencing the listing images"
    },
    {
      "dialogue": "Scene 2 Hinglish dialogue in Devanagari (under 40 words, comfortably spoken in 15 seconds, ends with get in touch CTA)",
      "visuals": "Visual cues referencing the listing images"
    }
  ]
}`;

        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const scriptResult = await model.generateContent(scriptPrompt);
        const scriptJsonText = scriptResult.response.text().replace(/```json|```/g, '').trim();
        const script = JSON.parse(scriptJsonText);
        
        console.log("\n=== Generated Script ===");
        console.log(JSON.stringify(script, null, 2));
        
        // 4. Synthesize Prompts for each scene
        const prompts = [];
        for (let i = 0; i < script.scenes.length; i++) {
            const scene = script.scenes[i];
            
            const synthesisPrompt = `You are a professional Prompt Engineer for Bytedance/Kie.ai Seedance 2.0.
Translate this script scene into a highly effective, minimal, and clean generative video prompt.

CREATOR CHARACTER:
- Description: "${characterDescription}"
- Reference Video Available: Yes

SCENE DETAILS:
- Dialogue: "${scene.dialogue}"
- Visuals/Action: "${scene.visuals}"
- Business: "${businessName}"
- Product: Highland Mayfields, Sector 118, Mohali (Premium 3 & 4 BHK apartments starting at 2.75 Cr)

REFERENCE IMAGES & DETAILS:
${descriptionsText}

YOUR INSTRUCTIONS:
1. Keep the output prompt clean, short, and to the point.
2. Focus on:
   - Defining a simple professional setting and category-appropriate attire.
   - Instructing the presenter to speak directly to the camera in a natural, organic, UGC-like video presentation that does NOT look AI-generated, delivering the dialogue with highly expressive, warm, and enthusiastic energy.
   - Referencing the listing images for clean, simple B-roll transitions if applicable. Explicitly state in the B-roll section: "Only show the parts of the image that are actually visible in the reference image. Do not out-paint, extrapolate, or hallucinate areas outside the reference image borders."
3. If the word 'Mohali' appears in the dialogue, always write it in Hindi script as 'मोहाली'. Keep all other words in their original script.
4. Output the prompt following this EXACT format:

Use reference video ONLY for character facial appearance and identity consistency.

Use reference audio ONLY for voice characteristics.

Duration: 15 seconds
Aspect Ratio: 9:16

Setting: [Describe simple setting/environment, e.g., "A modern, bright real estate office"]

Presenter: A warm, professional presenter speaking directly to the camera in a natural, organic, UGC-like video that does not look AI. Delivery must be highly expressive, enthusiastic, and natural. Wearing [describe simple attire].

B-Roll: [Describe B-roll transition simply using the reference images, e.g., "Show the modern apartment building facade (matching reference image 1) during corresponding dialogue cues. Only show the parts of the image that are actually visible in the reference image. Do not out-paint, extrapolate, or hallucinate areas outside the reference image borders." or "None" if no reference images].

Dialogue:
"${scene.dialogue}"`;

            const synthResult = await model.generateContent(synthesisPrompt);
            const promptText = synthResult.response.text().trim();
            prompts.push(promptText);
        }
        
        console.log("\n=== Synthesized Scene Prompts ===");
        prompts.forEach((p, idx) => {
            console.log(`\n--- Clip ${idx + 1} Prompt ---`);
            console.log(p);
        });
        
        // 5. Create Placeholder Asset in Supabase
        console.log("\nCreating placeholder asset in Supabase...");
        const { data: newAsset, error: newAssetError } = await supabaseAdmin
            .from('assets')
            .insert({
                user_id: userId,
                property_id: propertyId,
                type: 'video',
                status: 'Processing',
                url: 'https://designs.adrolls.in/processing',
                caption: script.finalCaption || `${script.title}\n\n${script.scenes.map(s=>s.dialogue).join(' ')}`
            })
            .select()
            .single();

        if (newAssetError || !newAsset) {
            throw new Error(`Failed to initialize video asset: ${newAssetError?.message}`);
        }
        console.log(`Initialized Asset ID: ${newAsset.id}`);
        
        // 6. Launch parallel Kie.ai tasks
        const callbackUrl = "https://app.adrolls.in/api/video/callback";
        console.log(`Using callback URL: ${callbackUrl}`);
        
        const taskIds = [];
        for (let i = 0; i < prompts.length; i++) {
            const promptText = prompts[i];
            
            const payload = {
                model: "bytedance/seedance-2-fast",
                callBackUrl: callbackUrl,
                input: {
                    prompt: promptText,
                    aspect_ratio: "9:16",
                    duration: 15,
                    generate_audio: true,
                    resolution: "480p",
                    nsfw_checker: true,
                    web_search: false,
                    reference_image_urls: propertyImages.slice(0, 9),
                    reference_video_urls: [trimmedVideoUrl],
                    reference_audio_urls: [referenceAudioUrl]
                }
            };
            
            console.log(`Submitting Clip ${i + 1} to Kie.ai...`);
            const taskId = await triggerTask(payload);
            taskIds[i] = taskId;
            console.log(`Kie Task launched: ${taskId}`);
            
            // Record state in video_tasks
            const { error: insertErr } = await supabaseAdmin
                .from('video_tasks')
                .insert({
                    id: crypto.randomUUID(),
                    user_id: userId,
                    property_id: propertyId,
                    asset_id: newAsset.id,
                    prompts: prompts,
                    current_index: i,
                    last_task_id: taskId,
                    last_successful_task_id: trimmedVideoUrl, // Store trimmedVideoUrl for retry consistency!
                    aspect_ratio: "9:16",
                    status: 'Processing',
                    retry_count: 0
                });
                
            if (insertErr) {
                console.error(`Error inserting video task ${i + 1} into DB:`, insertErr);
            } else {
                console.log(`Recorded task ${i + 1} in Supabase video_tasks table.`);
            }
        }
        
        console.log("\n=== Success! ===");
        console.log(`Successfully triggered parallel video generations for Asset ID: ${newAsset.id}`);
        console.log(`Task IDs:`, taskIds);
        
    } catch (e) {
        console.error("Fatal generation run error:", e);
    }
}

run();
