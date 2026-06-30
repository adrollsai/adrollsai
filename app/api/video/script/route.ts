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

        const presenterType = body.presenterType || (useCharacterVideo ? 'video' : 'none');

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
            languageInstruction = "The script dialogue MUST be written in Roman Hinglish (mixing Hindi words written in English/Latin letters and standard English words, e.g. 'Mohali mein apna dream home dhoondh rahe ho?'). Specifically, do NOT use Devanagari characters (like 'क्या', 'है') anywhere in the script. The dialogue must be written entirely in Roman characters. Everyday English loanwords (like 'dream home', 'perfect space', 'luxury flat', 'living room', 'security', 'location', 'get in touch') must remain in standard English letters.";
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
   - ${isEnglish ? 'The script\'s spoken dialogue MUST be entirely in English from the very first word. No Hindi, Hinglish, or Devanagari script.' : 'The script\'s spoken dialogue MUST be written in Hinglish using ONLY standard Roman/English characters. Do NOT use any Devanagari script anywhere.'}
   - Scene 1 visuals MUST open with an instant, scroll-stopping visual hook.
1. Duration: STRICTLY ${duration} seconds total, split into exactly ${numClips} sequential 15-second clips (Scene 1 to Scene ${numClips}). Deeply emotional, slow-paced, warm, and natural.
2. Dialogue language: ${languageInstruction}
3. Speaker Character & Scenes Layout: The speaker in all scenes MUST be ${presenterType !== 'none' ? (characterDescription || "a stunningly beautiful, highly attractive, charismatic, extremely charming, and appealing Indian female UGC content creator with a fair complexion") : "a highly professional, friendly, and charismatic UGC presenter speaking clearly and warmly to the camera"} (speaking directly to the camera and showcasing/talking about the product/service with warm relatable energy).
   - For EACH scene, describe an appropriate outfit and location for the presenter, altering and customizing them based on the specific project or property theme (e.g., luxury penthouse office, elegant corporate desk, cozy modern living room) to fit the project tier.
   - There MUST be specific cuts or b-rolls of the property or product (visualized from the reference images/info) integrated into each scene, showing details that matter to the viewer, with the presenter momentarily off-screen during the b-roll before cutting back to the presenter speaking directly to the camera.
   - Medium closeup shots chest-up are required when the presenter is on camera to avoid facial mutations. Avoid wide shots of the presenter.
4. Spoken Dialogue Tone, Voice Quality & Deep Psychological Depth: The voice must sound warm, natural, smooth, pleasing to listen to, and emotionally engaging.
   - ABSOLUTELY NO Alex Hormozi frameworks, direct-response hype, aggressive value-stacking, or fast-talking hooks.
   - The script must have immense depth and empathy. You must dig deep into the psychological pain points of the business's target audience. E.g., if selling real estate, target the deep emotional anxiety of wastefully paying rent, landlord hassles, security and comfort for children/parents, the fear of delayed projects, wanting luxury/status, or needing peace of mind.
   - Map the values of our product/service directly to these deep-seated emotional pain points. Explain exactly how our product delivers the ultimate comfort, relief, security, or wealth creation that they desire.
   - Avoid surface-level marketing listicles or generic features. Write complete, smooth, conversational sentences that produce feelings of warmth, family comfort, safety, and deep emotional resonance.
4.3. CRITICAL CONCRETE PRODUCT DETAILS RULE (DO NOT BE VAGUE):
   - You MUST explicitly weave the actual, concrete facts, features, price, and specifications of the product/property (such as the specific location, name, price, unique layouts, or key amenities) directly into the spoken dialogue. Describe the features that actually matter to the viewer (e.g. only 2 apartments per floor, fully automated smart features, rooftop pool) to drive conversions.
   - Do NOT use vague marketing terms, generic placeholders (like "[price]", "[location]", "[insert details]"), or broad fluff. The script must communicate real, informative details about the product so that the video provides actual, concrete information to the viewer. Do NOT mention RERA IDs or registration numbers in the video dialogue.
4.1. NATURAL BODY LANGUAGE & GESTURES: In all visual instructions, the character must have highly natural, dynamic, and expressive body language — real hand gestures while talking, subtle head tilts, natural eye contact shifts, genuine smiling, leaning in/out, touching/pointing at products naturally. Their movements should feel organic and alive like a real UGC creator, NOT stiff, static, or robotic.
${isEnglish ? `4.2. PRONUNCIATION: Use clear, standard English vocabulary. Keep the language accessible and professional. Avoid jargon or overly complex words.` : `4.2. PRONUNCIATION WORKAROUND (STRICTLY AVOID COMPLEX HINDI WORDS):
   - The AI speech synthesizer frequently stumbles or produces errors when trying to pronounce complex, formal, or Sanskritized Hindi words.
   - To guarantee flawless natural pronunciation, you MUST strictly avoid complex, bookish, or heavy Hindi vocabulary (e.g. absolutely DO NOT write words phonetically like 'susajjit', 'aalishan', 'vastukala', 'pratishthit', 'suvidhajanak', 'vatankoolit', 'aakanksha', 'pratishtha', 'surakshit', 'parikalpana', 'keemat').
   - Instead, ALWAYS use extremely simple, clear, conversational, everyday spoken Hindi words phonetically (e.g. 'ghar' instead of complex synonyms, 'chain', 'sukoon', 'khushi', 'aasan', 'budget', 'best').
   - Write Hindi words in Roman letters phonetically as they are pronounced (e.g., 'shuruaat', 'dhoondh', 'apna', 'achha'). Everyday English loanwords (like 'luxury', 'location', 'perfect', 'amenities', 'living', 'security', 'space', 'safe', 'family', 'balance') are highly preferred and pronounced perfectly by the voice model.`}
5. STRICT NO-CTA IN EARLY SCENES RULE: Under no circumstances should early scenes contain any call to action, phone number, contact prompt, social handle reference, or request to purchase/visit. Early scenes must focus exclusively on the scroll-stopping hook and problem bridge. The Call to Action (CTA) to contact, buy, or get in touch must ONLY appear at the very end of the final Scene ${numClips} (the last 5 seconds).
6. DYNAMIC AUDIENCE & NICHING ALIGNMENT: Analyze the product context and target buyer carefully. Tailor the hook and pain points exactly to the product's value tier. Do NOT use mismatched defaults (e.g. do NOT talk about 'renting vs buying' or 'saving rent money' if the product is a luxury 1.6 Cr home, commercial estate, or high-end service; instead, focus on exclusive lifestyle, status, growth, smart wealth investment, and ROI). Keep it fully aligned so that the copywriting angle naturally scales from premium commercial/residential buyers to budget-conscious daily e-commerce shoppers based on the product description provided.
7. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue. If the product info or call-to-action implies a phone number, the creator must ONLY say ${isEnglish ? '"get in touch" or "contact us today"' : '"get in touch" (or natural Hinglish equivalents like "humein contact karein" or "get in touch ho jao")'} instead. Under no circumstances should the spoken dialogue contain any digits, numbers, or spoken phone numbers.
8. STRICT ENVIRONMENT CONSTRAINT (Prevents Hallucinations): Constrain all environment and visual action sequences strictly to the physical details actually visible in the reference images. Do NOT invent, assume, or hallucinate rooms, structures, product features, or details that are not shown in the reference photos.
9. Visual scene descriptions: Refer to the reference images by their actual visual descriptions naturally so the video generator knows exactly which image is used in each scene. Do NOT use abstract placeholders like "@Image 1", "@Image 2", "Image 1", or "Image 2" in the script or visual description.
10. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen in any script or visuals section, as the video AI generates garbled text and distorted logos.
11. Speech length & Word Count limits: Keep the dialogue for EACH scene strictly under 30 words so it can be comfortably spoken in 15 seconds. Ensure that only that amount of words are in the dialogue that can easily fit in a 15-second clip, and this must be strictly done for all clips.
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
        try {
            console.log("[Script API] Generating script with primary model: gemini-3.5-flash");
            const res = await generateText({
                model: google('gemini-3.5-flash'),
                prompt: masterPrompt,
            });
            scriptJson = res.text;
        } catch (err: any) {
            console.warn("[Script API] Primary model failed. Falling back to gemini-3-flash-preview...", err.message);
            const res = await generateText({
                model: google('gemini-3-flash-preview'),
                prompt: masterPrompt,
            });
            scriptJson = res.text;
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
