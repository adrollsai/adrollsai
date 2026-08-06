import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

export const maxDuration = 300; // Allow 5 minutes for video analysis
export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const mimeType = file.type;

        console.log(`[Analyze] Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

        // Fetch business context
        const { data: profile } = await supabase.from('profiles').select('business_name, contact_number').eq('id', user.id).single();

        const prompt = `You are a world-class Direct Response Copywriter. 
Analyze the provided ${mimeType.startsWith('video') ? 'video' : 'image'} and write a high-converting Meta ad caption.

Business: "${profile?.business_name || 'Our Company'}"
Contact: "${profile?.contact_number || 'DM for details'}"

RULES: 
- Use Alex Hormozi frameworks (Hook, Retain, Reward). 
- Keep the length MODERATE (max 400 characters). 
- Use bullet points and emojis. 
- NO hashtags (#).
- NO bold markdown (**).
- Include the Business Name and Contact info.
- Output ONLY a JSON object: {"primary_text": "...", "headline": "..."}`;

        const { text } = await generateText({
            model: google('gemini-3.5-flash'),
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        mimeType.startsWith('image') ? {
                            type: 'image',
                            image: buffer,
                            mimeType: mimeType
                        } : { 
                            type: 'file', 
                            data: buffer, 
                            mimeType: mimeType 
                        } as any
                    ]
                }
            ]
        });

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const variation = JSON.parse(jsonMatch ? jsonMatch[0] : text);

        return NextResponse.json({ success: true, variation });

    } catch (error: any) {
        console.error("Analysis Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
