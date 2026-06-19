import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const userId = "29937131-1975-4c5f-9b78-e5b28f918d32";

// Sample script dialogue and visuals
const scenes = [
    {
        dialogue: "न्यू चंडीगढ़ में चौदह करोड़ का अल्ट्रा-लग्ज़री वन कनाल होम ढूंढ रहे हाई-प्रोफाइल इन्वेस्टर्स के लिए, यह है सक्सेस का सबसे खूबसूरत रिवॉर्ड।",
        visuals: "A professional speaking directly to the camera while walking slowly through a modern corporate office."
    },
    {
        dialogue: "इटैलियन मार्बल फ्लोरिंग, प्राइवेट एलिवेटर और एक शानदार गोल्डन स्पाइरल स्टेयरकेस। द प्रो एस्टेट के साथ इस लिमिटेड एडिशन लाइफस्टाइल को अपनाएं। साइट विज़िट के लिए आज ही हमें कॉन्टैक्ट करें।",
        visuals: "Show the elegant spiral staircase and elevator doors."
    }
];

function extrapolateEthnicity(profile, property, customInstructions) {
    return "Indian"; 
}

async function run() {
    try {
        console.log("Loading property & profile data...");
        
        const { data: properties } = await supabase
            .from('properties')
            .select('*')
            .eq('user_id', userId)
            .limit(1);

        const property = properties?.[0] || { title: "1 Kanal Luxury Kothi", description: "Facing a lush green park in New Chandigarh" };

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        const businessName = profile?.business_name || 'Your Business';
        const productInfo = `Product: ${property.title}. Description: ${property.description}`;
        const brandGuidelines = profile?.custom_prompt || 'Natural UGC style';
        const customInstructions = 'None';

        const rawImages = property?.images || [];
        const refImages = rawImages.slice(0, 8);
        
        // Mock image descriptions
        const imageDescriptions = [
            "A luxury kothi exterior facade in New Chandigarh",
            "A grand golden spiral staircase",
            "Italian Iceberg marble flooring",
            "Gold-gilded elevator lobby"
        ];

        const descriptionsText = imageDescriptions
            .map((desc, i) => `- Reference Image ${i + 1} description: "${desc}"`)
            .join('\n');

        const extrapolatedEthnicity = extrapolateEthnicity(profile, property, customInstructions);
        const profileDesc = profile.avatar_description || `a stunningly beautiful, highly attractive, charismatic ${extrapolatedEthnicity} female UGC content creator with a fair complexion, smiling warmly`;
        const characterDescription = profileDesc;
        const isCharacterVideo = false; // avatar presenter photo
        const referenceAudioUrl = profile.avatar_audio_url || "";

        const characterAppearanceText = isCharacterVideo
            ? `Use reference video ONLY for character facial appearance and identity consistency.\n\n${referenceAudioUrl ? "Use reference audio ONLY for voice characteristics.\n\n" : ""}Duration: 15 seconds\nAspect Ratio: 9:16`
            : `Use reference image ONLY for character facial appearance and identity consistency.\n\n${referenceAudioUrl ? "Use reference audio ONLY for voice characteristics.\n\n" : ""}Duration: 15 seconds\nAspect Ratio: 9:16`;

        console.log("Generating simplified prompts...");

        for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i];

            const synthesisPrompt = `You are a professional Prompt Engineer for Bytedance/Kie.ai Seedance 2.0.
Your task is to translate a script scene into a highly effective, minimal, and clean generative video prompt.

CREATOR CHARACTER:
- Description: "${characterDescription}"
- Reference Video Available: ${isCharacterVideo ? 'Yes' : 'No'}

SCENE DETAILS:
- Dialogue: "${scene.dialogue}"
- Visuals/Action: "${scene.visuals || ''}"
- Business: "${businessName}"
- Product: "${productInfo}"
- Custom instructions: "${customInstructions || 'None'}"

REFERENCE IMAGES & DETAILS:
${descriptionsText}

YOUR INSTRUCTIONS:
1. Keep the output prompt clean, short, and to the point. Do NOT include excessive details, bullet points, camera movements, lighting settings, or negative avoid lists. These degrade the model's pronunciation and video quality.
2. Focus on:
   - Defining a simple professional setting and category-appropriate attire.
   - Instructing the presenter to speak directly to the camera in a natural, organic, UGC-like video presentation that does NOT look AI-generated, delivering the dialogue with highly expressive, warm, and enthusiastic energy.
   - Referencing the listing images for clean, simple B-roll transitions if applicable. Explicitly state in the B-roll section: "Only show the parts of the image that are actually visible in the reference image. Do not out-paint, extrapolate, or hallucinate areas outside the reference image borders."
3. If the word 'Mohali' (or 'mohali', 'MOHALI') appears in the dialogue, always write it in Hindi script as 'मोहाली' in the DIALOGUE block. Keep all other words in their original script.
4. Output the prompt following this EXACT format (replace bracketed values, do NOT include markdown backticks or extra text, ensure double newlines between sections):

${characterAppearanceText}

Setting: [Describe simple setting/environment, e.g., "A modern, bright real estate office"]

Presenter: A warm, professional presenter speaking directly to the camera in a natural, organic, UGC-like video that does not look AI. Delivery must be highly expressive, enthusiastic, and natural. Wearing [describe simple attire].

B-Roll: [Describe B-roll transition simply using the reference images, e.g., "Show the villa facade (matching reference image 1) during corresponding dialogue cues. Only show the parts of the image that are actually visible in the reference image. Do not out-paint, extrapolate, or hallucinate areas outside the reference image borders." or "None" if no reference images].

Dialogue:
"${scene.dialogue}"`;

            const { text } = await generateText({
                model: google('gemini-3.5-flash'),
                prompt: synthesisPrompt,
            });

            console.log(`\n================ SIMPLIFIED GENERATED PROMPT FOR SCENE ${i + 1} ================`);
            console.log(text.trim());
            console.log("===========================================================================\n");
        }

    } catch (e) {
        console.error("Error in test generation:", e);
    }
}

run();
