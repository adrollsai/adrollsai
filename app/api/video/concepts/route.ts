import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

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

        // Determine reference images (max 4) - Filter out invalid placeholders/empty strings
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
            .slice(0, 8);

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
        // Build language-specific prompt sections
        const isEnglish = language === 'english';

        const hookLanguageRule = isEnglish 
            ? `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN ENGLISH: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience of the business in clear, compelling English. For example, if selling premium flats in Mohali to home buyers, the hook dialogue must start exactly like: "Looking for your dream home in Mohali?" or "Searching for the perfect home near Chandigarh?". ABSOLUTELY DO NOT start with generic greetings like "Hey everyone!", "Stop scrolling!", or filler phrases. It must be a direct, deep hook calling out the target audience from the very first word.`
            : `1.5. CRITICAL FIRST-LINE TARGET AUDIENCE CALLOUT IN HINGLISH: The very first sentence of the concept's hook dialogue (first 2 seconds of the video) MUST call out the target audience of the business. For example, if selling premium flats in Mohali to home buyers, the hook dialogue must start exactly like: "मोहाली में अपना dream home ढूंढ रहे हो?" or "न्यू चंडीगढ़ में home search कर रहे हो?". It must mix Devanagari script for Hindi words and proper nouns, and standard English letters for English dictionary words. ABSOLUTELY DO NOT start with English words/greetings like "Hey everyone!", "Stop scrolling!", "Are you looking for...?", or "Did you know...?". It must be a direct, deep hook calling out the target audience from the very first word.`;

        const languageScriptRule = isEnglish
            ? `8. Language & Script: ALL dialogue, hooks, descriptions, and concept text MUST be written entirely in English. Do NOT use any Hindi, Hinglish, or Devanagari script anywhere in the output. Write everything in standard English letters.`
            : `8. Language & Script: The hook dialogue MUST be written in Hinglish, mixing native Hindi Devanagari script (Hindi characters) and standard English/Roman letters. To guarantee flawless pronunciation by the voice model, you MUST write proper nouns, location names (e.g. write "न्यू चंडीगढ़" instead of "New Chandigarh", "मोहाली" instead of "Mohali"), units (e.g. write "कनाल" instead of "Kanal", "बी-एच-के" instead of "BHK"), and Hindi words in native Devanagari script. Only keep standard, simple English dictionary words (like "dream home", "perfect space", "luxury flat") in standard Roman characters. Do NOT transliterate these simple English words to Devanagari. For example: "न्यू चंडीगढ़ में अपना dream home ढूंढ रहे हो?"`;

        const hookExample = isEnglish
            ? `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'Looking for your dream home in Mohali but worried about construction quality?')"`
            : `"hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'मोहाली में अपना dream home ढूंढ रहे हो?')"`;

        const conceptPrompt = `You are a world-class Ad Creative Director specializing in hyper-engaging, high-converting Meta and TikTok video ads.
Your task is to analyze the provided business details, product details, user guidelines, and any referenced image descriptions, then create 5 unique, ultra-hooky, ${durationText}.

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

Reference Images available:
${refImages.map((img, i) => `- Image Image_${i + 1}: ${img}`).join('\n')}

INSTRUCTIONS:
0. CRITICAL CUSTOM INSTRUCTIONS PRIORITIZATION RULE: You MUST strictly prioritize and adhere to the user's Custom Instructions: "${userInstructions || 'None'}". Every single concept angle, visual storyline, hook, and psychological positioning MUST be custom-tailored to follow these instructions first and foremost. Do not ignore them or generate generic real estate/e-commerce templates that do not reflect what the user has requested here.
0.1. CRITICAL CONCRETE PRODUCT DETAILS RULE (DO NOT BE VAGUE):
   - You MUST explicitly base the hooks and concepts on the actual, concrete specifications, price, location, and amenities of the product/property provided in the Product/Service Info.
   - Do NOT use vague marketing terms, generic placeholders (like "[price]", "[location]"), or broad fluff.
   - The concept title, hook, and description MUST include real, informative details (e.g., specific price, exact location, actual key amenities/features) so that the resulting video script can provide actual, concrete information to the viewer. Focus on details that drive engagement and conversion. Do NOT mention RERA IDs or registration numbers.
1. Since the videos will run as Facebook/Instagram/TikTok UGC Ads, they must be warm, authentic, natural, and deeply emotional. ABSOLUTELY NO Alex Hormozi frameworks, direct-response hype, aggressive value-stacking, or pushy marketing hooks. Every concept must be centered around warm, authentic, emotional storytelling that generates real feelings of comfort, trust, pride, or security. You must dig deep into the psychological pain points of the target audience (e.g., escaping rent anxiety, security for parents/children, fear of delayed projects, wanting luxury/status, high return on investment) and position the business/product directly as the perfect solution to their deep-seated desire or pain. Avoid surface-level feature listicles; write concepts with emotional depth.
${hookLanguageRule}
2. The ad concepts should be designed for a strict ${duration}-second video clip in 9:16 dimension ${numClips > 1 ? `consisting of exactly ${numClips} sequential 15-second scenes/clips` : '(a single 15-second scene)'}.
3. The creator character described above will speak directly to the camera and showcase/talk about the product/service. Wherever the creator character is shown, it MUST be a medium closeup shot (e.g., 'medium closeup of the presenter speaking from chest up') to preserve their face and prevent face mutation. Do NOT zoom in too tight or show only the face. Keep a chest-up distance to allow natural body language and hand gestures. Medium or wide shots of the character showing the presenter from far away are strictly prohibited. If you want to show something large (like a building facade, a room interior, or a landscape), it MUST be a B-roll scene transition WITHOUT the presenter, and the shot MUST be specified as a super far away wide scenic shot so that the mutated face is not noticed or visible. Their voice must sound warm, natural, smooth, pleasing to listen to, and emotionally engaging. Their body language must be highly natural and dynamic — real hand gestures, subtle head tilts, natural eye contact, relaxed movements. They should feel like a real person, not stiff or robotic.
4. Make the scenes highly dynamic: constantly moving, featuring dynamic shot changes, handheld camera motion, fluid panning, and different angles (close-ups, medium shots) narrating dialogues along the way in a highly expressive way. Avoid static single shots.
5. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue or visual captions. If the product info or call-to-action implies a phone number, use the exact phrase "get in touch" (or ${isEnglish ? 'equivalent like "contact us today"' : 'Hinglish equivalent like "humein contact karein"'}) instead. Under no circumstances should the dialogue contain digits or spoken phone numbers.
6. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen in any visual instruction, as the video AI generates garbled text and distorted logos. Keep the visual space completely clean of text.
7. In the visual concepts, instead of referencing abstract placeholders like "@Image 1", write natural visual descriptions of what is shown in the image (e.g., "showcasing the cozy modern bedroom shown in the bedroom photo").
${languageScriptRule}
9. Output EXACTLY a JSON object with keys: "concepts", "analyzedImageSummary", and "imageDescriptions". "imageDescriptions" must be an array of strings, where each string is a detailed visual description of the corresponding reference image in order (Image 1, Image 2, etc.).

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
  "analyzedImageSummary": "Short explanation of the visual assets (what is shown in the images, color palette, product features).",
  "imageDescriptions": [
    "Detailed description of image 1 (e.g. A bright modern kitchen with white marble countertops)",
    "Detailed description of image 2 (e.g. A spacious cozy living room with a green sofa)"
  ]
}

- Output ONLY a valid JSON structure matching the schema above. Do not wrap the JSON in markdown code blocks.`;

        // If there are images, we can download and pass them to Gemini to analyze directly!
        const messages: any[] = [];
        if (refImages.length > 0) {
            const contentParts: any[] = [{ type: 'text', text: conceptPrompt }];
            for (let i = 0; i < refImages.length; i++) {
                try {
                    const imgUrl = refImages[i];
                    const imgRes = await fetch(imgUrl);
                    const imgBuffer = await imgRes.arrayBuffer();
                    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
                    contentParts.push({
                        type: 'image',
                        image: new Uint8Array(imgBuffer)
                    });
                } catch (e: any) {
                    console.error(`Failed to download image ${refImages[i]} for Gemini analysis:`, e.message);
                }
            }
            messages.push({ role: 'user', content: contentParts });
        } else {
            messages.push({ role: 'user', content: conceptPrompt });
        }

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
            imageDescriptions: z.array(z.string()),
        });

        console.log("[Concepts API] Generating concepts with primary model: gemini-3.5-flash");
        const res = await generateObject({
            model: google('gemini-3.5-flash'),
            schema,
            messages,
        });
        result = res.object;

        return NextResponse.json({
            success: true,
            concepts: result.concepts || [],
            analyzedImageSummary: result.analyzedImageSummary || "Product assets",
            imageDescriptions: result.imageDescriptions || [],
            refImages
        });

    } catch (error: any) {
        console.error("Video Concepts Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
