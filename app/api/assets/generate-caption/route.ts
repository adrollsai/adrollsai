import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { extractJsonFromText } from '@/utils/json-parser';

export const maxDuration = 300; // Allow 5 minutes for video analysis
export const runtime = 'nodejs';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const reqUrl = new URL(req.url);
        const queryImpersonate = reqUrl.searchParams.get('impersonate');

        const { url, type, assetId, propertyId, customInstructions, impersonateId: bodyImpersonate } = await req.json();
        if (!url) return NextResponse.json({ error: 'No asset URL provided' }, { status: 400 });

        const requestedImpersonateId = bodyImpersonate || queryImpersonate;

        // 1. Resolve asset details if assetId exists
        let assetOwnerId: string | null = null;
        let resolvedPropertyId = propertyId;

        if (assetId) {
            const { data: assetData } = await supabaseAdmin
                .from('assets')
                .select('id, user_id, property_id')
                .eq('id', assetId)
                .single();

            if (assetData) {
                assetOwnerId = assetData.user_id;
                if (!resolvedPropertyId && assetData.property_id) {
                    resolvedPropertyId = assetData.property_id;
                }
            }
        }

        // 2. Determine target user context (support impersonation & asset ownership)
        const { data: authProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, agency_id, parent_id')
            .eq('id', user.id)
            .single();

        let targetUserId = user.id;
        const candidateUserId = requestedImpersonateId || assetOwnerId;

        if (candidateUserId && candidateUserId !== user.id) {
            if (['super_admin', 'agency', 'admin', 'agent'].includes(authProfile?.role || '')) {
                if (authProfile?.role === 'super_admin') {
                    targetUserId = candidateUserId;
                } else {
                    const isParent = (authProfile?.agency_id === candidateUserId || authProfile?.parent_id === candidateUserId);
                    const { data: subAccount } = await supabaseAdmin
                        .from('profiles')
                        .select('id')
                        .eq('id', candidateUserId)
                        .eq('agency_id', authProfile?.agency_id || user.id)
                        .single();

                    if (isParent || subAccount) {
                        targetUserId = candidateUserId;
                    }
                }
            }
        }

        console.log(`[Generate Caption] Processing for targetUserId: ${targetUserId} (caller: ${user.id}, assetId: ${assetId || 'none'})`);

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
                const res = await fetch(candUrl);
                if (res.ok) {
                    buffer = Buffer.from(await res.arrayBuffer());
                    mimeType = res.headers.get('content-type') || mimeType;
                    break;
                }
            } catch (e) {
                console.warn(`[Generate Caption] Failed fetching candidate ${candUrl}:`, e);
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

                const s3Res = await r2.send(new GetObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: cleanKey
                }));

                if (s3Res.Body) {
                    const byteArray = await s3Res.Body.transformToByteArray();
                    buffer = Buffer.from(byteArray);
                    mimeType = s3Res.ContentType || mimeType;
                }
            } catch (s3Err) {
                console.error(`[Generate Caption] S3 GetObject fallback failed:`, s3Err);
            }
        }

        if (!buffer) {
            throw new Error(`Failed to fetch media file from storage.`);
        }

        // Fetch comprehensive business context for targetUserId (bypassing RLS with supabaseAdmin)
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('business_name, contact_number, business_info, mission_statement, custom_prompt')
            .eq('id', targetUserId)
            .single();

        // Extract clean business overview from bio or description
        let businessOverview = profile?.business_info || profile?.mission_statement || '';
        if (typeof businessOverview === 'string' && businessOverview.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(businessOverview);
                if (parsed.bio) {
                    businessOverview = parsed.bio;
                } else if (parsed.description) {
                    businessOverview = parsed.description;
                }
            } catch (_) {}
        }
        if (!businessOverview) {
            businessOverview = profile?.mission_statement || profile?.business_name || 'Real Estate Advisory and Property Investment';
        }

        // Fetch product context if propertyId is provided
        let propertyContext = "";
        if (resolvedPropertyId) {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('title, description, price, location')
                .eq('id', resolvedPropertyId)
                .single();
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

        const businessName = profile?.business_name?.trim() || '';
        const contactNumber = profile?.contact_number?.trim() || '';
        const customPrompt = profile?.custom_prompt?.trim() || '';

        const prompt = `You are a world-class Direct Response Copywriter and Social Media Growth Expert.
Analyze the provided ${type === 'video' ? 'video' : 'image'} and write high-converting copy for it matching the client's exact business identity and market.

CLIENT IDENTITY (MANDATORY):
- Business / Brand Name: "${businessName || 'Our Real Estate Advisory'}"
- Contact Phone / WhatsApp: "${contactNumber || 'DM for details'}"
- Business Overview & Offerings: "${businessOverview}"
${customPrompt ? `- Brand Tone & Custom Guidance: "${customPrompt}"` : ''}

${propertyContext}

${customInstructions ? `Additional User Instructions (MUST FOLLOW STRICTLY):\n"${customInstructions}"\n` : ''}

STRICT BRANDING & COMPLIANCE RULES:
1. All copywriting MUST be written specifically for "${businessName || 'our agency'}".
2. When including a contact phone number or call-to-action to call/WhatsApp, you MUST use "${contactNumber}". NEVER invent other phone numbers, and NEVER use administrative or platform phone numbers.
3. Hashtags: Generate hashtags relevant to "${businessName}", the property or location shown (e.g. Nagpur), and real estate investment. NEVER include #Nobogent in the hashtags or caption.

You must generate exactly three pieces of copy:
1. "headline": A short, catchy, attention-grabbing headline (maximum 40 characters) suitable for ads. Do NOT use markdown or hashtags here.
2. "primary_text": A compelling ad primary text (maximum 150 characters) focusing on a single high-converting hook. Do NOT use bold markdown or hashtags here.
3. "social_post_description": An engaging, rich social media post description (maximum 400 characters) designed for all organic platforms (Facebook, Instagram, LinkedIn). Use bullet points, emojis, and relevant hashtags here to make it complete and ready to publish. Include the contact number "${contactNumber}" in the call-to-action.

Output ONLY a JSON object:
{"headline": "...", "primary_text": "...", "social_post_description": "..."}`;

        const mediaDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

        const { text } = await generateText({
            model: google('gemini-3.5-flash'),
            messages: [
                {
                    role: 'user',
                    content: prompt,
                    experimental_attachments: [
                        {
                            name: `media.${type === 'video' ? 'mp4' : 'png'}`,
                            contentType: mimeType,
                            url: mediaDataUrl
                        }
                    ]
                } as any
            ]
        });

        const captions = extractJsonFromText<{ headline: string; primary_text: string; social_post_description: string }>(text, {
            headline: '',
            primary_text: '',
            social_post_description: ''
        });

        // Update database record for the asset using supabaseAdmin to bypass RLS for impersonated assets
        let finalAssetId = assetId;
        if (!finalAssetId) {
            const { data: matchedAsset } = await supabaseAdmin
                .from('assets')
                .select('id')
                .eq('url', url)
                .limit(1)
                .maybeSingle();
            if (matchedAsset) finalAssetId = matchedAsset.id;
        }

        if (finalAssetId) {
            const { data: asset } = await supabaseAdmin.from('assets').select('metadata').eq('id', finalAssetId).single();
            const existingMetadata = asset?.metadata || {};
            const updatedMetadata = {
                ...existingMetadata,
                headline: captions.headline,
                primary_text: captions.primary_text
            };

            await supabaseAdmin
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
