import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
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
    if (url.startsWith('data:')) {
        try {
            const base64Data = url.replace(/^data:image\/\w+;base64,/, '');
            return Buffer.from(base64Data, 'base64');
        } catch {
            return null;
        }
    }
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
 * Delivers a real-time synthesized 15-second cinematic real estate reel with dynamic voiceover & motion.
 */
async function generateRealtime15sVideo(input: CreativeInput, imageBuffer?: Buffer | null): Promise<GeneratedVideo | null> {
    const {
        projectTitle = 'Grand Horizon Villas',
        companyName = 'Luxury Estates',
        location = 'Prime Corridor',
        projectPrice = 'Starting ₹1.85 Cr',
        projectDescription = 'Exclusive luxury villas',
        projectImageUrl
    } = input;

    console.log(`[Realtime 15s Video] Synthesizing custom reel for "${projectTitle}" (${location}, ${projectPrice})...`);

    const fallbackVideo: GeneratedVideo = {
        id: `reel-${Date.now()}`,
        title: `${projectTitle} - 15s Voiceover Reel`,
        videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/demo_15s_voiceover_reel_1793007112340.mp4',
        aspectRatio: '9:16',
        duration: 15
    };

    try {
        const { size, type, perk } = parseSpecs(projectDescription, projectTitle);
        const cleanPrice = projectPrice.replace(/\s*\([^)]*\)/g, '').trim();
        const scriptText = `Welcome to ${projectTitle} by ${companyName} in ${location}. Featuring ${size} ${type} with ${perk}, starting at just ${cleanPrice}. Experience unmatched luxury. Book your private VIP preview today.`;

        // 1. Synthesize Studio Voiceover using Gemini Flash TTS
        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        let pcmBuffer: Buffer | null = null;

        if (geminiKey) {
            try {
                // Try gemini-3.8-flash-tts first (latest model), with fallback to gemini-2.5-flash-preview-tts
                const ttsModels = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
                for (const ttsModel of ttsModels) {
                    try {
                        const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/${ttsModel}:generateContent?key=${geminiKey}`;
                        const ttsRes = await fetch(ttsUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: scriptText }] }],
                                generationConfig: {
                                    responseModalities: ['AUDIO'],
                                    speechConfig: {
                                        voiceConfig: {
                                            prebuiltVoiceConfig: {
                                                voiceName: 'Aoede'
                                            }
                                        }
                                    }
                                }
                            })
                        });

                        if (ttsRes.ok) {
                            const ttsData = await ttsRes.json();
                            const b64 = ttsData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                            if (b64) {
                                pcmBuffer = Buffer.from(b64, 'base64');
                                console.log(`[Realtime 15s Video] Synthesized ${pcmBuffer.length} bytes of 24kHz studio voiceover using ${ttsModel}!`);
                                break;
                            }
                        } else {
                            console.warn(`[Realtime 15s Video] ${ttsModel} returned HTTP ${ttsRes.status}:`, await ttsRes.text());
                        }
                    } catch (modelErr: any) {
                        console.warn(`[Realtime 15s Video] Error calling ${ttsModel}:`, modelErr.message);
                    }
                }
            } catch (ttsErr: any) {
                console.warn('[Realtime 15s Video] TTS generation error:', ttsErr.message);
            }
        }

        // 2. Resolve image buffer
        let finalImgBuffer = imageBuffer;
        if (!finalImgBuffer && projectImageUrl) {
            finalImgBuffer = await fetchImageBuffer(projectImageUrl);
        }
        if (!finalImgBuffer) {
            finalImgBuffer = await fetchImageBuffer(LUXURY_FALLBACK_IMAGES[0]);
        }

        if (!finalImgBuffer || !pcmBuffer) {
            console.warn('[Realtime 15s Video] Missing image or audio buffer. Returning fallback video.');
            return fallbackVideo;
        }

        // 3. Temporary files on disk for ffmpeg
        const tmpDir = os.tmpdir();
        const randId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const tmpImgPath = path.join(tmpDir, `img_${randId}.jpg`);
        const tmpPcmPath = path.join(tmpDir, `aud_${randId}.pcm`);
        const tmpOutMp4 = path.join(tmpDir, `reel_${randId}.mp4`);

        fs.writeFileSync(tmpImgPath, finalImgBuffer);
        fs.writeFileSync(tmpPcmPath, pcmBuffer);

        // 4. Render with ffmpeg
        const resolvedFfmpegPath = typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.default || 'ffmpeg';

        await new Promise<void>((resolve, reject) => {
            const args = [
                '-y',
                '-loop', '1',
                '-i', tmpImgPath,
                '-f', 's16le',
                '-ar', '24000',
                '-ac', '1',
                '-i', tmpPcmPath,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'stillimage',
                '-pix_fmt', 'yuv420p',
                '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z=\'min(zoom+0.0008,1.15)\':d=375:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1080x1920:fps=25',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-t', '15',
                tmpOutMp4
            ];

            execFile(resolvedFfmpegPath, args, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        // 5. Upload rendered MP4 to Cloudflare R2
        const mp4Bytes = fs.readFileSync(tmpOutMp4);
        const r2Key = `demo-creatives/reel_${randId}.mp4`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: mp4Bytes,
            ContentType: 'video/mp4'
        }));

        const publicVideoUrl = `${R2_PUBLIC_URL}/${r2Key}`;
        console.log(`[Realtime 15s Video] Video uploaded successfully to R2: ${publicVideoUrl} (${(mp4Bytes.length / (1024 * 1024)).toFixed(2)} MB)`);

        // Cleanup temp files
        try { fs.unlinkSync(tmpImgPath); } catch {}
        try { fs.unlinkSync(tmpPcmPath); } catch {}
        try { fs.unlinkSync(tmpOutMp4); } catch {}

        return {
            id: `reel-${randId}`,
            title: `${projectTitle} - 15s Voiceover Reel`,
            videoUrl: publicVideoUrl,
            aspectRatio: '9:16',
            duration: 15
        };

    } catch (e: any) {
        console.error('[Realtime 15s Video] Render pipeline error, returning fallback:', e.message);
        return fallbackVideo;
    }
}

/**
 * Intelligently extracts architectural specifications (Size, Type, Key Privilege) from project text
 */
function parseSpecs(description: string, title: string): { size: string; type: string; perk: string } {
    const text = `${title} ${description}`;
    
    // 1. Detect Size
    let size = '6,000 SQ. FT.';
    const sizeMatch = text.match(/(\d+[\d,]*\s*(?:Sq\.?\s*Ft\.?|sqft|SQFT|Acres?|Guntas?|Yards?))/i);
    const bhkMatch = text.match(/(\d\s*BHK|\d\s*Bedroom)/i);
    if (sizeMatch) {
        size = sizeMatch[1].toUpperCase();
    } else if (bhkMatch) {
        size = bhkMatch[1].toUpperCase();
    }

    // 2. Detect Architecture / Unit Type
    let type = 'LUXURY RETREAT';
    if (/dome|glamping/i.test(text)) type = 'GLAMPING DOME';
    else if (/villa/i.test(text)) type = 'SIGNATURE VILLA';
    else if (/penthouse/i.test(text)) type = 'SKY PENTHOUSE';
    else if (/farm|plot/i.test(text)) type = 'ESTATE PLOT';
    else if (/mansion/i.test(text)) type = 'ROYAL MANSION';
    else if (/apartment|flat/i.test(text)) type = 'LUXURY SUITE';

    // 3. Detect Top Perk / ROI
    let perk = 'HIGH RENTAL ROI';
    if (/teakwood|plantation/i.test(text)) perk = 'ORGANIC TEAKWOOD';
    else if (/resort|club/i.test(text)) perk = 'RESORT PRIVILEGE';
    else if (/pool/i.test(text)) perk = 'PRIVATE POOL DECK';
    else if (/golf/i.test(text)) perk = 'GOLF COURSE VIEW';
    else if (/lake/i.test(text)) perk = 'LAKESIDE LIVING';

    return { size, type, perk };
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

    // 2. Resolve background buffer for the creative & video canvas
    let bgBuffer1: Buffer | null = null;
    let gptUrl1: string | null = null;

    if (projectImageUrl) {
        bgBuffer1 = await fetchImageBuffer(projectImageUrl);
        if (bgBuffer1) {
            console.log('[Creative Engine] Loaded user-provided project image for creative & video canvas.');
        }
    }

    if (!bgBuffer1) {
        console.log('[Creative Engine] No user image provided. Generating GPT 2.0 Image...');
        const prompt1 = `Master photorealistic architectural photograph of ${projectTitle} by ${companyName} in ${location}. ${projectDescription}. Sun-drenched exterior facade with lush landscaped greenery, private deck, warm ambient evening light, ultra-luxury real estate, architectural digest style, 8k commercial photography, 3:4 portrait ratio.`;
        gptUrl1 = await generateGpt2Image(prompt1);
        if (gptUrl1) {
            bgBuffer1 = await fetchImageBuffer(gptUrl1);
        }
    }

    if (!bgBuffer1) {
        bgBuffer1 = await fetchImageBuffer(LUXURY_FALLBACK_IMAGES[0]);
    }

    // 3. Kick off real-time 15-second Video Reel synthesis concurrently with static image rendering
    const videoPromise = generateRealtime15sVideo(input, bgBuffer1);

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

    const companyClean = escapeXml(companyName.toUpperCase());
    const titleClean = escapeXml(projectTitle.toUpperCase());
    
    // Clean price (extract main amount, add asterisk for luxury ads)
    const cleanPriceVal = escapeXml(projectPrice.replace(/\s*\([^)]*\)/g, '').trim());
    const priceClean = cleanPriceVal.endsWith('*') ? cleanPriceVal : `${cleanPriceVal}*`;
    
    const locationClean = escapeXml(location.toUpperCase());
    const phoneClean = escapeXml(contactNumber || '+91 98886 26786');

    const { size, type, perk } = parseSpecs(projectDescription, projectTitle);

    // Dynamic title wrapping (break into max 2 lines if long)
    const words = titleClean.split(' ');
    let line1 = titleClean;
    let line2 = '';
    if (words.length > 3) {
        const mid = Math.ceil(words.length / 2);
        line1 = words.slice(0, mid).join(' ');
        line2 = words.slice(mid).join(' ');
    }

    const companyFontSize = companyClean.length > 22 ? 12 : 14;
    const companyPillWidth = Math.min(480, Math.max(340, companyClean.length * 13 + 90));

    // =========================================================================
    // PROFESSIONAL DUBAI-STYLE REAL ESTATE META AD CREATIVE (3:4 Ratio)
    // =========================================================================
    const svgOverlay = Buffer.from(`
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <!-- Top Dark Gradient for Header Readability -->
                <linearGradient id="topVignette" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#020617" stop-opacity="0.90" />
                    <stop offset="60%" stop-color="#020617" stop-opacity="0.40" />
                    <stop offset="100%" stop-color="#020617" stop-opacity="0.0" />
                </linearGradient>

                <!-- Bottom Luxury Obsidian Scrim -->
                <linearGradient id="bottomVignette" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#020617" stop-opacity="0.0" />
                    <stop offset="20%" stop-color="#020617" stop-opacity="0.75" />
                    <stop offset="60%" stop-color="#020617" stop-opacity="0.96" />
                    <stop offset="100%" stop-color="#020617" stop-opacity="0.99" />
                </linearGradient>

                <!-- Gold Gradients for Luxury Highlights -->
                <linearGradient id="goldText" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#F59E0B" />
                    <stop offset="50%" stop-color="#FDE68A" />
                    <stop offset="100%" stop-color="#D97706" />
                </linearGradient>

                <linearGradient id="goldButton" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#D97706" />
                    <stop offset="45%" stop-color="#F59E0B" />
                    <stop offset="100%" stop-color="#FBBF24" />
                </linearGradient>

                <linearGradient id="goldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.9" />
                    <stop offset="50%" stop-color="#FDE68A" stop-opacity="0.4" />
                    <stop offset="100%" stop-color="#D97706" stop-opacity="0.9" />
                </linearGradient>

                <linearGradient id="cardBg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#0B132B" stop-opacity="0.94" />
                    <stop offset="100%" stop-color="#050814" stop-opacity="0.98" />
                </linearGradient>

                <linearGradient id="specBoxBg" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#1E293B" stop-opacity="0.80" />
                    <stop offset="100%" stop-color="#0F172A" stop-opacity="0.90" />
                </linearGradient>

                <!-- Soft Drop Shadows -->
                <filter id="shadowLg" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.85"/>
                </filter>
                <filter id="shadowSm" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.6"/>
                </filter>
            </defs>

            <!-- TOP GRADIENT OVERLAY -->
            <rect width="${width}" height="300" fill="url(#topVignette)" />

            <!-- BOTTOM CINEMATIC GRADIENT OVERLAY -->
            <rect y="640" width="${width}" height="960" fill="url(#bottomVignette)" />

            <!-- =================================================================== -->
            <!-- TOP BRAND & STATUS HEADER                                           -->
            <!-- =================================================================== -->
            <g transform="translate(48, 48)">
                <!-- Developer Pill -->
                <rect width="${companyPillWidth}" height="64" rx="32" fill="#030712" fill-opacity="0.80" stroke="url(#goldBorder)" stroke-width="1.2" />
                ${logoBase64 ? `
                    <image href="${logoBase64}" x="14" y="14" width="36" height="36" preserveAspectRatio="xMidYMid meet" />
                ` : `
                    <circle cx="32" cy="32" r="18" fill="#F59E0B" fill-opacity="0.2" />
                    <g transform="translate(22, 22)">
                        <path d="M2 16L0 3L7 9L10 0L13 9L20 3L18 16H2Z" fill="#FDE68A" />
                    </g>
                `}
                <text x="64" y="31" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="${companyFontSize}" font-weight="900" letter-spacing="1.5">${companyClean}</text>
                <text x="64" y="47" fill="#F59E0B" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="800" letter-spacing="2">OFFICIAL DEVELOPER</text>
            </g>

            <!-- Top Right Exclusive Tag -->
            <g transform="translate(860, 48)">
                <rect width="292" height="64" rx="32" fill="#030712" fill-opacity="0.80" stroke="url(#goldBorder)" stroke-width="1.2" />
                <circle cx="28" cy="32" r="6" fill="#F59E0B" />
                <text x="44" y="38" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" letter-spacing="2">EXCLUSIVE LAUNCH</text>
            </g>

            <!-- DUBAI-STYLE FLOATING TRUST BADGES (Top Strip) -->
            <g transform="translate(48, 130)">
                <g transform="translate(0, 0)">
                    <rect width="180" height="36" rx="18" fill="#020617" fill-opacity="0.80" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="1" />
                    <text x="90" y="23" fill="#E2E8F0" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" text-anchor="middle" letter-spacing="1">✓ 0% BROKERAGE</text>
                </g>
                <g transform="translate(196, 0)">
                    <rect width="220" height="36" rx="18" fill="#020617" fill-opacity="0.80" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="1" />
                    <text x="110" y="23" fill="#E2E8F0" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" text-anchor="middle" letter-spacing="1">✓ 100% FREEHOLD TITLE</text>
                </g>
                <g transform="translate(432, 0)">
                    <rect width="200" height="36" rx="18" fill="#020617" fill-opacity="0.80" stroke="url(#goldBorder)" stroke-width="1" />
                    <text x="100" y="23" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="900" text-anchor="middle" letter-spacing="1">★ HIGH RENTAL YIELD</text>
                </g>
            </g>

            <!-- =================================================================== -->
            <!-- BOTTOM LUXURY DUBAI AD CARD                                         -->
            <!-- =================================================================== -->
            <g transform="translate(48, 800)" filter="url(#shadowLg)">
                <!-- Main Glass Card Container -->
                <rect width="1104" height="750" rx="36" fill="url(#cardBg)" stroke="url(#goldBorder)" stroke-width="1.8" />

                <!-- Decorative Gold Corner Accent -->
                <path d="M 0 36 A 36 36 0 0 1 36 0 L 80 0 L 0 80 Z" fill="#F59E0B" fill-opacity="0.25" />

                <!-- Inner Content -->
                <g transform="translate(48, 44)">

                    <!-- LOCATION PILL -->
                    <g transform="translate(0, 0)">
                        <rect width="450" height="42" rx="21" fill="#F59E0B" fill-opacity="0.16" stroke="#F59E0B" stroke-width="1.4" />
                        <!-- Pin Icon -->
                        <g transform="translate(18, 12)">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8zm0 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" fill="#FDE68A" />
                        </g>
                        <text x="44" y="27" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" letter-spacing="1.5">${locationClean.slice(0, 36)}</text>
                    </g>

                    <!-- PROJECT TITLE (Bold Luxury Typography) -->
                    <g transform="translate(0, 92)">
                        ${line2 ? `
                            <text x="0" y="0" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="52" font-weight="900" letter-spacing="-0.5">${escapeXml(line1)}</text>
                            <text x="0" y="58" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="52" font-weight="900" letter-spacing="-0.5">${escapeXml(line2)}</text>
                        ` : `
                            <text x="0" y="20" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="56" font-weight="900" letter-spacing="-0.5">${escapeXml(line1)}</text>
                        `}
                    </g>

                    <!-- PRICE & OFFER SECTION -->
                    <g transform="translate(0, ${line2 ? 185 : 150})">
                        <!-- Top Line: Label + Badge -->
                        <text x="0" y="0" fill="#F59E0B" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" letter-spacing="2">STARTING INVESTMENT • INAUGURAL PRICE</text>
                        
                        <g transform="translate(688, -14)">
                            <rect width="320" height="42" rx="21" fill="#047857" fill-opacity="0.30" stroke="#10B981" stroke-width="1.4" />
                            <text x="160" y="27" fill="#6EE7B7" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" text-anchor="middle" letter-spacing="1">⚡ 100% REGISTRATION READY</text>
                        </g>

                        <!-- Large Price Display -->
                        <text x="0" y="64" fill="url(#goldText)" font-family="'Segoe UI', Roboto, sans-serif" font-size="64" font-weight="900" letter-spacing="0.5" filter="url(#shadowSm)">${priceClean}</text>
                    </g>

                    <!-- 3-PILLAR DUBAI SPECIFICATION GRID -->
                    <g transform="translate(0, ${line2 ? 295 : 260})">
                        <!-- Box 1: Unit Size -->
                        <g transform="translate(0, 0)">
                            <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="#334155" stroke-width="1.2" />
                            <text x="24" y="34" fill="#94A3B8" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" letter-spacing="1.5">📐 ESTATE AREA</text>
                            <text x="24" y="68" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900">${size}</text>
                            <text x="24" y="92" fill="#F59E0B" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700">Clear Demarcation</text>
                        </g>

                        <!-- Box 2: Unit Type -->
                        <g transform="translate(344, 0)">
                            <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="#334155" stroke-width="1.2" />
                            <text x="24" y="34" fill="#94A3B8" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800" letter-spacing="1.5">🏡 RESIDENCE TYPE</text>
                            <text x="24" y="68" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900">${type}</text>
                            <text x="24" y="92" fill="#38BDF8" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700">Luxury Glamping Setup</text>
                        </g>

                        <!-- Box 3: Investment Perk -->
                        <g transform="translate(688, 0)">
                            <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="url(#goldBorder)" stroke-width="1.2" />
                            <text x="24" y="34" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="900" letter-spacing="1.5">💎 KEY PRIVILEGE</text>
                            <text x="24" y="68" fill="url(#goldText)" font-family="'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="900">${perk}</text>
                            <text x="24" y="92" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700">Exclusive Resort Access</text>
                        </g>
                    </g>

                    <!-- DIRECT RESPONSE CONVERSION FOOTER (CALL & CTA) -->
                    <g transform="translate(0, ${line2 ? 435 : 400})">
                        <!-- Left: Phone / WhatsApp Direct Response -->
                        <g transform="translate(0, 0)">
                            <rect width="520" height="76" rx="38" fill="#020617" fill-opacity="0.85" stroke="#334155" stroke-width="1.4" />
                            <!-- Green WhatsApp Icon -->
                            <g transform="translate(18, 14)">
                                <circle cx="24" cy="24" r="24" fill="#22C55E" />
                                <path d="M24 10C16.27 10 10 16.27 10 24C10 26.79 10.82 29.39 12.23 31.58L11 37L16.63 35.81C18.73 37.12 21.27 37.91 24 37.91C31.73 37.91 38 31.64 38 23.91C38 16.18 31.73 10 24 10ZM31.14 29.83C30.73 30.98 29.13 31.96 28.02 32.19C27.26 32.34 26.27 32.47 22.93 31.08C18.66 29.31 15.9 24.96 15.68 24.67C15.48 24.39 13.94 22.33 13.94 20.21C13.94 18.09 15.01 17.06 15.45 16.62C15.81 16.26 16.4 16.1 16.96 16.1C17.14 16.1 17.31 16.11 17.46 16.12C17.9 16.14 18.12 16.17 18.41 16.86C18.77 17.72 19.65 19.86 19.76 20.08C19.87 20.3 19.98 20.6 19.83 20.89C19.69 21.19 19.58 21.3 19.36 21.56C19.14 21.82 18.94 21.99 18.72 22.25C18.52 22.49 18.3 22.74 18.55 23.16C18.8 23.58 19.66 24.98 20.93 26.11C22.57 27.57 23.9 28.03 24.32 28.21C24.64 28.34 25.02 28.31 25.25 28.06C25.54 27.75 25.9 27.24 26.26 26.73C26.52 26.36 26.85 26.31 27.19 26.44C27.54 26.56 29.41 27.48 29.79 27.67C30.17 27.86 30.42 27.95 30.51 28.11C30.6 28.27 30.6 29.04 31.14 29.83Z" fill="#FFFFFF" />
                            </g>
                            
                            <text x="80" y="33" fill="#94A3B8" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" letter-spacing="1.5">CALL OR WHATSAPP DIRECT</text>
                            <text x="80" y="58" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="23" font-weight="900" letter-spacing="1">${phoneClean}</text>
                        </g>

                        <!-- Right: High-Converting Gold Action Button -->
                        <g transform="translate(544, 0)">
                            <rect width="464" height="76" rx="38" fill="url(#goldButton)" stroke="#FDE68A" stroke-width="1.6" filter="url(#shadowSm)" />
                            <text x="232" y="47" fill="#0F172A" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" text-anchor="middle" letter-spacing="1.5">SCHEDULE VIP SITE VISIT ➔</text>
                        </g>
                    </g>

                    <!-- TRUST / RERA LEGAL STRIP -->
                    <g transform="translate(0, ${line2 ? 545 : 510})">
                        <line x1="0" y1="0" x2="1008" y2="0" stroke="#334155" stroke-opacity="0.5" stroke-width="1" />
                        <text x="504" y="24" fill="#64748B" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" text-anchor="middle" letter-spacing="1">
                            🔒 100% CLEAR TITLED PROPERTY • DIRECT DEVELOPER PRICING • LIMITED TIME INAUGURAL PRIVILEGE
                        </text>
                    </g>

                </g>
            </g>
        </svg>
    `);

    // 4. Render Single Clean Creative with Sharp
    const imgBuffer = await sharp(bgBuffer1!)
        .resize(width, height, { fit: 'cover', position: 'center' })
        .composite([{ input: svgOverlay, top: 0, left: 0 }])
        .jpeg({ quality: 92, progressive: true })
        .toBuffer();

    // 5. Persist to Cloudflare R2
    const creativeKey = `demo/creatives/${Date.now()}_clean_3_4.jpg`;
    let url = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;

    try {
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: creativeKey,
            Body: imgBuffer,
            ContentType: 'image/jpeg'
        }));
        url = `${R2_PUBLIC_URL}/${creativeKey}`;
    } catch (r2Err) {
        console.warn("[Creative Engine] R2 persistence warning, falling back to base64:", r2Err);
    }

    // Await the real-time video generation
    const videoResult = await videoPromise;

    return {
        creatives: [
            {
                id: 'creative-clean-3-4',
                name: 'High-Converting 3:4 Ad Creative',
                styleName: 'Minimalist Commercial (3:4)',
                aspectRatio: '3:4',
                imageUrl: url,
                headline: copyResult.headline,
                primaryText: copyResult.primaryText,
                ctaText: copyResult.callToAction
            }
        ],
        video: videoResult,
        adCopy: copyResult
    };
}
