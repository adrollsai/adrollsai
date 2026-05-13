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
        const { propertyId, userInstructions } = body;

        // 1. Fetch Context
        const { data: property } = await supabase
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .single();

        const { data: profile } = await supabase
            .from('profiles')
            .select('business_name, mission_statement, custom_prompt')
            .eq('id', user.id)
            .single();

        const productInfo = property ? `Product: ${property.title}. Description: ${property.description}` : 'Generic business promotion';
        const businessName = profile?.business_name || 'Your Business';

        // 2. Generate Script using Gemini-3-Flash-Preview
        const masterPrompt = `You are the Lead Creative Director for AdRolls AI.
Objective: Script a 30-second hyper-realistic UGC-style "talking head" video for a business.

Input Data:
Business Name: ${businessName}
Mission/Goal: ${profile?.mission_statement || 'N/A'}
Global Visual Style (PRIORITY): ${profile?.custom_prompt || 'N/A'}
Product Info: ${productInfo}
User Custom Instructions: ${userInstructions || 'Create an engaging promotion.'}

Constraints & Rules:
1. Duration: 30 seconds total, split into 4 scenes (7.5s each).
2. Model: Veo 3.1 AI.
3. Lipsync Syntax: A [character description] says, "[dialogue]".
4. Character Consistency: 
   - Scene 1 MUST describe the persona in detail (e.g., "A friendly 30yo woman with messy hair, natural lighting, indoor kitchen").
   - Scenes 2-4 MUST focus on actions, expressions, and tone ONLY (e.g., "She smiles warmly, holding the product..."). Do NOT repeat persona.
5. Speech Rate: Max 22 words per scene to ensure it fits in 8 seconds.
6. Tone: Natural, unpolished, relatable UGC (smartphone camera look).

Output JSON Format:
{
  "title": "Short catchy title",
  "scenes": [
    {
      "prompt": "Full AI prompt including character says syntax",
      "dialogue": "Plain text of the dialogue for preview"
    },
    { "prompt": "...", "dialogue": "..." },
    { "prompt": "...", "dialogue": "..." },
    { "prompt": "...", "dialogue": "..." }
  ],
  "finalCaption": "Suggested social media caption"
}

Output ONLY the JSON.`;

        const { text: scriptJson } = await generateText({
            model: google('gemini-3-flash-preview'),
            prompt: masterPrompt,
        });

        try {
            const script = JSON.parse(scriptJson.replace(/```json|```/g, '').trim());
            return NextResponse.json(script);
        } catch (e) {
            console.error("Failed to parse script JSON:", scriptJson);
            return NextResponse.json({ error: "Failed to generate video script." }, { status: 500 });
        }

    } catch (error: any) {
        console.error("Video Script Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
