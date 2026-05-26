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
            .select('business_name, mission_statement, custom_prompt')
            .eq('id', targetUserId)
            .single();

        const profile = targetProfile;

        const productInfo = property ? `Product: ${property.title}. Description: ${property.description}` : 'Generic product promotion';
        const businessName = profile?.business_name || 'Your Business';
        const brandGuidelines = profile?.custom_prompt || '';

        // Extract reference images (max 4)
        let refImages: string[] = [];
        if (images && Array.isArray(images) && images.length > 0) {
            refImages = images.slice(0, 4);
        } else if (property) {
            if (property.images && Array.isArray(property.images) && property.images.length > 0) {
                refImages = property.images.slice(0, 4);
            } else if (property.image_url) {
                refImages = [property.image_url];
            }
        }

        // Determine if Hinglish should be used (default to true, unless user instructions explicitly request English/another language)
        const userText = (userInstructions || '').toLowerCase();
        let languageInstruction = "The script dialogue MUST be written in conversational hybrid language (e.g., Hindi-English / Hinglish). To ensure correct and authentic text-to-speech native pronunciation, write any Hindi words or phrases in the native Hindi language using actual DEVANAGARI script (e.g., 'क्या आप अभी भी rent दे रहे हैं? toh bas, your search ends here!'). Keep all English words in standard English script. This ensures the voiceover speech engine reads the Hindi words with correct native Hindi pronunciation while keeping English words pronounced naturally.";
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
Your goal is to write a highly hooky, high-converting 30-second ad script split into EXACTLY two sequential 15-second scenes.

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

CONSTRAINTS & RULES:
1. Duration: STRICTLY 30 seconds total, split into exactly TWO sequential 15-second clips (Scene 1: 0:00-0:15 and Scene 2: 0:15-0:30). High-energy, ultra-hooky, zero filler.
2. Dialogue language: ${languageInstruction}
3. Speaker Character: The speaker in both scenes MUST be a stunningly beautiful, highly attractive, charismatic, extremely charming, and appealing Indian female UGC content creator with a fair complexion (unless the custom user instructions explicitly request a different profile or ethnicity) speaking directly to the camera and showcasing/talking about the product/service with warm relatable energy. Her appearance must be identical and consistent across both scenes.
4. Spoken Dialogue Tone: Make the dialogue extremely engaging, interactive, highly energetic, and trendy, matching the tone of viral TikTok/Reels UGC ads.
5. NO PHONE NUMBERS: NEVER include any raw phone number or digit blocks in the spoken dialogue. If the product info or call-to-action implies a phone number, the creator must ONLY say "get in touch" (or natural Hinglish equivalents like "humein contact karein" or "get in touch ho jao") instead. Under no circumstances should the spoken dialogue contain any digits, numbers, or spoken phone numbers.
6. STRICT ENVIRONMENT CONSTRAINT (Prevents Hallucinations): Constrain all environment and visual action sequences strictly to the physical details actually visible in the reference images. Do NOT invent, assume, or hallucinate rooms, structures, product features, or details that are not shown in the reference photos. This must work generically for all businesses (e.g. if a real estate listing photo only shows a bedroom, only show the bedroom; if an e-commerce product photo only shows a bottle on a table, only show that bottle on a table).
7. Visual scene descriptions: Refer to the reference images by their actual visual descriptions naturally so the video generator knows exactly which image is used in each scene. Do NOT use abstract placeholders like "@Image 1", "@Image 2", "Image 1", or "Image 2" in the script or visual description.
8. NEVER instruct to display any text overlay, subtitles, captions, watermarks, or logos on screen in any script or visuals section, as the video AI generates garbled text and distorted logos.
9. Speech length: Keep the dialogue for EACH scene under 45 words so it can be comfortably spoken in 15 seconds.
10. ${variationInstruction}

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
