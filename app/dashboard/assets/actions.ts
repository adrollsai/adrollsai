'use server';

import { createClient } from '@/utils/supabase/server';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { r2, R2_BUCKET } from '@/utils/r2';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { generateContentWithFallback } from '@/utils/gemini-fallback';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function analyzeMediaAction(url?: string, file?: File) {
    let tempKey: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        
        let buffer: Buffer;
        let mimeType: string;
        let fileName: string;

        if (url) {
            console.log(`[Action] Fetching media from URL for Google AI: ${url}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch media from temporary storage.");
            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
            mimeType = response.headers.get('content-type') || 'video/mp4';
            fileName = url.split('/').pop() || 'media';
            
            if (url.includes('/adrolls-storage/')) {
                tempKey = url.split('/adrolls-storage/')[1];
            }
        } else if (file) {
            buffer = Buffer.from(await file.arrayBuffer());
            mimeType = file.type;
            fileName = file.name;
        } else {
            throw new Error('No media provided');
        }

        console.log(`[Action] Analyzing ${fileName} with Gemini 3 Flash...`);

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

        // Convert buffer to Google AI format
        const part = {
            inlineData: {
                data: buffer.toString("base64"),
                mimeType
            }
        };

        const result = await generateContentWithFallback(
            genAI,
            [prompt, part],
            "gemini-3-flash-preview",
            null
        );
        const text = result.response.text();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const variation = JSON.parse(jsonMatch ? jsonMatch[0] : text);

        // CLEANUP: Delete from R2 after analysis
        if (tempKey) {
            console.log(`[Action] Cleaning up temporary file: ${tempKey}`);
            await r2.send(new DeleteObjectCommand({
                Bucket: R2_BUCKET,
                Key: tempKey
            })).catch(() => {});
        }

        return { success: true, variation };

    } catch (error: any) {
        console.error("Action Error:", error);
        if (tempKey) {
            await r2.send(new DeleteObjectCommand({
                Bucket: R2_BUCKET,
                Key: tempKey
            })).catch(() => {});
        }
        return { success: false, error: error.message };
    }
}
