import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY!);

/**
 * Hash an image URL for indexing / lookup
 */
export function hashImageUrl(url: string): string {
    return crypto.createHash('sha256').update(url.trim()).digest('hex');
}

/**
 * Analyze a single image using Gemini Vision and return a crisp 25-40 word physical visual description.
 */
export async function analyzeImageWithGemini(imageUrl: string): Promise<string> {
    try {
        console.log(`[Image Analysis] Downloading and analyzing image: ${imageUrl.slice(0, 80)}...`);
        const res = await fetch(imageUrl);
        if (!res.ok) {
            console.warn(`[Image Analysis] Failed to fetch image (${res.status} ${res.statusText}): ${imageUrl}`);
            return "Commercial product showcase featuring clear physical details and modern aesthetic.";
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        const mimeType = res.headers.get('content-type') || 'image/jpeg';

        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
        const visionPrompt = "Analyze this product / commercial / real estate image for an AI video generation prompt. Describe the exact setting, core product/property subject, materials, architectural style or design features, color palette, and lighting in 1 to 2 crisp sentences (strictly under 35 words). Focus purely on concrete physical appearance (e.g. 'A spacious modern living room with floor-to-ceiling windows, warm wooden flooring, a grey sectional sofa, and soft afternoon ambient light'). Do not include metadata, introductory filler, or generic commentary.";

        const result = await model.generateContent([
            visionPrompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType
                }
            }
        ]);

        const text = result.response.text()?.trim();
        if (text) {
            console.log(`[Image Analysis] Analysis successful: "${text}"`);
            return text;
        }
    } catch (err: any) {
        console.error(`[Image Analysis] Vision analysis failed for ${imageUrl}:`, err.message);
    }

    return "Commercial product showcase featuring clean physical details, vibrant colors, and modern aesthetic.";
}

/**
 * Retrieve cached image descriptions from DB or analyze missing images and persist descriptions.
 * Works seamlessly with properties table, image_analysis_cache table, or fallback storage.
 */
export async function resolveImageDescriptions(
    supabaseAdmin: SupabaseClient,
    imageUrls: string[],
    propertyId?: string | null
): Promise<string[]> {
    if (!imageUrls || imageUrls.length === 0) {
        return [];
    }

    const cleanUrls = imageUrls.filter(u => u && typeof u === 'string' && u.startsWith('http') && !u.includes('placeholder'));
    if (cleanUrls.length === 0) {
        return [];
    }

    const descriptionsMap = new Map<string, string>();

    // 1. Check image_analysis_cache table in Supabase
    try {
        const { data: cachedRows } = await supabaseAdmin
            .from('image_analysis_cache')
            .select('image_url, description')
            .in('image_url', cleanUrls);

        if (cachedRows && Array.isArray(cachedRows)) {
            for (const row of cachedRows) {
                if (row.image_url && row.description) {
                    descriptionsMap.set(row.image_url, row.description);
                }
            }
        }
    } catch (e: any) {
        // Table may not exist yet, continue to fallback checks
    }

    // 2. Check property table image_descriptions or metadata if propertyId is provided
    if (propertyId) {
        try {
            const { data: propData } = await supabaseAdmin
                .from('properties')
                .select('images, image_descriptions, marketing_copy_template')
                .eq('id', propertyId)
                .maybeSingle();

            if (propData) {
                // If image_descriptions is an array of objects or strings
                if (Array.isArray(propData.image_descriptions) && propData.image_descriptions.length > 0) {
                    propData.image_descriptions.forEach((item: any, idx: number) => {
                        if (typeof item === 'string' && propData.images && propData.images[idx]) {
                            descriptionsMap.set(propData.images[idx], item);
                        } else if (item && typeof item === 'object' && item.url && item.description) {
                            descriptionsMap.set(item.url, item.description);
                        }
                    });
                } else if (propData.marketing_copy_template && propData.marketing_copy_template.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(propData.marketing_copy_template);
                        if (parsed.image_analysis && Array.isArray(parsed.image_analysis)) {
                            parsed.image_analysis.forEach((item: any) => {
                                if (item.url && item.description) descriptionsMap.set(item.url, item.description);
                            });
                        }
                    } catch (e) {}
                }
            }
        } catch (propErr: any) {
            console.warn('[Image Analysis] Error checking property for cached descriptions:', propErr.message);
        }
    }

    // 3. Find URLs that are missing descriptions and analyze them in parallel
    const urlsToAnalyze = cleanUrls.filter(url => !descriptionsMap.has(url));
    if (urlsToAnalyze.length > 0) {
        console.log(`[Image Analysis] Analyzing ${urlsToAnalyze.length} new image(s) with Gemini Vision...`);
        const newlyAnalyzed = await Promise.all(
            urlsToAnalyze.map(async (url) => {
                const desc = await analyzeImageWithGemini(url);
                return { url, desc };
            })
        );

        // Store into map
        for (const item of newlyAnalyzed) {
            descriptionsMap.set(item.url, item.desc);
        }

        // 4. Persist newly analyzed descriptions to DB
        try {
            const cacheInserts = newlyAnalyzed.map(item => ({
                image_url: item.url,
                image_url_hash: hashImageUrl(item.url),
                description: item.desc
            }));

            await supabaseAdmin
                .from('image_analysis_cache')
                .upsert(cacheInserts, { onConflict: 'image_url' });
            console.log(`[Image Analysis] Successfully cached ${cacheInserts.length} descriptions in image_analysis_cache.`);
        } catch (cacheErr: any) {
            // If image_analysis_cache doesn't exist, try saving to property if available
            if (propertyId) {
                try {
                    const combinedList = cleanUrls.map(u => ({ url: u, description: descriptionsMap.get(u) || '' }));
                    await supabaseAdmin
                        .from('properties')
                        .update({
                            marketing_copy_template: JSON.stringify({ image_analysis: combinedList })
                        })
                        .eq('id', propertyId);
                    console.log(`[Image Analysis] Successfully saved descriptions to property ${propertyId}.`);
                } catch (pErr: any) {}
            }
        }
    } else {
        console.log(`[Image Analysis] All ${cleanUrls.length} image descriptions loaded from cache! ⚡`);
    }

    // Return descriptions strictly ordered matching the input imageUrls array
    return cleanUrls.map(url => descriptionsMap.get(url) || "Commercial product feature showcasing modern aesthetic and fine details.");
}
