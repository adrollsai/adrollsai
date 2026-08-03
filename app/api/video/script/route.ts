import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { propertyId, concept, userInstructions, images, imageDescriptions, variation = false, useCharacterVideo = true, duration = 15, language = 'hinglish' } = body;

        // 1. Fetch Context
        let property: any = null;
        if (propertyId) {
            const { data } = await supabase
                .from('properties')
                .select('*')
                .eq('id', propertyId)
                .single();
            property = data;
        }

        const url = new URL(request.url)
        const impersonateId = url.searchParams.get('impersonate')

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single()
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
          ? (currentProfile.agency_id || currentProfile.parent_id) 
          : user.id

        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    const isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId);
                    const { data: subAccount } = await supabase
                      .from('profiles')
                      .select('id')
                      .eq('id', impersonateId)
                      .eq('agency_id', currentProfile?.agency_id || user.id)
                      .single()

                    if (isParent || subAccount) {
                        targetUserId = impersonateId
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
                    }
                } else {
                    targetUserId = impersonateId
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
            }
        }

        let targetProfile: any = null;
        const selectWithAvatars = await supabase
            .from('profiles')
            .select('business_name, mission_statement, business_info, custom_prompt, character_url, character_description, avatar_url, avatar_description')
            .eq('id', targetUserId)
            .single();

        if (selectWithAvatars.error) {
            console.warn("[Script API] Failed to select with avatar columns, retrying without them:", selectWithAvatars.error.message);
            const selectWithoutAvatars = await supabase
                .from('profiles')
                .select('business_name, mission_statement, business_info, custom_prompt, character_url, character_description')
                .eq('id', targetUserId)
                .single();
            targetProfile = selectWithoutAvatars.data;
        } else {
            targetProfile = selectWithAvatars.data;
        }

        const videoModel = body.videoModel || 'seedance';
        const presenterType = body.presenterType || (useCharacterVideo ? 'video' : 'none');

        if (videoModel !== 'grok') {
            if (presenterType === 'video' && (!targetProfile || !targetProfile.character_url)) {
                return NextResponse.json({ 
                    error: 'Please upload a reference video in your Profile settings or Creation tab first before generating video scripts.' 
                }, { status: 400 });
            }

            if (presenterType === 'avatar' && (!targetProfile || !targetProfile.avatar_url)) {
                return NextResponse.json({ 
                    error: 'Please upload an avatar photo in your Profile settings or Creation tab first before generating video scripts.' 
                }, { status: 400 });
            }
        }

        let profile: any = targetProfile || {};

        // Self-heal: If character_url is present but character_description is null, analyze it on-the-fly!
        if (presenterType === 'video' && profile?.character_url && !profile.character_description) {
            try {
                console.log(`[Self-Healing Script] Character URL is present but description is null. Performing vision analysis for: ${profile.character_url}`);
                const imageRes = await fetch(profile.character_url);
                if (imageRes.ok) {
                    const buffer = Buffer.from(await imageRes.arrayBuffer());
                    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';
                    
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY!);
                    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
                    
                    const visionPrompt = "You are a casting director. Analyze this profile character photo and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.";
                    
                    const result = await model.generateContent([
                        visionPrompt,
                        {
                            inlineData: {
                                data: buffer.toString('base64'),
                                mimeType
                            }
                        }
                    ]);
                    
                    const desc = result.response.text()?.trim();
                    if (desc) {
                        console.log(`[Self-Healing Script] Vision analysis success: "${desc}"`);
                        
                        // Update Supabase using a service role client to bypass client RLS rules
                        const { createClient: createAdminClient } = require('@supabase/supabase-js');
                        const supabaseAdmin = createAdminClient(
                            process.env.NEXT_PUBLIC_SUPABASE_URL!,
                            process.env.SUPABASE_SERVICE_ROLE_KEY!
                        );
                        await supabaseAdmin
                            .from('profiles')
                            .update({ character_description: desc })
                            .eq('id', targetUserId);
                        
                        // Update current object in memory
                        profile.character_description = desc;
                    }
                }
            } catch (visionErr) {
                console.error("[Self-Healing Script] Vision analysis failed:", visionErr);
            }
        }

        // Self-heal for Avatar: If avatar_url is present but avatar_description is null, analyze it on-the-fly!
        if (presenterType === 'avatar' && profile?.avatar_url && !profile.avatar_description) {
            try {
                console.log(`[Self-Healing Script] Avatar URL is present but description is null. Performing vision analysis for: ${profile.avatar_url}`);
                const imageRes = await fetch(profile.avatar_url);
                if (imageRes.ok) {
                    const buffer = Buffer.from(await imageRes.arrayBuffer());
                    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';
                    
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY!);
                    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
                    
                    const visionPrompt = "You are a casting director. Analyze this profile character photo and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.";
                    
                    const result = await model.generateContent([
                        visionPrompt,
                        {
                            inlineData: {
                                data: buffer.toString('base64'),
                                mimeType
                            }
                        }
                    ]);
                    
                    const desc = result.response.text()?.trim();
                    if (desc) {
                        console.log(`[Self-Healing Script] Avatar vision analysis success: "${desc}"`);
                        
                        // Update Supabase using a service role client to bypass client RLS rules
                        const { createClient: createAdminClient } = require('@supabase/supabase-js');
                        const supabaseAdmin = createAdminClient(
                            process.env.NEXT_PUBLIC_SUPABASE_URL!,
                            process.env.SUPABASE_SERVICE_ROLE_KEY!
                        );
                        await supabaseAdmin
                            .from('profiles')
                            .update({ avatar_description: desc })
                            .eq('id', targetUserId);
                        
                        // Update current object in memory
                        profile.avatar_description = desc;
                    }
                }
            } catch (visionErr) {
                console.error("[Self-Healing Script] Avatar vision analysis failed:", visionErr);
            }
        }

        let characterDescription = "";
        if (presenterType === 'video') {
            characterDescription = profile?.character_description || "";
        } else if (presenterType === 'avatar') {
            characterDescription = profile?.avatar_description || "";
        }

        let productInfo = 'Generic product promotion';
        if (property) {
            productInfo = `
Product/Property Name: ${property.title}
Core Description: ${property.description || "N/A"}
Price/Pricing Info: ${property.price || "N/A"}
Location/Address: ${property.address || "N/A"}
Amenities/Features: ${property.amenities || "N/A"}
`;
        }
        const businessName = profile?.business_name || 'Your Business';
        const brandGuidelines = profile?.custom_prompt || '';

        // Extract reference images (max 4) - Filter out invalid placeholders/empty strings
        let rawImages: string[] = [];
        if (images && Array.isArray(images) && images.length > 0) {
            rawImages = images;
        } else if (property) {
            if (property.images && Array.isArray(property.images) && property.images.length > 0) {
                rawImages = property.images;
            } else if (property.image_url) {
                rawImages = [property.image_url];
            }
        }

        const refImages = rawImages
            .filter(img => img && typeof img === 'string' && img.startsWith('http') && !img.includes('placeholder') && !img.includes('placehold') && img !== 'null' && img !== 'undefined')
            .slice(0, 8);

        // Determine language based on the explicit language toggle first, then fall back to instruction text parsing
        const isEnglish = language === 'english';
        const userText = (userInstructions || '').toLowerCase();
        let languageInstruction: string;
        
        if (isEnglish) {
            languageInstruction = "The script dialogue MUST be written entirely in ENGLISH using standard English letters. Do NOT use any Hindi, Hinglish, or Devanagari script anywhere. All dialogue must be clear, professional, and natural-sounding English.";
        } else if (userText.includes('in english') || userText.includes('only english') || userText.includes('english language')) {
            languageInstruction = "The script dialogue MUST be written in ENGLISH using standard English letters.";
        } else if (userText.includes('in hindi') || userText.includes('only hindi')) {
            languageInstruction = "The script dialogue MUST be written in HINDI using native Devanagari script (Hindi characters).";
        } else {
            languageInstruction = "The script dialogue MUST be written in Roman Hinglish (mixing Hindi words written in English/Latin letters and standard English words) from a strict 3rd-person perspective, focusing objectively on detailing product/property features and specifications. Avoid any first-person or second-person commands, calls, or conversational host words like 'dekhiye', 'check out', 'aapko milega', 'yahan', etc. Describe the property name and features objectively (e.g. 'IT City Mohaali ka ye luxury penthouse modern architecture aur spacious layout ke sath aata hai'). Specifically, you MUST write any Indian-specific city names (e.g. 'मोहाली' instead of 'Mohali', 'चंडीगढ़' instead of 'Chandigarh', 'दिल्ली' instead of 'Delhi', 'मुंबई' instead of 'Mumbai', 'नोएडा' instead of 'Noida', 'गुड़गांव' instead of 'Gurgaon', 'ज़िरकपुर' instead of 'Zirakpur', 'पंचकुला' instead of 'Panchkula', 'जयपुर' instead of 'Jaipur', etc.), project names (e.g. 'अमायरा स्काई सिटी' instead of 'Amayra Sky City'), and institutions/universities (e.g. 'रयात बहरा' instead of 'Rayat Bahra', 'चितकारा' instead of 'Chitkara', 'यूनिवर्सिटी' instead of 'University') in native Hindi Devanagari script to ensure perfect pronunciation by the voice model. All other words in the dialogue must be written in standard Roman characters. Everyday English loanwords (like 'dream home', 'perfect space', 'luxury flat', 'living room', 'security', 'location', 'get in touch') must remain in standard English letters.";
        }

        const variationInstruction = variation 
            ? "This is a request for an alternate variation/concept angle. Generate a completely different, fresh visual hook and messaging angle from any previously generated script for this concept, making it even more unique and engaging!"
            : "";

        const descriptionsText = (imageDescriptions || [])
            .map((desc: string, i: number) => `- Image ${i + 1} Visual Description: "${desc}"`)
            .join('\n');

        const numClips = Math.ceil(duration / 15);
        let scenesSchema = "";
        for (let i = 1; i <= numClips; i++) {
            const dialogueExample = isEnglish 
                ? `Plain text of the English speech for Scene ${i} (comfortably spoken in 15 seconds, strictly under 30 words)`
                : `Plain text of the Hinglish speech in Roman characters for Scene ${i} (comfortably spoken in 15 seconds, strictly under 30 words)`;
            scenesSchema += `    {
      "dialogue": "${dialogueExample}",
      "visuals": "Highly detailed visual instructions describing Scene ${i} (15s). Detail the outfit and location of the presenter altered and customized based on the project theme. Describe property/product B-rolls cuts showcasing key features (using matching reference image details) with the presenter temporarily off-screen."
    }${i < numClips ? ',\n' : ''}`;
        }

        // Build language-appropriate framework prompts with examples
        const hookExampleText = isEnglish 
            ? '"Looking for your dream home in Mohali but can\'t find the right space?"'
            : '"Mohali mein apna dream home dhoond rahe ho par perfect space nahi mil raha?"';

        let frameworkPrompt = "";
        if (numClips === 1) {
            frameworkPrompt = `1. THE EMOTIONAL HOOK & CTA (Scene 1: 0:00 - 0:15): Open with an instant visual hook in the first 2 seconds, and IMMEDIATELY call out the target audience in the very first line of spoken dialogue (e.g. if selling homes in Mohali, call out home buyers in Mohali in the first line, like ${hookExampleText}). Grab attention with a warm, deeply human, emotionally resonant hook statement, connect it to the product's deep psychological value, and conclude with a warm, low-friction invitation to take the next step.`;
        } else if (numClips === 2) {
            frameworkPrompt = `1. THE EMOTIONAL HOOK (Scene 1: 0:00 - 0:15): Open with an instant visual hook in the first 2 seconds, and IMMEDIATELY call out the target audience in the very first line of spoken dialogue (e.g. if selling homes in Mohali, call out home buyers in Mohali in the first line, like ${hookExampleText}). Grab attention with a warm, deeply human, emotionally resonant hook statement and establish the core value.
2. THE WARM CALL TO ACTION & CONNECTION (Scene 2: 0:15 - 0:30): Highlight the emotional comfort/belonging, show how it solves the psychological pain, and end with a friendly, welcoming, and low-friction invitation to contact, buy, or get in touch.`;
        } else if (numClips === 3) {
            frameworkPrompt = `1. THE EMOTIONAL HOOK (Scene 1: 0:00 - 0:15): Open with an instant visual hook in the first 2 seconds, and IMMEDIATELY call out the target audience in the very first line of spoken dialogue (e.g. if selling homes in Mohali, call out home buyers in Mohali in the first line, like ${hookExampleText}). Grab attention with a warm, deeply human, emotionally resonant statement or relatable aspiration.
2. THE EMOTIONAL CONNECTION (Scene 2: 0:15 - 0:30): Bridge the hook by showing the product, how it works, and how it brings comfort, security, or success.
3. THE WARM CALL TO ACTION (Scene 3: 0:30 - 0:45): Conclude with a friendly, welcoming, and low-friction invitation to take the next step.`;
        } else {
            frameworkPrompt = `1. THE EMOTIONAL HOOK (Scene 1: 0:00 - 0:15): Open with an instant visual hook in the first 2 seconds, and IMMEDIATELY call out the target audience in the very first line of spoken dialogue (e.g. if selling homes in Mohali, call out home buyers in Mohali in the first line, like ${hookExampleText}). Grab attention with a warm, deeply human, emotionally resonant statement or relatable aspiration.
2. THE EMOTIONAL CONNECTION (Scene 2: 0:15 - 0:30): Bridge the hook by outlining the viewer's core challenge or aspiration.
3. THE SOLUTION (Scene 3: 0:30 - 0:45): Introduce the product/service and demonstrate how it solves the pain points beautifully.
4. THE WARM CALL TO ACTION (Scene 4: 0:45 - 1:00): Conclude with a friendly, welcoming, and low-friction invitation to take the next step.`;
        }

        const targetWordCountMin = videoModel === 'grok' ? Math.round(duration * 2.2) : (numClips * 36);
        const targetWordCountMax = videoModel === 'grok' ? Math.round(duration * 2.4) : (numClips * 44);
        const targetAudioDurationSec = Math.round(duration * 0.85);

        const wordCountRule = videoModel === 'grok'
            ? `11. GROK BACKGROUND VOICEOVER WORD COUNT & PACING RULE: The full dialogue narration script MUST be written as a continuous, high-converting, energetic, and punchy background voiceover copy containing STRICTLY between ${targetWordCountMin} and ${targetWordCountMax} words total. This exact word count ensures that the generated TTS voiceover spans ${targetAudioDurationSec} seconds of the total ${duration}-second video duration. Do NOT write fluff or extra long sentences. Write tight, fast-flowing, punchy sentences weaving in specific, concrete product facts, features, pricing, location, and key selling points.`
            : `11. Speech length & Word Count limits: Keep the dialogue for EACH scene strictly between 36 and 44 words so it can be naturally and comfortably spoken in 15 seconds, filling the scene time without feeling empty. Ensure dialogue is distributed proportionally to scene timestamps.`;

        const masterPrompt = `You are a world-class Ad Copywriter and UGC Creative Director specializing in TikTok, Instagram Reels, and Meta UGC ads.
Your goal is to write a deeply emotional, highly engaging, and highly converting ${duration}-second ad script split into EXACTLY ${numClips} sequential 15-second scenes, using the Emotional Storytelling UGC Framework.

Business Name: ${businessName}
Showcase Details: ${profile?.mission_statement || 'N/A'}
AI Context / Business Background: ${profile?.business_info || 'N/A'}
Global Visual Style: ${brandGuidelines}
Product/Service Info: ${productInfo}
Selected Concept:
- Title: ${concept?.title || 'General Ad'}
- Hook: ${concept?.hook || 'Catchy opening'}
- Description: ${concept?.description || 'Organic UGC style'}
- Visual Angle: ${concept?.visualConcept || 'Show product'}

Custom Instructions from User: ${userInstructions || 'None'}
Reference Images and their visual content descriptions to use instead of generic text placeholders:
${descriptionsText || 'No image descriptions provided.'}

EMOTIONAL STORYTELLING UGC FRAMEWORK:
${frameworkPrompt}
(Note: The examples above are strictly illustrative. The generated script MUST follow the hook, visual style, and narrative angle defined in the Selected Concept below rather than copying these illustrative examples verbatim.)

CONSTRAINTS & RULES:
0. CRITICAL CUSTOM INSTRUCTIONS PRIORITIZATION RULE: You MUST strictly prioritize and adhere to the user's Custom Instructions: "${userInstructions || 'None'}". Every aspect of the generated script—including dialogue, tone, hook, environment details, actions, and scene visual descriptions—must be designed and written specifically to follow these instructions first and foremost. Do not ignore them or generate generic default templates that do not reflect what the user has requested.
0.1. CRITICAL COHESIVE SELECTED CONCEPT RULE: You MUST strictly base the entire script's hook, narrative, dialogue, and visual flow directly and cohesively on the provided Selected Concept (Title: "${concept?.title || 'N/A'}", Hook: "${concept?.hook || 'N/A'}", Description: "${concept?.description || 'N/A'}", and Visual Angle: "${concept?.visualConcept || 'N/A'}").
   - The dialogue in Scene 1 MUST start with or heavily incorporate the specific opening hook dialogue: "${concept?.hook || 'N/A'}". If the Selected Concept's hook is written in English, you MUST translate and adapt it to the target language on the fly to match our language rules.
   - The visual flow in both Scene 1 and Scene 2 MUST strictly implement the visual scene instructions and style described in the Selected Concept's Visual Angle: "${concept?.visualConcept || 'N/A'}".
   - Do NOT ignore the Selected Concept! Cohesion between the chosen concept/angle and the generated script is a top-level rule.
0.2. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT & VISUAL HOOK RULE:
   - The very first line of the spoken dialogue (Scene 1, first 2 seconds) MUST call out the target audience explicitly (e.g. if selling homes in Mohali, call out home buyers in Mohali in the first line, like: "Mohali mein apna dream home dhoondh rahe ho?").
   - ${isEnglish ? 'The script\'s spoken dialogue MUST be entirely in English from the very first word. No Hindi, Hinglish, or Devanagari script.' : 'The script\'s spoken dialogue MUST be written in Hinglish using standard Roman/English characters, EXCEPT for Indian proper nouns, location names, project names, and institution names (like मोहाली, चंडीगढ़, चितकारा, रयात बहरा, अमायरा स्काई सिटी) which MUST be written in native Hindi Devanagari script.'}
   - Scene 1 visuals MUST open with an instant, scroll-stopping visual hook.
1. Duration: STRICTLY ${duration} seconds total, split into exactly ${numClips} sequential 15-second clips (Scene 1 to Scene ${numClips}). Deeply emotional, slow-paced, warm, and natural.
2. Dialogue language: ${languageInstruction}
3. Speaker Character & Scenes Layout: ${videoModel === 'grok' ? 'Background Voiceover Narration over dynamic 9:16 product collages and B-rolls.' : (presenterType !== 'none' ? (characterDescription || "a stunningly beautiful, highly attractive, charismatic, extremely charming, and appealing Indian female UGC content creator with a fair complexion") : "a highly professional, friendly, and charismatic UGC presenter speaking clearly and warmly to the camera")}
   - Describe property/product B-rolls cuts showcasing key features using matching reference image details.
4. Spoken Dialogue Tone, Voice Quality & Deep Psychological Depth: The voice must sound warm, natural, smooth, pleasing to listen to, and emotionally engaging.
   - ABSOLUTELY NO Alex Hormozi frameworks, direct-response hype, aggressive value-stacking, or fast-talking hooks.
   - The script must have immense depth and empathy. You must dig deep into the psychological pain points of the business's target audience. E.g., if selling real estate, target the deep emotional anxiety of wastefully paying rent, landlord hassles, security and comfort for children/parents, the fear of delayed projects, wanting luxury/status, or needing peace of mind.
   - Map the values of our product/service directly to these deep-seated emotional pain points. Explain exactly how our product delivers the ultimate comfort, relief, security, or wealth creation that they desire.
   - Avoid surface-level marketing listicles or generic features. Write complete, smooth, conversational sentences that produce feelings of warmth, family comfort, safety, and deep emotional resonance.
4.3. CRITICAL CONCRETE PRODUCT DETAILS RULE (DO NOT BE VAGUE):
   - You MUST explicitly weave the actual, concrete facts, features, price, and specifications of the product/property (such as the specific location, name, price, unique layouts, or key amenities) directly into the spoken dialogue. Describe the features that actually matter to the viewer (e.g. only 2 apartments per floor, fully automated smart features, rooftop pool) to drive conversions.
   - Do NOT use vague marketing terms, generic placeholders (like "[price]", "[location]", "[insert details]"), or broad fluff. The script must communicate real, informative details about the product so that the video provides actual, concrete information to the viewer. Do NOT mention RERA IDs or registration numbers in the video dialogue.
4.1. NATURAL BODY LANGUAGE & GESTURES: In all visual instructions, movements should feel organic and alive like a real UGC creator.
${isEnglish ? `4.2. PRONUNCIATION: Use clear, standard English vocabulary. Keep the language accessible and professional. Avoid jargon or overly complex words.` : `4.2. PRONUNCIATION WORKAROUND (STRICTLY AVOID COMPLEX HINDI WORDS):
   - To guarantee flawless natural pronunciation, you MUST strictly avoid complex, bookish, or heavy Hindi vocabulary (e.g. absolutely DO NOT write words phonetically like 'susajjit', 'aalishan', 'vastukala', 'pratishthit', 'suvidhajanak', 'vatankoolit', 'aakanksha', 'pratishtha', 'surakshit', 'parikalpana', 'keemat').
   - Instead, ALWAYS use extremely simple, clear, conversational, everyday spoken Hindi words phonetically (e.g. 'ghar' instead of complex synonyms, 'chain', 'sukoon', 'khushi', 'aasan', 'budget', 'best').
   - Write Hindi words in Roman letters phonetically as they are pronounced (e.g., 'shuruaat', 'dhoondh', 'apna', 'achha'). Everyday English loanwords (like 'luxury', 'location', 'perfect', 'amenities', 'living', 'security', 'space', 'safe', 'family', 'balance') are highly preferred.`}
5. STRICT NO-CTA IN EARLY SCENES RULE: Under no circumstances should early scenes contain any call to action. The Call to Action (CTA) must ONLY appear at the very end of the script.
6. DYNAMIC AUDIENCE & NICHING ALIGNMENT: Tailor the hook and pain points exactly to the product's value tier.
7. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue.
8. STRICT ENVIRONMENT CONSTRAINT: Constrain all environment and visual action sequences strictly to the physical details actually visible in the reference images.
9. Visual scene descriptions: Refer to the reference images by their actual visual descriptions naturally.
10. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen.
${wordCountRule}
12. ${variationInstruction}

Output format must be a single, valid JSON object:
{
  "title": "Short catchy title",
  "dialogue": "Plain text of the dialogue combined for all scenes (for backward compatibility)",
  "visuals": "Highly detailed visual instructions combined for all scenes (for backward compatibility)",
  "scenes": [
${scenesSchema}
  ],
  "finalCaption": "Compelling, high-converting FB ad caption copy (include emojis, call to action, but NO hashtags, NO bold markdown)."
}

Output ONLY valid JSON. Do not include markdown code block tags around JSON.`;

        console.log("\n===============================================================================");
        console.log("=== GEMINI VIDEO SCRIPT GENERATION PROMPT ===");
        console.log(masterPrompt);
        console.log("===============================================================================\n");

        let scriptJson = "";
        console.log("[Script API] Generating script with primary model: gemini-3.5-flash");
        try {
            const res = await generateText({
                model: google('gemini-3.5-flash'),
                prompt: masterPrompt,
            });
            scriptJson = res.text;
        } catch (e35: any) {
            try {
                const res = await generateText({
                    model: google('gemini-2.0-flash'),
                    prompt: masterPrompt,
                });
                scriptJson = res.text;
            } catch (e20: any) {
                const res = await generateText({
                    model: google('gemini-1.5-flash'),
                    prompt: masterPrompt,
                });
                scriptJson = res.text;
            }
        }

        try {
            const cleanJson = scriptJson.replace(/```json|```/g, '').trim();
            const script = JSON.parse(cleanJson);
            
            // Dynamic clip count validation and padding/truncating
            if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
                script.scenes = [];
                for (let i = 0; i < numClips; i++) {
                    script.scenes.push({
                        dialogue: i === numClips - 1 ? "get in touch today" : "kya aap ready hain?",
                        visuals: "Creator smiling and looking at the camera."
                    });
                }
            } else if (script.scenes.length !== numClips) {
                if (script.scenes.length > numClips) {
                    script.scenes = script.scenes.slice(0, numClips);
                } else {
                    while (script.scenes.length < numClips) {
                        script.scenes.push({
                            dialogue: "get in touch today",
                            visuals: "Creator smiling and waving at the camera."
                        });
                    }
                }
            }

            return NextResponse.json({
                success: true,
                ...script,
                imageDescriptions: imageDescriptions || [],
                refImages
            });
        } catch (e) {
            console.error("Failed to parse script JSON:", scriptJson);
            return NextResponse.json({ error: "Failed to generate Hinglish script." }, { status: 500 });
        }

    } catch (error: any) {
        console.error("Video Script Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
