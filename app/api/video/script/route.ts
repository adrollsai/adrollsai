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
        const { propertyId, concept, userInstructions, images, imageDescriptions, variation = false } = body;

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

        const { data: targetProfile } = await supabase
            .from('profiles')
            .select('business_name, mission_statement, custom_prompt, character_url, character_description')
            .eq('id', targetUserId)
            .single();

        if (!targetProfile || !targetProfile.character_url) {
            return NextResponse.json({ 
                error: 'Please upload a character photo in your profile settings first before generating video scripts.' 
            }, { status: 400 });
        }

        let profile = targetProfile;

        // Self-heal: If character_url is present but character_description is null, analyze it on-the-fly!
        if (profile?.character_url && !profile.character_description) {
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

        const productInfo = property ? `Product: ${property.title}. Description: ${property.description}` : 'Generic product promotion';
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
            .filter(img => img && typeof img === 'string' && img.startsWith('http') && !img.includes('placeholder') && img !== 'null' && img !== 'undefined')
            .slice(0, 4);

        // Determine if Hinglish should be used (default to true, unless user instructions explicitly request English/another language)
        const userText = (userInstructions || '').toLowerCase();
        let languageInstruction = "The script dialogue MUST be written in conversational hybrid language (e.g., Hindi-English / Hinglish). To ensure correct and authentic text-to-speech native pronunciation, write ALL words that belong to the Hindi or Indian context (including city names like 'जीरकपुर', 'मोहाली', 'चंडीगढ़', 'दिल्ली', and common Indian terms like 'घर', 'पैसे', 'बिज़नेस', 'प्रॉपर्टी', 'मार्केट') in the actual Hindi (Devanagari) script. Do NOT write Hindi/Indian words or Indian city names in English script. ONLY keep standard global English terms (like 'rent', 'location', 'search', 'investment', 'luxury') in the standard English script. This is critical: if a word is Hindi or refers to an Indian context/location, it MUST be written in Devanagari script!";
        if (userText.includes('in english') || userText.includes('only english') || userText.includes('english language')) {
            languageInstruction = "The script dialogue MUST be written in ENGLISH as explicitly requested.";
        } else if (userText.includes('in hindi') || userText.includes('only hindi')) {
            languageInstruction = "The script dialogue MUST be written in pure HINDI (written in Devanagari script).";
        }

        const variationInstruction = variation 
            ? "This is a request for an alternate variation/concept angle. Generate a completely different, fresh visual hook and messaging angle from any previously generated script for this concept, making it even more unique and engaging!"
            : "";

        const descriptionsText = (imageDescriptions || [])
            .map((desc: string, i: number) => `- Image ${i + 1} Visual Description: "${desc}"`)
            .join('\n');

        const masterPrompt = `You are a world-class Ad Copywriter and UGC Creative Director specializing in TikTok, Instagram Reels, and Meta UGC ads.
Your goal is to write a deeply emotional, highly engaging, and highly converting 30-second ad script split into EXACTLY two sequential 15-second scenes, using the Emotional Storytelling UGC Framework.

Business Name: ${businessName}
Mission: ${profile?.mission_statement || 'N/A'}
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
1. THE EMOTIONAL HOOK (Scene 1: 0:00 - 0:05): Grab attention with a warm, deeply human, emotionally resonant statement or relatable aspiration (e.g. *"क्या आप भी अपने परिवार के लिए एक ऐसे घर का सपना देखते हैं जहाँ सुकून हो?"* or *"Imagine a life where luxury meets absolute peace..."*). Speak directly to the viewer's heart.
2. THE EMOTIONAL CONNECTION (Scene 1 & 2: 0:05 - 0:25): Bridge the hook by showing the feeling of comfort, pride, success, peace of mind, or belonging. Highlight the human value—how this product or space makes their life beautiful, secure, and complete. Focus on generating feelings of warmth, security, and aspiration.
3. THE WARM CALL TO ACTION (Scene 2: 0:25 - 0:30): A friendly, welcoming, and low-friction invitation to take the next step (e.g. *"आइए, इस सपने को मिलकर सच करते हैं। हमसे अभी संपर्क करें।"*). Make it feel like connecting with a trusted friend.

CONSTRAINTS & RULES:
0. CRITICAL CUSTOM INSTRUCTIONS PRIORITIZATION RULE: You MUST strictly prioritize and adhere to the user's Custom Instructions: "${userInstructions || 'None'}". Every aspect of the generated script—including dialogue, tone, hook, environment details, actions, and scene visual descriptions—must be designed and written specifically to follow these instructions first and foremost. Do not ignore them or generate generic default templates that do not reflect what the user has requested.
1. Duration: STRICTLY 30 seconds total, split into exactly TWO sequential 15-second clips (Scene 1: 0:00-0:15 and Scene 2: 0:15-0:30). Deeply emotional, slow-paced, warm, and natural.
2. Dialogue language: ${languageInstruction}
3. Speaker Character: The speaker in both scenes MUST be ${profile?.character_description || "a stunningly beautiful, highly attractive, charismatic, extremely charming, and appealing Indian female UGC content creator with a fair complexion"} (speaking directly to the camera and showcasing/talking about the product/service with warm relatable energy). Their appearance must be identical and consistent across both scenes.
4. Spoken Dialogue Tone: Warm, friendly, authentic, empathetic, deeply emotional, conversational, and completely natural. Speak slowly with genuine warmth, producing real feelings of trust, comfort, pride, and peace of mind in the viewer. ABSOLUTELY NO Alex Hormozi frameworks, direct-response hype, aggressive value-stacking, or fast-talking hooks. The dialogue must flow like a warm, natural conversation from a real person who genuinely cares. Avoid robotic-sounding short fragments. Write complete, smooth, conversational sentences that produce feelings of warmth, family comfort, safety, and deep emotional resonance.
5. STRICT NO-CTA IN SCENE 1 RULE: Under no circumstances should Scene 1 contain any call to action, phone number, contact prompt, social handle reference, or request to purchase/visit. Scene 1 must focus exclusively on the scroll-stopping hook and problem bridge. The Call to Action (CTA) to contact, buy, or get in touch must ONLY appear at the very end of Scene 2 (25s-30s).
6. DYNAMIC AUDIENCE & NICHING ALIGNMENT: Analyze the product context and target buyer carefully. Tailor the hook and pain points exactly to the product's value tier. Do NOT use mismatched defaults (e.g. do NOT talk about 'renting vs buying' or 'saving rent money' if the product is a luxury 1.6 Cr home, commercial estate, or high-end service; instead, focus on exclusive lifestyle, status, growth, smart wealth investment, and ROI). Keep it fully generic so that the copywriting angle naturally scales from premium commercial/residential buyers to budget-conscious daily e-commerce shoppers based on the product description provided.
7. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue. If the product info or call-to-action implies a phone number, the creator must ONLY say "get in touch" (or natural Hinglish equivalents like "humein contact karein" or "get in touch ho jao") instead. Under no circumstances should the spoken dialogue contain any digits, numbers, or spoken phone numbers.
8. STRICT ENVIRONMENT CONSTRAINT (Prevents Hallucinations): Constrain all environment and visual action sequences strictly to the physical details actually visible in the reference images. Do NOT invent, assume, or hallucinate rooms, structures, product features, or details that are not shown in the reference photos.
9. Visual scene descriptions: Refer to the reference images by their actual visual descriptions naturally so the video generator knows exactly which image is used in each scene. Do NOT use abstract placeholders like "@Image 1", "@Image 2", "Image 1", or "Image 2" in the script or visual description.
10. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen in any script or visuals section, as the video AI generates garbled text and distorted logos.
11. Speech length: Keep the dialogue for EACH scene under 45 words so it can be comfortably spoken in 15 seconds.
12. ${variationInstruction}

Output format must be a single, valid JSON object:
{
  "title": "Short catchy title",
  "dialogue": "Plain text of the dialogue combined for both Scene 1 and Scene 2 (for backward compatibility)",
  "visuals": "Highly detailed visual instructions combined for both Scene 1 and Scene 2 (for backward compatibility)",
  "scenes": [
    {
      "dialogue": "Plain text of the Hinglish/English speech for Scene 1 (comfortably spoken in 15 seconds, under 45 words)",
      "visuals": "Highly detailed visual instructions describing Scene 1 (15s), referencing reference images naturally and strictly limiting details to what is visible in the photos."
    },
    {
      "dialogue": "Plain text of the Hinglish/English speech for Scene 2 (comfortably spoken in 15 seconds, under 45 words)",
      "visuals": "Highly detailed visual instructions describing Scene 2 (15s), referencing reference images naturally and strictly limiting details to what is visible in the photos."
    }
  ],
  "finalCaption": "Compelling, high-converting FB ad caption copy (include emojis, call to action, but NO hashtags, NO bold markdown)."
}

Output ONLY valid JSON. Do not include markdown code block tags around JSON.`;

        console.log("\n===============================================================================");
        console.log("=== GEMINI VIDEO SCRIPT GENERATION PROMPT ===");
        console.log(masterPrompt);
        console.log("===============================================================================\n");

        const { text: scriptJson } = await generateText({
            model: google('gemini-3-flash-preview'),
            prompt: masterPrompt,
        });

        try {
            const cleanJson = scriptJson.replace(/```json|```/g, '').trim();
            const script = JSON.parse(cleanJson);
            
            // Backward compatibility checks
            if (!script.scenes || !Array.isArray(script.scenes) || script.scenes.length === 0) {
                script.scenes = [
                    { dialogue: script.dialogue || "", visuals: script.visuals || "" },
                    { dialogue: "get in touch today", visuals: "Creator waving and smiling at camera." }
                ];
            } else if (script.scenes.length === 1) {
                script.scenes.push({ dialogue: "get in touch today", visuals: "Creator waving and smiling at camera." });
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
