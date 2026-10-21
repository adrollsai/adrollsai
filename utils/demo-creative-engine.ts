import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

export interface CreativeInput {
    companyName: string;
    projectTitle: string;
    projectDescription: string;
    projectPrice: string;
    location: string;
    logoUrl?: string;
    projectImageUrl?: string;
    prospectName?: string;
    contactNumber?: string;
    generateVideo?: boolean;
}

export interface GeneratedCreative {
    id: string;
    name: string;
    styleName: string;
    aspectRatio: '3:4';
    imageUrl: string;
    headline: string;
    primaryText: string;
    ctaText: string;
}

export interface GeneratedVideo {
    id: string;
    title: string;
    videoUrl: string;
    aspectRatio: '9:16';
    duration: number;
    taskId?: string;
}

const LUXURY_FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=80'
];

function escapeXml(unsafe: string): string {
    return (unsafe || '').replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

/**
 * Downloads an image buffer from an external URL with timeout and fallback.
 */
async function fetchImageBuffer(url?: string): Promise<Buffer | null> {
    if (!url) return null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
    } catch {
        return null;
    }
}

/**
 * Calls Kie.ai API to generate an image using the GPT 2.0 image model (`gpt-image-2-text-to-image`)
 */
async function generateGpt2Image(prompt: string): Promise<string | null> {
    const key = process.env.KIE_API_KEY;
    if (!key) return null;

    try {
        console.log(`[GPT 2.0 Image] Creating task for prompt: "${prompt.slice(0, 60)}..."`);
        const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: 'gpt-image-2-text-to-image',
                input: {
                    prompt,
                    aspect_ratio: '3:4'
                }
            })
        });

        const data = await res.json();
        if (!res.ok || data.code !== 200 || !data.data?.taskId) {
            console.warn('[GPT 2.0 Image] Task creation error:', data);
            return null;
        }

        const taskId = data.data.taskId;
        console.log(`[GPT 2.0 Image] Task created: ${taskId}. Polling for completion...`);

        // Poll for up to 90 seconds
        const startTime = Date.now();
        while (Date.now() - startTime < 90000) {
            await new Promise(r => setTimeout(r, 4000));
            const statusRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                headers: { 'Authorization': `Bearer ${key}` }
            });
            const statusData = await statusRes.json();
            const state = statusData.data?.state;

            if (state === 'success') {
                let resultUrl = statusData.data?.response?.resultUrls?.[0];
                if (!resultUrl && statusData.data?.resultJson) {
                    try {
                        const parsed = JSON.parse(statusData.data.resultJson);
                        resultUrl = parsed.resultUrls?.[0];
                    } catch {}
                }
                console.log(`[GPT 2.0 Image] Generated successfully: ${resultUrl}`);
                return resultUrl || null;
            }

            if (state === 'fail') {
                console.warn(`[GPT 2.0 Image] Task ${taskId} failed:`, statusData.data?.failMsg);
                return null;
            }
        }
        return null;
    } catch (e: any) {
        console.warn('[GPT 2.0 Image] Exception during generation:', e.message);
        return null;
    }
}

/**
 * Creates and polls a 15-second video task using grok-imagine-video-1-5-preview
 */
async function generate15sVideo(prompt: string, referenceImageUrl?: string): Promise<GeneratedVideo | null> {
    const key = process.env.KIE_API_KEY;
    if (!key) return null;

    try {
        console.log(`[15s Video] Creating 15s video task with Grok...`);
        const payload: any = {
            model: 'grok-imagine-video-1-5-preview',
            input: {
                prompt: `Cinematic commercial property showcase: ${prompt}. Photorealistic architectural drone tour, smooth camera movement, natural golden sunlight, 4k commercial quality, no text overlays, no titles.`,
                aspect_ratio: '9:16',
                duration: 15,
                resolution: '480p',
                nsfw_checker: true
            }
        };

        if (referenceImageUrl && !referenceImageUrl.startsWith('data:')) {
            payload.input.image_urls = [referenceImageUrl];
        }

        const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || data.code !== 200 || !data.data?.taskId) {
            console.warn('[15s Video] Task creation error:', data);
            return null;
        }

        const taskId = data.data.taskId;
        console.log(`[15s Video] Video task created: ${taskId}. Polling...`);

        // Poll for up to 120 seconds
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) {
            await new Promise(r => setTimeout(r, 5000));
            const statusRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                headers: { 'Authorization': `Bearer ${key}` }
            });
            const statusData = await statusRes.json();
            const state = statusData.data?.state;

            if (state === 'success') {
                let videoUrl = statusData.data?.response?.resultUrls?.[0];
                if (!videoUrl && statusData.data?.resultJson) {
                    try {
                        const parsed = JSON.parse(statusData.data.resultJson);
                        videoUrl = parsed.resultUrls?.[0];
                    } catch {}
                }

                if (videoUrl) {
                    // Persist to Cloudflare R2
                    try {
                        const vidRes = await fetch(videoUrl);
                        const vidBuf = Buffer.from(await vidRes.arrayBuffer());
                        const vidKey = `demo/videos/${Date.now()}_15s_reel.mp4`;
                        await r2.send(new PutObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: vidKey,
                            Body: vidBuf,
                            ContentType: 'video/mp4'
                        }));
                        const permanentUrl = `${R2_PUBLIC_URL}/${vidKey}`;
                        return {
                            id: 'demo-video-15s',
                            title: '15-Second Cinematic Meta Reel',
                            videoUrl: permanentUrl,
                            aspectRatio: '9:16',
                            duration: 15,
                            taskId
                        };
                    } catch (r2VidErr) {
                        return {
                            id: 'demo-video-15s',
                            title: '15-Second Cinematic Meta Reel',
                            videoUrl,
                            aspectRatio: '9:16',
                            duration: 15,
                            taskId
                        };
                    }
                }
            }

            if (state === 'fail') {
                console.warn(`[15s Video] Task ${taskId} failed:`, statusData.data?.failMsg);
                return null;
            }
        }

        // If timed out, return task info so client can continue polling
        return {
            id: 'demo-video-15s',
            title: '15-Second Cinematic Meta Reel (Generating)',
            videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/demo_15s_video_1792609681089.mp4', // pre-rendered 15s sample fallback
            aspectRatio: '9:16',
            duration: 15,
            taskId
        };
    } catch (e: any) {
        console.warn('[15s Video] Exception during generation:', e.message);
        return null;
    }
}

/**
 * Generates two 3:4 aspect ratio (1200 x 1600) ad creatives with real GPT 2.0 image generation + 15s video.
 */
export async function generateDualDemoCreatives(input: CreativeInput): Promise<{
    creatives: GeneratedCreative[];
    video?: GeneratedVideo | null;
    adCopy: {
        headline: string;
        primaryText: string;
        callToAction: string;
    };
}> {
    const {
        companyName = 'Luxury Estates',
        projectTitle = 'The Grand Horizon Residences',
        projectDescription = 'Exclusive 4BHK Sky Mansions with private infinity pool and panoramic views.',
        projectPrice = 'Starting ₹1.85 Cr',
        location = 'Prime Corridor',
        logoUrl,
        projectImageUrl,
        contactNumber = '+91 98726 69935'
    } = input;

    // 1. Generate high-converting Ad Copy via Gemini
    let copyResult = {
        headline: `Limited Inventory: ${projectTitle}`,
        primaryText: `Experience redefined luxury living in ${location}. ${projectDescription}. Book your private preview today.`,
        callToAction: 'Book VIP Site Visit'
    };

    try {
        const aiResponse = await generateObject({
            model: google('gemini-2.5-flash'),
            schema: z.object({
                headline: z.string().describe("Punchy, high-converting ad headline (under 8 words)"),
                primaryText: z.string().describe("Direct-response advertising primary text with urgency"),
                callToAction: z.string().describe("CTA button label (e.g. 'Book VIP Site Visit')")
            }),
            prompt: `You are an elite creative director for luxury real estate on Meta and Instagram. Write high-converting ad copy for:
Company: ${companyName}
Project: ${projectTitle}
Location: ${location}
Price: ${projectPrice}
Key Features: ${projectDescription}`
        });

        if (aiResponse.object) {
            copyResult = aiResponse.object;
        }
    } catch (e) {
        console.warn("[Creative Engine] Ad copy generation fallback:", e);
    }

    // 2. TRIGGER REAL GPT 2.0 IMAGE GENERATIONS IN PARALLEL
    const prompt1 = `Master photorealistic architectural photograph of ${projectTitle} by ${companyName} in ${location}. ${projectDescription}. Sun-drenched exterior facade with lush landscaped greenery, private deck, warm ambient evening light, ultra-luxury real estate, architectural digest style, 8k commercial photography, 3:4 portrait ratio.`;
    const prompt2 = `Ultra-modern luxury interior living room of ${projectTitle} in ${location}. Double-height ceilings, floor-to-ceiling glass windows with panoramic view of greenery, marble floors, designer furniture, warm golden hour interior lighting, 8k luxury commercial photography, 3:4 portrait ratio.`;

    console.log('[Creative Engine] Triggering GPT 2.0 Image and 15s Video generations in parallel...');

    const [gptUrl1, gptUrl2, videoResult] = await Promise.all([
        generateGpt2Image(prompt1),
        generateGpt2Image(prompt2),
        generate15sVideo(`${projectTitle} in ${location}, ${projectDescription}`, projectImageUrl)
    ]);

    // 3. Resolve background buffers for both creatives
    const fallbackBuf = await fetchImageBuffer(projectImageUrl) || await fetchImageBuffer(LUXURY_FALLBACK_IMAGES[0]);
    let bgBuffer1: Buffer | null = null;
    let bgBuffer2: Buffer | null = null;

    if (gptUrl1) {
        bgBuffer1 = await fetchImageBuffer(gptUrl1);
    }
    if (gptUrl2) {
        bgBuffer2 = await fetchImageBuffer(gptUrl2);
    }

    if (!bgBuffer1) bgBuffer1 = fallbackBuf;
    if (!bgBuffer2) bgBuffer2 = await fetchImageBuffer(LUXURY_FALLBACK_IMAGES[1]) || fallbackBuf;

    const width = 1200;
    const height = 1600;

    // Process logo buffer
    let logoBuffer: Buffer | null = await fetchImageBuffer(logoUrl);
    let logoBase64: string | null = null;
    if (logoBuffer) {
        try {
            const resizedLogo = await sharp(logoBuffer)
                .resize({ width: 140, height: 140, fit: 'inside' })
                .png()
                .toBuffer();
            logoBase64 = `data:image/png;base64,${resizedLogo.toString('base64')}`;
        } catch {
            logoBase64 = null;
        }
    }

    const companyNameClean = escapeXml(companyName.toUpperCase());
    const projectTitleClean = escapeXml(projectTitle.toUpperCase());
    const priceClean = escapeXml(projectPrice);
    const locationClean = escapeXml(location);
    const contactClean = escapeXml(contactNumber);

    const highlightWords = projectDescription.split(/[•,.\n]/).map(s => s.trim()).filter(Boolean);
    const highlight1 = escapeXml(highlightWords[0] || 'Exclusive Residences');
    const highlight2 = escapeXml(highlightWords[1] || 'Private Deck & Amenities');
    const highlight3 = escapeXml(highlightWords[2] || 'Prime Connectivity');

    // =========================================================================
    // CREATIVE 1: LUXURY ARCHITECTURAL SHOWCASE (Gold Sovereign & Dark Obsidian)
    // =========================================================================
    const svgOverlay1 = Buffer.from(`
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bgGrad1" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#020617" stop-opacity="0.85" />
                    <stop offset="25%" stop-color="#020617" stop-opacity="0.1" />
                    <stop offset="55%" stop-color="#020617" stop-opacity="0.35" />
                    <stop offset="78%" stop-color="#020617" stop-opacity="0.94" />
                    <stop offset="100%" stop-color="#020617" stop-opacity="0.98" />
                </linearGradient>

                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#F59E0B" />
                    <stop offset="50%" stop-color="#FDE68A" />
                    <stop offset="100%" stop-color="#D97706" />
                </linearGradient>

                <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                    <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.6"/>
                </filter>
            </defs>

            <!-- Background Vignette -->
            <rect width="${width}" height="${height}" fill="url(#bgGrad1)" />

            <!-- TOP BRAND HEADER -->
            <g transform="translate(60, 60)">
                <rect width="1080" height="96" rx="48" fill="#0f172a" fill-opacity="0.8" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.4" filter="url(#shadow)" />
                
                ${logoBase64 ? `
                    <image href="${logoBase64}" x="24" y="16" width="64" height="64" preserveAspectRatio="xMidYMid meet" />
                    <text x="108" y="58" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="28" font-weight="900" letter-spacing="2">${companyNameClean}</text>
                ` : `
                    <circle cx="52" cy="48" r="28" fill="#f59e0b" fill-opacity="0.2" stroke="#f59e0b" stroke-width="2" />
                    <text x="52" y="56" fill="#f59e0b" font-family="'Inter', system-ui, sans-serif" font-size="24" font-weight="900" text-anchor="middle">${companyNameClean.slice(0, 2)}</text>
                    <text x="96" y="58" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="28" font-weight="900" letter-spacing="2">${companyNameClean}</text>
                `}

                <rect x="850" y="24" width="206" height="48" rx="24" fill="#f59e0b" fill-opacity="0.15" stroke="#f59e0b" stroke-width="1.5" />
                <circle cx="876" cy="48" r="10" fill="#f59e0b" />
                <path d="M872 48 L875 51 L881 44" stroke="#000000" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                <text x="898" y="54" fill="#FDE68A" font-family="'Inter', system-ui, sans-serif" font-size="16" font-weight="800" letter-spacing="1">GPT 2.0 AI VERIFIED</text>
            </g>

            <!-- FLOATING PRE-LAUNCH BADGE -->
            <g transform="translate(60, 200)">
                <rect width="360" height="46" rx="23" fill="#1e293b" fill-opacity="0.85" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.2" />
                <text x="24" y="29" fill="#F59E0B" font-family="'Inter', system-ui, sans-serif" font-size="16" font-weight="900" letter-spacing="1.5">★ EXCLUSIVE PRE-LAUNCH</text>
            </g>

            <!-- BOTTOM HERO DETAILS & TYPOGRAPHY -->
            <g transform="translate(60, 1020)">
                <g transform="translate(0, 0)">
                    <rect width="320" height="42" rx="21" fill="#f59e0b" fill-opacity="0.2" stroke="#f59e0b" stroke-width="1.5" />
                    <text x="20" y="27" fill="#FDE68A" font-family="'Inter', system-ui, sans-serif" font-size="18" font-weight="800" letter-spacing="1">📍 ${locationClean}</text>
                </g>

                <text x="0" y="110" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="52" font-weight="900" letter-spacing="-1">${projectTitleClean}</text>
                <text x="0" y="155" fill="url(#goldGrad)" font-family="'Inter', system-ui, sans-serif" font-size="34" font-weight="900" letter-spacing="1">${priceClean}</text>

                <g transform="translate(0, 190)">
                    <rect width="330" height="40" rx="12" fill="#0f172a" fill-opacity="0.8" stroke="#334155" stroke-width="1" />
                    <text x="16" y="25" fill="#E2E8F0" font-family="'Inter', system-ui, sans-serif" font-size="15" font-weight="700">✓ ${highlight1.slice(0, 28)}</text>

                    <rect x="345" y="0" width="330" height="40" rx="12" fill="#0f172a" fill-opacity="0.8" stroke="#334155" stroke-width="1" />
                    <text x="361" y="25" fill="#E2E8F0" font-family="'Inter', system-ui, sans-serif" font-size="15" font-weight="700">✓ ${highlight2.slice(0, 28)}</text>

                    <rect x="690" y="0" width="340" height="40" rx="12" fill="#0f172a" fill-opacity="0.8" stroke="#334155" stroke-width="1" />
                    <text x="706" y="25" fill="#E2E8F0" font-family="'Inter', system-ui, sans-serif" font-size="15" font-weight="700">✓ ${highlight3.slice(0, 28)}</text>
                </g>
            </g>

            <!-- FOOTER CALL TO ACTION BAR -->
            <g transform="translate(60, 1370)">
                <rect width="1080" height="150" rx="32" fill="#0b1329" fill-opacity="0.95" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.5" filter="url(#shadow)" />
                
                <text x="48" y="60" fill="#94A3B8" font-family="'Inter', system-ui, sans-serif" font-size="14" font-weight="800" letter-spacing="2">CALL / WHATSAPP INQUIRY</text>
                <text x="48" y="100" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="34" font-weight="900" letter-spacing="1">📞 ${contactClean}</text>

                <g transform="translate(680, 40)">
                    <rect width="350" height="70" rx="35" fill="url(#goldGrad)" filter="url(#shadow)" />
                    <text x="175" y="44" fill="#000000" font-family="'Inter', system-ui, sans-serif" font-size="20" font-weight="900" text-anchor="middle" letter-spacing="1">BOOK SITE VISIT ➔</text>
                </g>
            </g>
        </svg>
    `);

    // =========================================================================
    // CREATIVE 2: HIGH-CONVERTING SOCIAL GLASS (Cyan, Ruby, & Clean White)
    // =========================================================================
    const svgOverlay2 = Buffer.from(`
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bgGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#030712" stop-opacity="0.9" />
                    <stop offset="20%" stop-color="#030712" stop-opacity="0.05" />
                    <stop offset="50%" stop-color="#030712" stop-opacity="0.3" />
                    <stop offset="75%" stop-color="#030712" stop-opacity="0.92" />
                    <stop offset="100%" stop-color="#030712" stop-opacity="0.98" />
                </linearGradient>

                <linearGradient id="cyanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#06B6D4" />
                    <stop offset="100%" stop-color="#3B82F6" />
                </linearGradient>

                <linearGradient id="rubyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#E11D48" />
                    <stop offset="100%" stop-color="#BE123C" />
                </linearGradient>
            </defs>

            <rect width="${width}" height="${height}" fill="url(#bgGrad2)" />

            <!-- TOP HEADER WITH LOGO -->
            <g transform="translate(60, 60)">
                <rect width="1080" height="96" rx="28" fill="#111827" fill-opacity="0.8" stroke="#06b6d4" stroke-width="2" stroke-opacity="0.3" />

                ${logoBase64 ? `
                    <image href="${logoBase64}" x="24" y="16" width="64" height="64" preserveAspectRatio="xMidYMid meet" />
                    <text x="108" y="58" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="28" font-weight="900" letter-spacing="2">${companyNameClean}</text>
                ` : `
                    <circle cx="52" cy="48" r="28" fill="#06b6d4" fill-opacity="0.2" stroke="#06b6d4" stroke-width="2" />
                    <text x="52" y="56" fill="#06b6d4" font-family="'Inter', system-ui, sans-serif" font-size="24" font-weight="900" text-anchor="middle">${companyNameClean.slice(0, 2)}</text>
                    <text x="96" y="58" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="28" font-weight="900" letter-spacing="2">${companyNameClean}</text>
                `}

                <g transform="translate(860, 24)">
                    <rect width="190" height="48" rx="24" fill="url(#rubyGrad)" />
                    <text x="95" y="30" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="15" font-weight="900" text-anchor="middle" letter-spacing="1">GPT 2.0 STUDIO</text>
                </g>
            </g>

            <!-- OFFER HIGHLIGHT PILL -->
            <g transform="translate(60, 190)">
                <rect width="380" height="48" rx="24" fill="#06b6d4" fill-opacity="0.2" stroke="#06b6d4" stroke-width="1.5" />
                <text x="24" y="30" fill="#22D3EE" font-family="'Inter', system-ui, sans-serif" font-size="16" font-weight="900" letter-spacing="1">⚡ LIMITED PRE-LAUNCH SLOTS</text>
            </g>

            <!-- LOWER HIGH-CONVERTING CARD -->
            <g transform="translate(60, 1080)">
                <rect width="1080" height="440" rx="36" fill="#090d16" fill-opacity="0.95" stroke="#1e293b" stroke-width="2" />
                
                <text x="48" y="55" fill="#38BDF8" font-family="'Inter', system-ui, sans-serif" font-size="18" font-weight="900" letter-spacing="1.5">📍 ${locationClean.toUpperCase()}</text>
                <text x="48" y="115" fill="#FFFFFF" font-family="'Inter', system-ui, sans-serif" font-size="44" font-weight="900" letter-spacing="-0.5">${projectTitleClean}</text>
                <text x="48" y="165" fill="#4ADE80" font-family="'Inter', system-ui, sans-serif" font-size="36" font-weight="900">${priceClean}</text>

                <text x="48" y="215" fill="#94A3B8" font-family="'Inter', system-ui, sans-serif" font-size="18" font-weight="500">✓ ${highlight1}  •  ✓ ${highlight2}</text>

                <g transform="translate(48, 260)">
                    <rect width="984" height="84" rx="24" fill="url(#cyanGrad)" />
                    <text x="492" y="52" fill="#020617" font-family="'Inter', system-ui, sans-serif" font-size="24" font-weight="900" text-anchor="middle" letter-spacing="1.5">CLAIM LAUNCH INCENTIVE &amp; SCHEDULE VISIT ➔</text>
                </g>

                <text x="48" y="395" fill="#475569" font-family="'Inter', system-ui, sans-serif" font-size="15" font-weight="600">Instant AI Phone Call &amp; WhatsApp Assistance • Official Project Partner</text>
            </g>
        </svg>
    `);

    // 4. Render Creatives with Sharp
    const [img1Buffer, img2Buffer] = await Promise.all([
        sharp(bgBuffer1!)
            .resize(width, height, { fit: 'cover', position: 'center' })
            .composite([{ input: svgOverlay1, top: 0, left: 0 }])
            .jpeg({ quality: 92, progressive: true })
            .toBuffer(),
        sharp(bgBuffer2!)
            .resize(width, height, { fit: 'cover', position: 'center' })
            .composite([{ input: svgOverlay2, top: 0, left: 0 }])
            .jpeg({ quality: 92, progressive: true })
            .toBuffer()
    ]);

    // 5. Persist to Cloudflare R2
    const creative1Key = `demo/creatives/${Date.now()}_gpt2_gold_3_4.jpg`;
    const creative2Key = `demo/creatives/${Date.now()}_gpt2_cyan_3_4.jpg`;

    let url1 = `data:image/jpeg;base64,${img1Buffer.toString('base64')}`;
    let url2 = `data:image/jpeg;base64,${img2Buffer.toString('base64')}`;

    try {
        await Promise.all([
            r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: creative1Key,
                Body: img1Buffer,
                ContentType: 'image/jpeg'
            })),
            r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: creative2Key,
                Body: img2Buffer,
                ContentType: 'image/jpeg'
            }))
        ]);

        url1 = `${R2_PUBLIC_URL}/${creative1Key}`;
        url2 = `${R2_PUBLIC_URL}/${creative2Key}`;
    } catch (r2Err) {
        console.warn("[Creative Engine] R2 persistence warning, falling back to base64:", r2Err);
    }

    return {
        creatives: [
            {
                id: 'creative-gpt2-gold-3-4',
                name: 'Concept 1: GPT 2.0 Architectural Sovereign',
                styleName: 'Gold Sovereign (GPT 2.0)',
                aspectRatio: '3:4',
                imageUrl: url1,
                headline: copyResult.headline,
                primaryText: copyResult.primaryText,
                ctaText: copyResult.callToAction
            },
            {
                id: 'creative-gpt2-cyan-3-4',
                name: 'Concept 2: GPT 2.0 Cyber Glass Performance',
                styleName: 'Cyber Glass (GPT 2.0)',
                aspectRatio: '3:4',
                imageUrl: url2,
                headline: `Exclusive Launch: ${projectTitle}`,
                primaryText: `Limited inventory remaining for ${projectTitle} by ${companyName}. Direct developer launch incentives in ${location}.`,
                ctaText: 'Claim Offer & Visit'
            }
        ],
        video: videoResult,
        adCopy: copyResult
    };
}
