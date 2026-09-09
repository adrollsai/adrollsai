import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
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
        const { propertyId, userInstructions, images: customImages, useCharacterVideo = true, duration = 15, language = 'hinglish' } = body;

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
            console.warn("[Concepts API] Failed to select with avatar columns, retrying without them:", selectWithAvatars.error.message);
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
                error: 'Please upload a reference video in your Profile settings or Creation tab first before generating video concepts.' 
            }, { status: 400 });
        }

        if (presenterType === 'avatar' && (!targetProfile || !targetProfile.avatar_url)) {
            return NextResponse.json({ 
                error: 'Please upload an avatar photo in your Profile settings or Creation tab first before generating video concepts.' 
            }, { status: 400 });
        }

        const profile = targetProfile || {} as any;

        // Determine reference images (up to 7 images for Grok Imagine 1.5)
        let rawImages: string[] = [];
        if (customImages && Array.isArray(customImages) && customImages.length > 0) {
            rawImages = customImages;
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

        // Resolve Image Descriptions from DB cache or analyze once with Gemini Vision
        console.log(`[Concepts API] Resolving image descriptions for ${refImages.length} images...`);
        const imageDescriptions = await resolveImageDescriptions(supabaseAdmin, refImages, propertyId);

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
        const brandGuidelines = profile?.custom_prompt || 'UGC style, engaging';

        // Build prompt for analysis and concept generation
        let characterDescription = "a highly professional, friendly, and charismatic UGC presenter speaking clearly and warmly to the camera";
        if (presenterType === 'video') {
            characterDescription = profile?.character_description || "a stunningly beautiful, highly attractive, charismatic Indian female UGC content creator with a fair complexion, smiling warmly";
        } else if (presenterType === 'avatar') {
            characterDescription = profile?.avatar_description || "a stunningly beautiful, highly attractive, charismatic Indian female UGC content creator with a fair complexion, smiling warmly";
        }

        const numClips = Math.ceil(duration / 15);
        const durationText = `${duration}-second ad concepts ${numClips > 1 ? `(intended to be split into exactly ${numClips} sequential 15-second scenes/clips)` : '(a single 15-second scene)'}`;
        function getConceptLanguageRules(langCode: string) {
            const code = (langCode || 'hinglish').toLowerCase().trim();

            if (code === 'english') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN ENGLISH: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience of the business in clear, compelling English. For example, if selling premium flats in Mohali to home buyers, the hook dialogue must start exactly like: "Looking for your dream home in Mohali?" or "Searching for the perfect home near Chandigarh?". ABSOLUTELY DO NOT start with generic greetings like "Hey everyone!", "Stop scrolling!", or filler phrases. It must be a direct, deep hook calling out the target audience from the very first word.`,
                    languageScriptRule: `8. Language & Script: ALL dialogue, hooks, descriptions, and concept text MUST be written entirely in English. Do NOT use any Hindi, Hinglish, or Devanagari script anywhere in the output. Write everything in standard English letters.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'Looking for your dream home in Mohali but worried about construction quality?')"`
                };
            }

            if (code === 'hindi') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN HINDI: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in natural, compelling Hindi using native Devanagari script (e.g. "मोहाली में अपना सपनों का घर ढूंढ रहे हैं?"). ABSOLUTELY DO NOT start with generic greetings. Call out the audience directly from the very first word.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written entirely in natural Hindi using native Devanagari script. Explanations and visuals can be in English.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'मोहाली में अपना सपनों का घर ढूंढ रहे हैं?')"`
                };
            }

            if (code === 'punjabi') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN PUNJABI: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in lively, compelling Punjabi using native Gurmukhi script (e.g. "ਮੋਹਾਲੀ ਵਿੱਚ ਆਪਣਾ ਸੁਪਨਿਆਂ ਦਾ ਘਰ ਲੱਭ ਰਹੇ ਹੋ?"). Call out the audience directly from the very first word.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Punjabi using native Gurmukhi script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'ਮੋਹਾਲੀ ਵਿੱਚ ਆਪਣਾ ਸੁਪਨਿਆਂ ਦਾ ਘਰ ਲੱਭ ਰਹੇ ਹੋ?')"`
                };
            }

            if (code === 'marathi') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN MARATHI: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Marathi using native Devanagari script (e.g. "पुण्यात स्वतःचे स्वप्नातील घर शोधत आहात का?").`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Marathi using native Devanagari script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'पुण्यात स्वतःचे स्वप्नातील घर शोधत आहात का?')"`
                };
            }

            if (code === 'gujarati') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN GUJARATI: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Gujarati using native Gujarati script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Gujarati using native Gujarati script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'અમદાવાદમાં તમારા સપનાનું ઘર શોધી રહ્યા છો?')"`
                };
            }

            if (code === 'bengali') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN BENGALI: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Bengali using native Bengali script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Bengali using native Bengali script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'কলকাতায় নিজের স্বপ্নের বাড়ি খুঁজছেন?')"`
                };
            }

            if (code === 'tamil') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN TAMIL: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Tamil using native Tamil script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Tamil using native Tamil script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'சென்னையில் உங்கள் கனவு இல்லத்தை தேடுகிறீர்களா?')"`
                };
            }

            if (code === 'telugu') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN TELUGU: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Telugu using native Telugu script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Telugu using native Telugu script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'హైదరాబాద్‌లో మీ కలల ఇంటిని వెతుకుతున్నారా?')"`
                };
            }

            if (code === 'kannada') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN KANNADA: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Kannada using native Kannada script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Kannada using native Kannada script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'ಬೆಂಗಳೂರಿನಲ್ಲಿ ನಿಮ್ಮ ಕನಸಿನ ಮನೆಯನ್ನು ಹುಡುಕುತ್ತಿದ್ದೀರಾ?')"`
                };
            }

            if (code === 'malayalam') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN MALAYALAM: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Malayalam using native Malayalam script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Malayalam using native Malayalam script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'കൊച്ചിയിൽ നിങ്ങളുടെ സ്വപ്ന ഭവനം അന്വേഷിക്കുകയാണോ?')"`
                };
            }

            if (code === 'urdu') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN URDU: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Urdu using standard Urdu script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Urdu using standard Urdu script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'کیا آپ اپنے خوابوں کے گھر کی تلاش میں ہیں؟')"`
                };
            }

            if (code === 'arabic') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN ARABIC: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in Arabic using standard Arabic script.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Arabic using standard Arabic script.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'هل تبحث عن منزل أحلامك في دبي؟')"`
                };
            }

            if (code === 'spanish') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN SPANISH: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in conversational Spanish.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in conversational Spanish.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: '¿Estás buscando la casa de tus sueños en una ubicación privilegiada?')"`
                };
            }

            if (code === 'french') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN FRENCH: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in conversational French.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in conversational French.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'Vous cherchez la maison de vos rêves dans un quartier exclusif ?')"`
                };
            }

            if (code === 'german') {
                return {
                    hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN GERMAN: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience in conversational German.`,
                    languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in conversational German.`,
                    hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'Suchen Sie nach Ihrem Traumhaus in bester Lage?')"`
                };
            }

            // Default: Hinglish
            return {
                hookLanguageRule: `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN HINGLISH: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience of the business. For example, if selling premium flats in Mohali to home buyers, the hook dialogue must start exactly like: "मोहाली में अपना dream home ढूंढ रहे हो?" or "न्यू चंडीगढ़ में home search कर रहे हो?". It must mix Devanagari script for Hindi words and proper nouns, and standard English letters for English dictionary words. ABSOLUTELY DO NOT start with English words/greetings like "Hey everyone!", "Stop scrolling!", "Are you looking for...?", or "Did you know...?". It must be a direct, deep hook calling out the target audience from the very first word.`,
                languageScriptRule: `8. Language & Script: The hook dialogue MUST be written in Hinglish, mixing native Hindi Devanagari script (Hindi characters) and standard English/Roman letters. To guarantee flawless pronunciation by the voice model, you MUST write proper nouns, location names (e.g. write "न्यू चंडीगढ़" instead of "New Chandigarh", "मोहाली" instead of "Mohali"), units (e.g. write "कनाल" instead of "Kanal", "बी-एच-के" instead of "BHK"), and Hindi words in native Devanagari script. Only keep standard, simple English dictionary words (like "dream home", "perfect space", "luxury flat") in standard Roman characters. Do NOT transliterate these simple English words to Devanagari. For example: "न्यू चंडीगढ़ में अपना dream home ढूंढ रहे हो?"`,
                hookExample: `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'मोहाली में अपना dream home ढूंढ रहे हो?')"`
            };
        }

        const { hookLanguageRule, languageScriptRule, hookExample } = getConceptLanguageRules(language);

        const descriptionsText = imageDescriptions.map((desc, i) => `- Image ${i + 1} Visual Description: "${desc}"`).join('\n');

        const conceptPrompt = `You are a world-class Ad Creative Director specializing in hyper-engaging, high-converting Meta and TikTok video ads.
Your task is to analyze the provided business details, product details, user guidelines, and the reference image visual descriptions, then create 5 unique, ultra-hooky, ${durationText}.

Business Info:
- Name: ${businessName}
- Showcase Details: ${profile?.mission_statement || 'N/A'}
- AI Context / Background: ${profile?.business_info || 'N/A'}
- Guidelines: ${brandGuidelines}

Product/Service Info:
- Context: ${productInfo}
- Custom Instructions: ${userInstructions || 'None'}

Creator Character (the person who will appear in the video):
"${characterDescription}"
All concept visuals and descriptions must be written for THIS specific creator character. Use their correct gender naturally in all visual descriptions and hooks.

Analyzed Reference Images available (with exact physical visual descriptions):
${descriptionsText || 'No reference image descriptions available.'}

INSTRUCTIONS:
0. CRITICAL CUSTOM INSTRUCTIONS PRIORITIZATION RULE: You MUST strictly prioritize and adhere to the user's Custom Instructions: "${userInstructions || 'None'}". Every single concept angle, visual storyline, hook, and psychological positioning MUST be custom-tailored to follow these instructions first and foremost. Do not ignore them or generate generic real estate/e-commerce templates that do not reflect what the user has requested here.
0.1. CRITICAL CONCRETE PRODUCT DETAILS RULE (DO NOT BE VAGUE):
   - You MUST explicitly base the hooks and concepts on the actual, concrete specifications, price, location, and amenities of the product/property provided in the Product/Service Info.
   - Do NOT use vague marketing terms, generic placeholders (like "[price]", "[location]"), or broad fluff.
   - The concept title, hook, and description MUST include real, informative details (e.g., specific price, exact location, actual key amenities/features) so that the resulting video script can provide actual, concrete information to the viewer. Focus on details that drive engagement and conversion. Do NOT mention RERA IDs or registration numbers.
1. OUT-OF-THE-BOX, HIGH-DEPTH CONCEPTS (NO FILLERS OR SURFACE-LEVEL CLICHÉS):
   - Think creatively and out-of-the-box! Every concept must have an irresistible, scroll-stopping curiosity angle (e.g., The "Cost of Renting vs Owning" calculation, The "Sanctuary from Noise" contrast, The "Layout Intelligence" breakdown, The "Early-Mover Investment Gap", or The "Hidden Luxury Spec").
   - Deep Psychological Depth: Dig beneath generic marketing words. Address genuine human anxieties (wasting hard-earned salary on rent, compromised family privacy, safety for kids/elders, fear of delayed construction, desiring peaceful luxury).
   - Weave in concrete specifications, real features, exact locations, and distinctive amenities so the concepts feel informative, compelling, and real.
   - ABSOLUTELY NO Alex Hormozi frameworks, direct-response hype, or superficial filler phrases. Every concept must feel authentic, intelligent, and emotionally resonant.
${hookLanguageRule}
2. The ad concepts should be designed for a strict ${duration}-second video clip in 9:16 dimension ${numClips > 1 ? `consisting of exactly ${numClips} sequential 15-second scenes/clips` : '(a single 15-second scene)'}.
3. The creator character described above will speak directly to the camera and showcase/talk about the product/service. Wherever the creator character is shown, it MUST be a medium closeup shot (e.g., 'medium closeup of the presenter speaking from chest up') to preserve their face and prevent face mutation. Do NOT zoom in too tight or show only the face. Keep a chest-up distance to allow natural body language and hand gestures. Medium or wide shots of the character showing the presenter from far away are strictly prohibited. If you want to show something large (like a building facade, a room interior, or a landscape), it MUST be a B-roll scene transition WITHOUT the presenter, and the shot MUST be specified as a super far away wide scenic shot so that the mutated face is not noticed or visible. Their voice must sound warm, natural, smooth, pleasing to listen to, and emotionally engaging. Their body language must be highly natural and dynamic — real hand gestures, subtle head tilts, natural eye contact, relaxed movements. They should feel like a real person, not stiff or robotic.
4. Make the scenes highly dynamic: constantly moving, featuring dynamic shot changes, handheld camera motion, fluid panning, and different angles (close-ups, medium shots) narrating dialogues along the way in a highly expressive way. Avoid static single shots.
5. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue or visual captions. If the product info or call-to-action implies a phone number, use the exact phrase "get in touch" (or language equivalent like "contact us today") instead. Under no circumstances should the dialogue contain digits or spoken phone numbers.
6. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen in any visual instruction, as the video AI generates garbled text and distorted logos. Keep the visual space completely clean of text.
7. In the visual concepts, instead of referencing abstract placeholders like "@Image 1", write natural visual descriptions of what is shown in the image (e.g., "showcasing the cozy modern bedroom shown in the bedroom photo").
${languageScriptRule}
9. Output EXACTLY a JSON object with keys: "concepts" and "analyzedImageSummary".

JSON SCHEMA:
{
  "concepts": [
    {
      "id": "concept_1",
      "title": "Short Catchy Concept Title (e.g., The Pain-Point Callout)",
      ${hookExample},
      "description": "Short explanation of the concept's psychological angle & why it converts.",
      "visualConcept": "Brief visual flow description referencing the images by their content naturally (e.g. 'creator points to the luxurious marble kitchen shown in the kitchen photo')"
    }
  ],
  "analyzedImageSummary": "Short explanation of the visual assets (what is shown in the images, color palette, product features)."
}

- Output ONLY a valid JSON structure matching the schema above. Do not wrap the JSON in markdown code blocks.`;

        console.log("\n===============================================================================");
        console.log("=== GEMINI VIDEO CONCEPTS GENERATION PROMPT ===");
        console.log(conceptPrompt);
        console.log("===============================================================================\n");

        let result;
        const schema = z.object({
            concepts: z.array(z.object({
                id: z.string(),
                title: z.string(),
                hook: z.string(),
                description: z.string(),
                visualConcept: z.string(),
            })),
            analyzedImageSummary: z.string(),
        });

        console.log("[Concepts API] Generating concepts with primary model: gemini-3.5-flash");
        const res = await generateObject({
            model: google('gemini-3.5-flash'),
            schema,
            prompt: conceptPrompt,
        });
        result = res.object;

        return NextResponse.json({
            success: true,
            concepts: result.concepts || [],
            analyzedImageSummary: result.analyzedImageSummary || "Product assets",
            imageDescriptions: imageDescriptions || [],
            refImages
        });

    } catch (error: any) {
        console.error("Video Concepts Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
