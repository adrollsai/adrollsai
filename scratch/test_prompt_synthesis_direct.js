require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { generateText } = require('ai');
const { google } = require('@ai-sdk/google');

async function testPromptSynthesis() {
    console.log("Starting restructured prompt synthesis test...");
    
    // 1. Mock inputs
    const businessName = "Ad Rolls AI";
    const productInfo = "Product: Rolls! Description: Ad rolls AI creates stunning creatives and videos for Real Estate business owners to scale business.";
    const brandGuidelines = "Natural UGC style, confident salesperson, friendly tone.";
    const customInstructions = "Create a premium real estate ad promoting easy creative video generation.";
    const isCharacterVideo = true;
    const characterDescription = "A professional young Indian man with short black hair, clean-shaven, wearing a beige blazer over a white tee, smiling warmly.";
    
    const sampleScene = {
        dialogue: "Real Estate business owners, क्या property listings के लिए daily graphics और videos बनाना सिरदर्द बन चुका है? Meet Rolls! Ad rolls AI से minutes में stunning creatives बनाओ और business scale करो. Get in touch!",
        visuals: "A professional speaking directly to the camera while walking slowly through a modern corporate office."
    };

    const imageDescriptions = [
        "A premium modern living room with a large window and elegant furniture",
        "A smartphone showing the Ad Rolls AI dashboard with stunning visuals being rendered in seconds"
    ];

    const descriptionsText = imageDescriptions
        .map((desc, i) => `- Reference Image ${i + 1} description: "${desc}"`)
        .join('\n') || 'No detailed image descriptions provided.';

    const characterAppearanceText = isCharacterVideo
        ? "Use reference video only for character appearance.\nUse reference audio only for voice characteristics."
        : "Use reference photo only for character appearance.";

    // 2. The exact same prompt we wrote in app/api/video/generate/route.ts
    const synthesisPrompt = `You are a professional Prompt Engineer for Video Generative AI.
Translate the following specific scene from a script into a simple, high-performing generative prompt for Bytedance/Kie.ai Seedance 2.0.

Scene Number: 1 of 1
Scene Dialogue: "${sampleScene.dialogue}"
Scene Visuals: "${sampleScene.visuals || ''}"
Business name: "${businessName}"
Product context: "${productInfo}"
User's brand style: "${brandGuidelines}"
Custom instructions: "${customInstructions || 'None'}"

CREATOR CHARACTER:
- Description: "${characterDescription}"
- Reference Video Available: ${isCharacterVideo ? 'Yes' : 'No'}

REFERENCE IMAGES & DETAILS (Vision-analyzed descriptions of the reference images provided in this ad creation task):
${descriptionsText}

YOUR INSTRUCTIONS:
1. Generate a structured generative video prompt. Do NOT use markdown headers (like #, ##) or code blocks or bracketed blocks like [Action]. Follow the exact structure shown below.
2. Analyze the reference images description provided. See where they fit well in the video (e.g., background elements, products held in hand, or visually matching scene/product details) and prompt them accordingly in the "Action" or "Style" section of the output prompt.
3. Determine a suitable outfit/attire and setting for the character based on the business name, product, brand guidelines, and script context (e.g., a beige blazer over a white tee in a modern corporate office, a premium casual shirt in a cozy living room, premium wear in a luxury apartment, etc.). Always explicitly describe the attire and setting.
4. Add personality and delivery details for the dialogue to guide the voice and face generation (e.g., speech rate, facial expressions, hand gestures, posture).
5. Output the prompt following this EXACT format (ensure correct line breaks and labels):

${characterAppearanceText}

Character maintains eye contact with camera throughout. He/She is wearing [describe appropriate attire here] and is [describe appropriate location/setting here].

Dialogue:
"[dialogue text to be spoken]"

Speech Style:
[Describe delivery with rich personality, tone, emotion, and pace, e.g., "Natural conversation, confident salesperson, friendly tone and subtle smile."]

Action:
[Describe the precise actions the character is performing. Incorporate/fit the reference images/products if they fit, e.g., "Speaking directly to the viewer while walking slowly through the corporate office, occasionally gesturing with hands to emphasize points. In the background, reference image of the modern living room is visible."]

Camera:
[Describe the camera perspective, e.g., "Front tracking shot, keeping face centered."]

Style:
[Describe the visual aesthetics and production quality, e.g., "Premium real estate advertisement, realistic motion, professional presentation."]

Avoid:
No overlay Text, No overlay captions

6. Do NOT wrap the prompt in backticks or markdown code blocks. Output the pure text prompt only.`;

    console.log("Synthesis prompt formulated. Calling Gemini...");
    try {
        const { text } = await generateText({
            model: google('gemini-3.5-flash'),
            prompt: synthesisPrompt,
        });

        console.log("\n=================== SYNTHESIZED PROMPT OUTPUT ===================");
        console.log(text.trim());
        console.log("=================================================================\n");
        
    } catch (err) {
        console.error("Error during prompt synthesis call:", err);
    }
}

testPromptSynthesis();
