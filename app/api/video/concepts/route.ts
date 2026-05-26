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
        const { propertyId, userInstructions, images: customImages } = body;

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
            .select('business_name, mission_statement, custom_prompt')
            .eq('id', targetUserId)
            .single();

        const profile = targetProfile;

        // Determine reference images (max 4)
        let refImages: string[] = [];
        if (customImages && Array.isArray(customImages) && customImages.length > 0) {
            refImages = customImages.slice(0, 4);
        } else if (property) {
            if (property.images && Array.isArray(property.images) && property.images.length > 0) {
                refImages = property.images.slice(0, 4);
            } else if (property.image_url) {
                refImages = [property.image_url];
            }
        }

        const productInfo = property ? `Product: ${property.title}. Description: ${property.description}` : 'Generic product promotion';
        const businessName = profile?.business_name || 'Your Business';
        const brandGuidelines = profile?.custom_prompt || 'UGC style, engaging';

        // Build prompt for analysis and concept generation
        const conceptPrompt = `You are a world-class Ad Creative Director specializing in hyper-engaging, high-converting Meta and TikTok video ads.
Your task is to analyze the provided business details, product details, user guidelines, and any referenced image descriptions, then create 5 unique, ultra-hooky, 15-second ad concepts.

Business Info:
- Name: ${businessName}
- Mission: ${profile?.mission_statement || 'N/A'}
- Guidelines: ${brandGuidelines}

Product/Service Info:
- Context: ${productInfo}
- Custom Instructions: ${userInstructions || 'None'}

Reference Images available:
${refImages.map((img, i) => `- Image Image_${i + 1}: ${img}`).join('\n')}

INSTRUCTIONS:
1. Since the videos will run as Facebook/Instagram/TikTok UGC Ads, they must be ultra-hooky (first 3 seconds are critical), engaging, natural, and feel organic.
2. The ad concepts should be designed for a strict 15-second video clip in 9:16 dimension.
3. Incorporate a super attractive, highly charismatic, charming, and appealing Indian model UGC-style creator speaking directly to the camera and showcasing/talking about the product/service in the concept with warm, friendly expressions, unless the user explicitly requested a different profile/ethnicity.
4. Make the scenes highly dynamic: constantly moving, featuring dynamic shot changes, handheld camera motion, fluid panning, and different angles (close-ups, medium shots) narrating dialogues along the way in a highly expressive way. Avoid static single shots.
5. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue or visual captions. If the product info or call-to-action implies a phone number, use the exact phrase "get in touch" (or Hinglish equivalent like "humein contact karein") instead. Under no circumstances should the dialogue contain digits or spoken phone numbers.
6. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen in any visual instruction, as the video AI generates garbled text and distorted logos. Keep the visual space completely clean of text.
7. In the visual concepts, instead of referencing abstract placeholders like "@Image 1", write natural visual descriptions of what is shown in the image (e.g., "showcasing the cozy modern bedroom shown in the bedroom photo").
8. Language: Write any Hindi words/phrases inside the hook dialogue using native Devanagari script (e.g., 'क्या आप अभी भी rent de rahe hain?') to represent perfect native Hindi pronunciation while keeping English words pronounced naturally.
9. Output EXACTLY a JSON object with keys: "concepts", "analyzedImageSummary", and "imageDescriptions". "imageDescriptions" must be an array of strings, where each string is a detailed visual description of the corresponding reference image in order (Image 1, Image 2, etc.).

JSON SCHEMA:
{
  "concepts": [
    {
      "id": "concept_1",
      "title": "Short Catchy Concept Title (e.g., The Pain-Point Callout)",
      "hook": "The 3-second hook (e.g., Visual: character gasps. Audio/Dialogue: 'If you are still doing X, stop.')",
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

        const { object: result } = await generateObject({
            model: google('gemini-3-flash-preview'),
            schema: z.object({
                concepts: z.array(z.object({
                    id: z.string(),
                    title: z.string(),
                    hook: z.string(),
                    description: z.string(),
                    visualConcept: z.string(),
                })),
                analyzedImageSummary: z.string(),
                imageDescriptions: z.array(z.string()),
            }),
            messages,
        });

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
