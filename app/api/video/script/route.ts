import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { resolveImageDescriptions } from '@/utils/image-analysis';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { propertyId, concept, userInstructions, images, imageDescriptions: initialImageDescriptions, variation = false, useCharacterVideo = true, duration = 15, language = 'hinglish' } = body;

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

        const videoModel = body.videoModel || 'grok';
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
                    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
                    
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
                        await supabaseAdmin
                            .from('profiles')
                            .update({ character_description: desc })
                            .eq('id', targetUserId);
                        
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
                    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
                    
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
                        await supabaseAdmin
                            .from('profiles')
                            .update({ avatar_description: desc })
                            .eq('id', targetUserId);
                        
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

        // Extract reference images (up to 7 images for Grok Imagine 1.5)
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
            .slice(0, 7);

        // Resolve Image Descriptions from cache/DB if not already provided
        let imageDescriptions = initialImageDescriptions;
        if (!imageDescriptions || !Array.isArray(imageDescriptions) || imageDescriptions.length === 0) {
            imageDescriptions = await resolveImageDescriptions(supabaseAdmin, refImages, propertyId);
        }

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

        const isAvatarPresenter = presenterType === 'avatar' || (presenterType === 'video' && videoModel !== 'grok');

        const targetWordCountMin = (videoModel === 'grok' && !isAvatarPresenter) ? Math.round(duration * 2.3) : (numClips * 34);
        const targetWordCountMax = (videoModel === 'grok' && !isAvatarPresenter) ? Math.round(duration * 2.6) : (numClips * 42);
        const targetAudioDurationSec = Math.round(duration * 0.90);

        const wordCountRule = (videoModel === 'grok' && !isAvatarPresenter)
            ? `11. GROK BACKGROUND VOICEOVER WORD COUNT & PACING RULE: The full dialogue narration script MUST be written as a continuous, high-converting, energetic, and punchy background voiceover copy containing STRICTLY between ${targetWordCountMin} and ${targetWordCountMax} words total. This exact word count ensures that the voiceover spans ${targetAudioDurationSec} seconds of the total ${duration}-second video duration. Do NOT write fluff, fillers, or disconnected sentences. Write tight, fast-flowing, punchy sentences weaving in specific, concrete product facts, features, pricing, location, and key selling points.`
            : `11. CONTINUOUS DIALOGUE & NO SILENT TAIL END RULE: Keep the dialogue for EACH 15-second scene strictly between 34 and 42 words. The presenter/voice MUST speak continuously across the full 15-second scene (from second 0 to second 14). NEVER finish the speech at second 5 or 6 leaving empty silent B-rolls. If B-rolls, walkthroughs, or product cutaways are shown, the speech MUST continue seamlessly throughout the visual motion. Speech and visuals must keep moving together with zero dead air.`;

        const speakerLayoutRule = isAvatarPresenter
            ? `3. Speaker Character & Scenes Layout: Presenter/Avatar (${characterDescription || "a charismatic, professional UGC presenter"}) speaks directly and continuously with engaging hand gestures, natural facial micro-expressions, and authentic conversational cadence. The visuals dynamically showcase product features and B-rolls seamlessly while the presenter's speech continues without interruption.`
            : `3. Speaker Character & Scenes Layout: Pure dynamic commercial B-rolls and product showcases using the reference images with continuous, high-converting background voiceover narration. No talking heads on screen.`;

        const masterPrompt = `You are a world-class Ad Copywriter and UGC Creative Director specializing in viral TikTok, Instagram Reels, and Meta UGC video ads.
Your goal is to write a deeply engaging, high-retention, and high-converting ${duration}-second ad script split into EXACTLY ${numClips} sequential 15-second scenes, using the Emotional Storytelling UGC Framework.

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
1. Duration: STRICTLY ${duration} seconds total, split into exactly ${numClips} sequential 15-second clips (Scene 1 to Scene ${numClips}).
2. Dialogue language: ${languageInstruction}
${speakerLayoutRule}
4. SPOKEN DIALOGUE TONE, VOICE QUALITY & DEEP PSYCHOLOGICAL DEPTH (NO FILLERS):
   - The voice must sound warm, natural, charismatic, and emotionally engaging with organic cadence and expressive tonality. Strictly NO robotic AI monotone.
   - NO generic surface-level fillers ("it is very nice", "check out this space", "khoobsurat ghar", "luxury living").
   - The script must have substance and psychological depth: dive into real pain points (wasted rent, landlord frustrations, child safety, long-term wealth, sanctuary from crowded city life, lifestyle elevation).
   - Map product advantages directly to these emotional triggers with concrete facts, real layouts, actual specifications, and unique amenities.
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

        let script: any = null;
        let scriptJson = "";

        try {
            console.log("[Script API] Generating script with primary model: gemini-3.5-flash");
            const res = await generateText({
                model: google('gemini-3.5-flash'),
                prompt: masterPrompt,
            });
            scriptJson = res.text;

            let cleanJson = scriptJson.trim();
            const firstBrace = cleanJson.indexOf('{');
            const lastBrace = cleanJson.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
            }
            cleanJson = cleanJson.replace(/```json|```/g, '').trim();
            script = JSON.parse(cleanJson);
        } catch (initialErr: any) {
            console.warn("[Script API] Primary script generation/parse failed, retrying with fallback prompt...", initialErr.message);
            try {
                const retryRes = await generateText({
                    model: google('gemini-3.5-flash'),
                    prompt: `${masterPrompt}\n\nCRITICAL: Respond ONLY with a valid raw JSON object. Do NOT wrap in markdown or commentary.`
                });
                let retryJson = retryRes.text.trim();
                const fb = retryJson.indexOf('{');
                const lb = retryJson.lastIndexOf('}');
                if (fb !== -1 && lb !== -1) {
                    retryJson = retryJson.slice(fb, lb + 1);
                }
                script = JSON.parse(retryJson);
            } catch (retryErr: any) {
                console.error("[Script API] Fallback script generation also failed:", retryErr.message);
            }
        }

        if (!script || typeof script !== 'object') {
            return NextResponse.json({ error: "Failed to generate script. Please click Retry Script Generation." }, { status: 500 });
        }

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

    } catch (error: any) {
        console.error("Video Script Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
