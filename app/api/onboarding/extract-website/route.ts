import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';

export const maxDuration = 60; // Allow up to 60s for fetching & AI extraction

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const rawUrl = body.url?.trim();

        if (!rawUrl) {
            return NextResponse.json({ error: 'Please provide a valid website URL' }, { status: 400 });
        }

        // Clean & normalize URL
        let cleanUrl = rawUrl;
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
            cleanUrl = `https://${cleanUrl}`;
        }

        let parsedOrigin = '';
        try {
            const parsed = new URL(cleanUrl);
            parsedOrigin = parsed.origin;
        } catch {
            return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
        }

        console.log(`[Website Extractor] Fetching website content from: ${cleanUrl}`);

        let html = '';
        let markdownText = '';
        let extractedLogoCandidate = '';
        let pageTitle = '';

        // 1. Direct fetch with browser headers
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(cleanUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: controller.signal,
                redirect: 'follow'
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                html = await res.text();
            } else {
                console.warn(`[Website Extractor] Direct fetch returned status ${res.status}`);
            }
        } catch (fetchErr: any) {
            console.warn(`[Website Extractor] Direct fetch failed:`, fetchErr.message);
        }

        // 2. Fallback to Jina Reader if direct HTML is sparse or failed
        if (!html || html.length < 500) {
            try {
                console.log(`[Website Extractor] Trying Jina Reader fallback for: ${cleanUrl}`);
                const jinaRes = await fetch(`https://r.jina.ai/${cleanUrl}`, {
                    headers: { 'Accept': 'text/plain' },
                    signal: AbortSignal.timeout(10000)
                });
                if (jinaRes.ok) {
                    markdownText = await jinaRes.text();
                }
            } catch (jinaErr: any) {
                console.warn(`[Website Extractor] Jina Reader fallback failed:`, jinaErr.message);
            }
        }

        // 3. Extract preliminary meta tags from HTML if available
        if (html) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) pageTitle = titleMatch[1].trim();

            const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                                 html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
            if (ogImageMatch) {
                extractedLogoCandidate = ogImageMatch[1];
            } else {
                const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
                if (iconMatch) extractedLogoCandidate = iconMatch[1];
            }

            if (extractedLogoCandidate && !extractedLogoCandidate.startsWith('http')) {
                extractedLogoCandidate = `${parsedOrigin}/${extractedLogoCandidate.replace(/^\//, '')}`;
            }

            // Strip scripts, styles, and tags for compact AI prompt
            const cleanText = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
                .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
                .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 12000);

            if (!markdownText) {
                markdownText = cleanText;
            }
        }

        if (!markdownText && !pageTitle) {
            return NextResponse.json({
                error: 'Could not fetch content from this website. You can still fill in your details manually.'
            }, { status: 422 });
        }

        // 4. Use Gemini to intelligently extract brand & product info
        const schema = z.object({
            businessName: z.string().describe('The official or common brand name of the business'),
            businessInfo: z.string().describe('A 2 to 3 sentence compelling summary of what the company does, their mission, and who they serve'),
            contactNumber: z.string().describe('Primary phone number or WhatsApp contact if found on site, or empty string'),
            businessAddress: z.string().describe('Physical office, store, or headquarters address if found, or empty string'),
            logoUrl: z.string().describe('Best logo image or brand showcase URL found, or empty string'),
            industry: z.string().describe('The primary vertical/industry (e.g., Real Estate, Healthcare, E-Commerce, Consulting, Hospitality, Fashion)'),
            product: z.object({
                title: z.string().describe('Their flagship product, prominent service, or primary offering'),
                description: z.string().describe('Short 1-2 sentence description of key benefits and value proposition of this product or service'),
                price: z.string().describe('Estimated price or pricing starting point if mentioned on website, or empty string'),
                imageUrl: z.string().describe('Image URL of the product if found on website, or empty string')
            })
        });

        const prompt = `You are a world-class Business Analyst and Onboarding Specialist for Nobogent AI.
Analyze the extracted website content below for the domain "${cleanUrl}":

Page Title: "${pageTitle}"
Pre-extracted Logo Candidate: "${extractedLogoCandidate}"

Extracted Website Content:
${markdownText.slice(0, 8000)}

Your objective is to extract accurate, professional details for this company so their onboarding in Nobogent AI is 1-click effortless:
1. Business Name: Extract the clean brand name (omit long SEO tagline titles like "Best Realtors in Mumbai | Buy & Sell 2026").
2. Business Info: 2-3 professional, engaging sentences describing what they do, their core offering, and target audience.
3. Contact Number: Best phone/WhatsApp number if found.
4. Business Address: Physical location or city/state if found.
5. Logo URL: Use the pre-extracted logo candidate if valid, or extract the best public image URL representing their logo or brand.
6. Product / Service: Find their flagship product or key service offering that they would want to advertise on Meta Ads and create AI video commercials for.
`;

        let aiResult;
        try {
            const res = await generateObject({
                model: google('gemini-3.5-flash'),
                schema,
                prompt,
            });
            aiResult = res.object;
        } catch (err: any) {
            console.warn('[Website Extractor] Primary model failed, trying fallback:', err.message);
            const res = await generateObject({
                model: google('gemini-3-flash-preview'),
                schema,
                prompt,
            });
            aiResult = res.object;
        }

        // If AI didn't find a logoUrl but we had a candidate, keep the candidate
        if (!aiResult.logoUrl && extractedLogoCandidate) {
            aiResult.logoUrl = extractedLogoCandidate;
        }

        console.log(`[Website Extractor] Extraction successful for: ${aiResult.businessName}`);

        return NextResponse.json({
            success: true,
            data: {
                ...aiResult,
                websiteUrl: cleanUrl
            }
        });

    } catch (err: any) {
        console.error('[Website Extractor] Fatal error:', err);
        return NextResponse.json({
            error: err.message || 'Failed to extract website details'
        }, { status: 500 });
    }
}
