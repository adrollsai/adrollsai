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

        const { url, type, assetId, propertyId, customInstructions } = await req.json();
        if (!url) return NextResponse.json({ error: 'No asset URL provided' }, { status: 400 });

        console.log(`[Generate Caption] Fetching and analyzing asset: ${url} (${type})`);

        // Multi-candidate URL fetching & S3 GetObject fallback for bulletproof media loading
        const urlCandidates: string[] = [url];
        if (url.includes('/adrolls-storage/')) {
            urlCandidates.push(url.replace('/adrolls-storage/', '/'));
        } else if (url.includes('.r2.dev/')) {
            urlCandidates.push(url.replace('.r2.dev/', '.r2.dev/adrolls-storage/'));
        }

        let buffer: Buffer | null = null;
        let mimeType = type === 'video' ? 'video/mp4' : 'image/png';

        for (const candUrl of urlCandidates) {
            try {
                console.log(`[Generate Caption] Trying URL candidate: ${candUrl}`);
                const res = await fetch(candUrl);
                if (res.ok) {
                    buffer = Buffer.from(await res.arrayBuffer());
                    mimeType = res.headers.get('content-type') || mimeType;
                    console.log(`[Generate Caption] Media fetched successfully from candidate URL!`);
                    break;
                }
            } catch (e) {
                console.warn(`[Generate Caption] Failed fetching URL candidate ${candUrl}:`, e);
            }
        }

        // S3 SDK Direct GetObject Fallback if public HTTP returns 404
        if (!buffer) {
            try {
                const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');
                const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                
                const cleanKey = url.includes('/adrolls-storage/')
                    ? url.split('/adrolls-storage/')[1]
                    : url.replace(`${R2_PUBLIC_URL}/`, '').replace(/^\//, '');

                console.log(`[Generate Caption] Attempting direct S3 GetObject for key: ${cleanKey}`);
                const s3Res = await r2.send(new GetObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: cleanKey
                }));

                if (s3Res.Body) {
                    const byteArray = await s3Res.Body.transformToByteArray();
                    buffer = Buffer.from(byteArray);
                    mimeType = s3Res.ContentType || mimeType;
                    console.log(`[Generate Caption] S3 GetObject fallback succeeded!`);
                }
            } catch (s3Err) {
                console.error(`[Generate Caption] S3 GetObject fallback failed:`, s3Err);
            }
        }

        if (!buffer) {
            throw new Error(`Failed to fetch media file from R2. Status: 404`);
        }

        // Fetch business context
        const { data: profile } = await supabase.from('profiles').select('business_name, contact_number').eq('id', user.id).single();

        // Fetch product context if propertyId is provided
        let propertyContext = "";
        if (propertyId) {
            const { data: prop } = await supabase.from('properties').select('title, description, price, location').eq('id', propertyId).single();
            if (prop) {
                propertyContext = `
Target Product/Property Details:
- Title: ${prop.title || ''}
- Description: ${prop.description || ''}
- Price: ${prop.price || ''}
- Location: ${prop.location || ''}
`;
            }
        }

        const prompt = `You are a world-class Direct Response Copywriter and Social Media Expert.
Analyze the provided ${type === 'video' ? 'video' : 'image'} and write high-converting copy for it.

Business: "${profile?.business_name || 'Our Company'}"
Contact: "${profile?.contact_number || 'DM for details'}"

${propertyContext}

${customInstructions ? `Custom Copywriting Instructions (MUST FOLLOW STRICTLY):\n"${customInstructions}"\n` : ''}

You must generate exactly three pieces of copy:
1. "headline": A short, catchy, attention-grabbing headline (maximum 40 characters) suitable for ads. Do NOT use markdown or hashtags here.
2. "primary_text": A compelling ad primary text (maximum 150 characters) focusing on a single high-converting hook. Do NOT use bold markdown or hashtags here.
3. "social_post_description": An engaging, rich social media post description (maximum 400 characters) designed for all organic platforms (Facebook, Instagram, LinkedIn). Use bullet points, emojis, and relevant hashtags here to make it complete and ready to publish.

Output ONLY a JSON object:
{"headline": "...", "primary_text": "...", "social_post_description": "..."}`;

        const { text } = await generateText({
            model: google('gemini-3-flash-preview'),
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        type === 'image' ? {
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
        const captions = JSON.parse(jsonMatch ? jsonMatch[0] : text);

        // Update database record for the asset if assetId or url is matched
        const targetAssetId = assetId;
        let finalAssetId = targetAssetId;

        if (!finalAssetId) {
            // Fallback: lookup by URL
            const { data: matchedAsset } = await supabase.from('assets').select('id').eq('url', url).limit(1).maybeSingle();
            if (matchedAsset) finalAssetId = matchedAsset.id;
        }

        if (finalAssetId) {
            const { data: asset } = await supabase.from('assets').select('metadata').eq('id', finalAssetId).single();
            const existingMetadata = asset?.metadata || {};
            const updatedMetadata = {
                ...existingMetadata,
                headline: captions.headline,
                primary_text: captions.primary_text
            };

            await supabase
                .from('assets')
                .update({
                    caption: captions.social_post_description,
                    metadata: updatedMetadata
                })
                .eq('id', finalAssetId);
        }

        return NextResponse.json({ success: true, captions });

    } catch (error: any) {
        console.error("[Generate Caption] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
