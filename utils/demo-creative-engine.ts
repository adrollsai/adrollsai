import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { generateObject, generateText } from 'ai';
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
    videoLanguage?: string;
    callLanguage?: string;
    templateId?: string;
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

export interface CaptionCue {
    start: number;
    end: number;
    text: string;
}

export interface GeneratedVideo {
    id: string;
    title: string;
    videoUrl: string;
    aspectRatio: '9:16';
    duration: number;
    taskId?: string;
    scriptText?: string;
    scriptCues?: CaptionCue[];
}

import {
    REFERENCE_TEMPLATES_MAP,
    getReferenceTemplate,
    ALL_REFERENCE_TEMPLATES,
    ReferenceTemplate
} from '@/utils/reference-templates-data';
import {
    createKieTask,
    createGrokVideoTask,
    createGeminiTTS,
    queryKieTask
} from '@/utils/external-apis';
import { ensureJpegImage } from '@/utils/image-converter';

export const REFERENCE_TEMPLATES = REFERENCE_TEMPLATES_MAP;

const LUXURY_FALLBACK_IMAGES = [
    'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_0.jpg',
    'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_1.jpg',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80'
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
 * Synthesizes a true AI-generated ad creative using Kie.ai (`gpt-image-2-5-flare-image-to-image`)
 * following the exact visual blueprint of the selected reference template and user property assets.
 */
async function generateRealtimeAiCreative(input: CreativeInput, selectedTemplate?: ReferenceTemplate | null): Promise<string | null> {
    const {
        companyName = 'Apex Luxury Living',
        projectTitle = 'The Grand Crest Luxury Residences',
        projectDescription = 'Ultra luxury residences with sky terraces, private infinity pool and smart concierge',
        projectPrice = 'Starting ₹1.85 Cr',
        location = 'Golf Course Extension, Prime Metro Corridor',
        projectImageUrl,
        logoUrl,
        contactNumber = '+91 98886 26786'
    } = input;

    // 1. Resolve template image and user property photo
    const refTemplateUrl = selectedTemplate?.url || (input.templateId && input.templateId.startsWith('http') ? input.templateId : null);
    const templateName = selectedTemplate?.name || 'DAMAC Waterfront Luxury';
    const templateCategory = selectedTemplate?.category || 'Ultra Luxury Real Estate';
    const templateBadge = selectedTemplate?.badge || 'EXCLUSIVE LAUNCH';

    // 2. Extract Reference Blueprint using Gemini (same system as app/api/chat/route.ts)
    let styleDescription = "";
    if (refTemplateUrl && refTemplateUrl.startsWith('http')) {
        try {
            console.log(`[Demo AI Creative] Deconstructing template blueprint from: ${refTemplateUrl}`);
            const refRes = await fetch(refTemplateUrl);
            if (refRes.ok) {
                const refBuffer = Buffer.from(await refRes.arrayBuffer());
                const refMime = refRes.headers.get('content-type') || 'image/jpeg';
                const styleAnalysis = await generateText({
                    model: google('gemini-3.5-flash'),
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: `You are a Master Creative Director & Visual System Architect. Analyze this reference luxury real estate ad and deconstruct it into a universal "Graphic Design System Blueprint":
1. Layout structure & container framing holding the property photo (e.g. geometric mask, floating card, split container, arch, or full-bleed).
2. Color palette & ambient lighting mood (champagne gold, dark luxury, cyan glass, minimal ivory).
3. Typography hierarchy (headline position, starting price pill, badge styling, CTA placement).
4. Badges & trust stamps placement.
Output a dense single paragraph describing this exact graphic design framework so an AI image model can apply this layout framework to a new property.`
                                },
                                {
                                    type: 'image',
                                    image: refBuffer,
                                    mimeType: refMime
                                } as any
                            ]
                        }
                    ]
                });
                styleDescription = styleAnalysis.text.trim();
                console.log(`[Demo AI Creative] Extracted blueprint: ${styleDescription.slice(0, 100)}...`);
            }
        } catch (e: any) {
            console.warn('[Demo AI Creative] Style extraction warning:', e.message);
        }
    }

    // 3. Collect valid image URLs to feed into Kie (IMAGE 1: user photo, IMAGE 2: reference template)
    const inputUrls: string[] = [];
    if (projectImageUrl && projectImageUrl.startsWith('http')) {
        inputUrls.push(projectImageUrl);
    }
    if (refTemplateUrl && refTemplateUrl.startsWith('http') && !inputUrls.includes(refTemplateUrl)) {
        inputUrls.push(refTemplateUrl);
    }
    if (logoUrl && logoUrl.startsWith('http') && !inputUrls.includes(logoUrl)) {
        inputUrls.push(logoUrl);
    }

    const masterPrompt = `Create an ultra-premium, agency-level ad creative design in 3:4 portrait ratio for Instagram/Meta ad campaigns using the Graphic Design Blueprint below.

=== EXTRACTED GRAPHIC DESIGN BLUEPRINT (APPLY THIS STYLE FRAMEWORK TO THE USER'S PROPERTY) ===
${styleDescription || `Style: ${templateName} (${templateCategory}). Signature layout with prominent starting price ribbon (${projectPrice}), modern typography, and urgent CTA ribbon.`}

CRITICAL DIRECTIVES:
- IMAGE 1 is the user's actual property photo: Place this property photo as the central visual hero of the canvas inside the reference container framing geometry.
- IMAGE 2 is the reference creative design blueprint: Faithfully reproduce the exact container framing, layout geometry, typography style, color scheme, and badge placement of IMAGE 2 for the property in IMAGE 1.
- Subject: ${projectTitle}
- Developer / Company: ${companyName}
- Starting Price: ${projectPrice}
- Location: ${location}
- Highlights & Amenities: ${projectDescription}
- Badge: ${templateBadge}
- Contact / CTA: ${contactNumber}
- Typography: Luxury champagne gold and ivory tones, clean Trajan/Bodoni serif headings, modern geometric sans-serif subtext, perfectly aligned without any messy or gibberish text.
- Do NOT copy any barcodes, QR codes, or random phone numbers from IMAGE 2.`;

    const isImg2Img = inputUrls.length > 0;
    const model = isImg2Img ? 'gpt-image-2-5-flare-image-to-image' : 'gpt-image-2-text-to-image';
    const payload: any = {
        model,
        input: {
            prompt: masterPrompt,
            aspect_ratio: '3:4',
            resolution: '1K',
            ...(isImg2Img ? { input_urls: inputUrls.slice(0, 3) } : {})
        }
    };

    try {
        console.log(`[Demo AI Creative] Creating Kie task (${model}) for "${projectTitle}" with template "${templateName}"...`);
        const { taskId, error: createErr } = await createKieTask(payload);
        if (createErr || !taskId) {
            console.warn('[Demo AI Creative] Task creation error:', createErr);
            return null;
        }

        console.log(`[Demo AI Creative] Task created: ${taskId}. Polling for completion (up to 85s)...`);
        const startTime = Date.now();
        while (Date.now() - startTime < 85000) {
            await new Promise(r => setTimeout(r, 2500));
            const statusRes = await queryKieTask(taskId);

            if (statusRes.state === 'success' && statusRes.resultUrl) {
                console.log(`[Demo AI Creative] Kie task succeeded! Result URL: ${statusRes.resultUrl}`);
                const imgBuf = await fetchImageBuffer(statusRes.resultUrl);
                if (imgBuf) {
                    const r2Key = `demo-creatives/ai_creative_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
                    await r2.send(new PutObjectCommand({
                        Bucket: R2_BUCKET,
                        Key: r2Key,
                        Body: imgBuf,
                        ContentType: 'image/png'
                    }));
                    const permanentUrl = `${R2_PUBLIC_URL}/${r2Key}`;
                    console.log(`[Demo AI Creative] Saved to R2: ${permanentUrl}`);
                    return permanentUrl;
                }
                return statusRes.resultUrl;
            }

            if (statusRes.state === 'fail') {
                console.warn(`[Demo AI Creative] Kie task ${taskId} failed:`, statusRes.error);
                return null;
            }
        }
        return null;
    } catch (e: any) {
        console.warn('[Demo AI Creative] Exception:', e.message);
        return null;
    }
}

/**
 * Delivers a real-time synthesized 30-second cinematic real estate reel with dynamic multilingual voiceover & motion.
 * Uses createGeminiTTS with authentic Indian cadence and createGrokVideoTask from @/utils/external-apis.
 */
async function generateRealtime30sVideo(input: CreativeInput, imageBuffer?: Buffer | null): Promise<GeneratedVideo | null> {
    const {
        projectTitle = 'The Grand Crest Luxury Residences',
        companyName = 'Apex Luxury Living',
        location = 'Golf Course Extension, Prime Metro Corridor',
        projectPrice = 'Starting ₹1.85 Cr',
        projectDescription = 'Exclusive luxury villas with sky terraces and infinity pool',
        projectImageUrl,
        videoLanguage = 'hinglish'
    } = input;

    console.log(`[Realtime 30s Video] Synthesizing custom 30s reel (${videoLanguage}) for "${projectTitle}" (${location}, ${projectPrice})...`);

    const fallbackVideo: GeneratedVideo = {
        id: `reel-${Date.now()}`,
        title: `${projectTitle} - 30s Voiceover Reel`,
        videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/demo_15s_voiceover_reel_1793007112340.mp4',
        aspectRatio: '9:16',
        duration: 30,
        scriptText: `${companyName} lekar aaye hain ${projectTitle} at ${location}. Special launch price starting at ${projectPrice}. Book your VIP preview today!`,
        scriptCues: [
            { start: 0, end: 5, text: `${companyName} lekar aaye hain apna sabse prestigious project: ${projectTitle}.` },
            { start: 5, end: 10, text: `${location} ki prime location par bespoke architecture aur luxury lifestyle.` },
            { start: 10, end: 15, text: `Yahan aapko milte hain ultra luxury residences with private infinity pool.` },
            { start: 15, end: 20, text: `Inaugural launch price shuru ho rahi hai sirf ${projectPrice} se!` },
            { start: 20, end: 25, text: `High capital appreciation aur 0% brokerage ka limited launch privilege.` },
            { start: 25, end: 30, text: `Limited inventory available — Aaj hi apna private VIP walkthrough schedule karein!` }
        ]
    };

    try {
        const logDebug = (msg: string) => {
            try {
                fs.appendFileSync(path.join(process.cwd(), 'video_debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
            } catch { }
        };
        logDebug(`Start video generation for "${projectTitle}"`);
        const { size, type, perk } = parseSpecs(projectDescription, projectTitle);
        const cleanPrice = projectPrice.replace(/\s*\([^)]*\)/g, '').trim();

        // 1. Dynamic Script in requested language
        let scriptText = '';
        let scriptCues: CaptionCue[] = [];
        const langLower = (videoLanguage || 'hinglish').toLowerCase();

        try {
            console.log(`[Realtime 30s Video] Synthesizing dynamic AI script in ${videoLanguage} for "${projectTitle}"...`);
            const langInstruction = langLower.includes('hinglish')
                ? 'Conversational Indian Hinglish (natural blend of Romanized Hindi and English used in luxury Indian real estate video ads, e.g. "lekar aaye hain ultra luxury residences", "prime corridor mein", "aaj hi apna private tour book karein")'
                : langLower.includes('hindi')
                    ? 'Fluent authentic Hindi in Devanagari script'
                    : langLower.includes('punjabi')
                        ? 'Persuasive Punjabi in Gurmukhi script'
                        : 'Sophisticated luxury real estate English';

            const scriptGenPromise = generateText({
                model: google('gemini-2.5-flash'),
                system: 'You are an elite luxury real estate video director. Write a crisp, high-converting 30-second video voiceover script (~65 to 75 words). It MUST strictly follow the requested language. Do NOT include speaker labels, asterisks, brackets, or stage directions. Output ONLY the raw spoken words.',
                prompt: `Write a 30-second luxury property voiceover script:
Company: ${companyName}
Project: ${projectTitle}
Location: ${location}
Starting Price: ${cleanPrice}
Unit Specs: ${size} ${type}
Key Privilege: ${perk}
Description: ${projectDescription}
Language: ${langInstruction}

Keep it between 65 and 75 words so it reads at a natural 30-second cadence. Hook in the first 3 seconds, highlight luxury features and price, and end with an urgent CTA to book a private VIP preview visit.`
            });

            const scriptGenTimeout = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('AI script generation timed out')), 15000)
            );

            const aiScriptRes = await Promise.race([scriptGenPromise, scriptGenTimeout]) as any;
            if (aiScriptRes && aiScriptRes.text) {
                const cleanedScript = aiScriptRes.text.replace(/[*#_\[\]()]/g, '').trim();
                if (cleanedScript.length > 50) {
                    scriptText = cleanedScript;
                    console.log(`[Realtime 30s Video] Dynamic AI script created: "${scriptText.slice(0, 80)}..."`);
                }
            }
        } catch (scriptErr: any) {
            console.warn(`[Realtime 30s Video] Dynamic script generation fallback to template: ${scriptErr.message}`);
        }

        if (!scriptText) {
            if (langLower.includes('hinglish')) {
                scriptText = `${companyName} lekar aaye hain apna sabse premium project, ${projectTitle}, ${location} ki prime location par. Yahan aapko milte hain ultra luxury ${size} ${type}, bespoke architecture aur world-class ${perk}. Special launch offer shuru ho rahi hai sirf ${cleanPrice} se. Aisi prime luxury property aur high returns ka mauka baar-baar nahi milta. Limited units bache hain. Aaj hi apna private VIP preview book karein!`;
            } else if (langLower.includes('hindi')) {
                scriptText = `${companyName} प्रस्तुत करते हैं अपना सबसे भव्य प्रोजेक्ट, ${projectTitle}, ${location} की प्राइम लोकेशन में। यहाँ आपको मिलते हैं आलीशान ${size} ${type}, आधुनिक डिज़ाइन और ${perk} जैसी बेहतरीन सुविधाएं। कीमतें शुरू होती हैं मात्र ${cleanPrice} से। अपने सपनों का आशियाना आज ही सुरक्षित करें। सीमित इन्वेंटरी उपलब्ध है। अपना वीआईपी साइट विज़िट बुक करने के लिए आज ही संपर्क करें।`;
            } else if (langLower.includes('punjabi')) {
                scriptText = `${companyName} ਲੈ ਕੇ ਆਏ ਨੇ ਆਪਣਾ ਸਭ ਤੋਂ ਸ਼ਾਨਦਾਰ ਪ੍ਰੋਜੈਕਟ ${projectTitle}, ${location} ਦੀ ਪ੍ਰਾਈਮ ਲੋਕੇਸ਼ਨ 'ਤੇ। ਇੱਥੇ ਤੁਹਾਨੂੰ ਮਿਲਣਗੇ ਲਗਜ਼ਰੀ ${size} ${type}, ਬਿਹਤਰੀਨ ਡਿਜ਼ਾਈਨ ਅਤੇ ${perk}। ਕੀਮਤ ਸ਼ੁਰੂ ਹੁੰਦੀ ਹੈ ਸਿਰਫ ${cleanPrice} ਤੋਂ। ਅੱਜ ਹੀ ਸੰਪਰਕ ਕਰੋ ਅਤੇ ਆਪਣਾ ਵੀਆਈਪੀ ਪ੍ਰਿਵਿਊ ਬੁੱਕ ਕਰੋ ਜੀ।`;
            } else {
                scriptText = `Welcome to ${projectTitle} by ${companyName}, prestigiously positioned at ${location}. Offering magnificent ${size} ${type} crafted with bespoke architecture and ${perk}. Special launch pricing starts at just ${cleanPrice}. Elevate your lifestyle with world-class amenities and exceptional connectivity. Contact us today to reserve your private VIP walkthrough preview.`;
            }
        }

        // Subtitle cues
        const sentences = scriptText.match(/[^.!?]+[.!?]+/g) || [scriptText];
        const cueDuration = 30 / Math.max(1, Math.min(6, sentences.length));
        scriptCues = sentences.slice(0, 6).map((sent, idx) => ({
            start: Math.round(idx * cueDuration * 10) / 10,
            end: Math.round((idx + 1) * cueDuration * 10) / 10,
            text: sent.trim()
        }));
        if (scriptCues.length < 4) {
            const words = scriptText.split(/\s+/);
            const chunkSize = Math.ceil(words.length / 6);
            scriptCues = [];
            for (let i = 0; i < 6; i++) {
                const chunk = words.slice(i * chunkSize, (i + 1) * chunkSize).join(' ');
                if (chunk) {
                    scriptCues.push({
                        start: Math.round(i * 5 * 10) / 10,
                        end: Math.round((i + 1) * 5 * 10) / 10,
                        text: chunk
                    });
                }
            }
        }

        // 2. Synthesize Authentic Indian Accent Voiceover via Kie.ai Gemini TTS (Authentic Indian Cadence)
        let audioBuffer: Buffer | null = null;
        const isHinglishOrHindi = !videoLanguage || langLower.includes('hinglish') || langLower.includes('hindi');
        const isPunjabi = langLower.includes('punjabi');
        const ttsScene = isHinglishOrHindi
            ? "A confident, polished Indian voiceover artist speaking fluent Indian English and natural conversational Hindi and Hinglish in a professional recording studio. Warm, clear, enthusiastic, natural Indian vocal cadence, authentic Indian pronunciation, and convincing tone for a high-converting commercial."
            : isPunjabi
                ? "A confident, polished North Indian voiceover artist speaking fluent authentic Punjabi and conversational Hinglish in a professional recording studio. Warm, clear, enthusiastic, authentic Indian pronunciation."
                : "A confident, polished Indian voiceover artist speaking fluent Indian English in a professional recording studio. Warm, clear, enthusiastic, natural Indian vocal cadence, and convincing tone for a high-converting commercial.";

        try {
            console.log(`[Realtime 30s Video] Synthesizing authentic Indian voiceover via Kie.ai Gemini TTS (${videoLanguage})...`);
            const { taskId: ttsTaskId, error: ttsCreateErr } = await createGeminiTTS({
                dialogueText: scriptText,
                speakerName: "Aoede",
                scene: ttsScene,
                sampleContext: "High converting luxury marketing video commercial with natural Indian English delivery"
            });

            if (ttsTaskId) {
                for (let p = 0; p < 12; p++) {
                    await new Promise(r => setTimeout(r, 1500));
                    const ttsStatus = await queryKieTask(ttsTaskId);
                    if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                        const audRes = await fetch(ttsStatus.resultUrl);
                        if (audRes.ok) {
                            audioBuffer = Buffer.from(await audRes.arrayBuffer());
                            console.log(`[Realtime 30s Video] Kie Indian TTS succeeded! (${audioBuffer.length} bytes)`);
                            break;
                        }
                    }
                    if (ttsStatus.state === 'fail') {
                        console.warn('[Realtime 30s Video] Kie TTS task failed:', ttsStatus.error);
                        break;
                    }
                }
            } else if (ttsCreateErr) {
                console.warn('[Realtime 30s Video] Kie TTS create error:', ttsCreateErr);
            }
        } catch (e: any) {
            console.warn('[Realtime 30s Video] Kie TTS warning:', e.message);
        }

        // Secondary fallback to direct Google Gemini TTS if Kie TTS was unavailable
        if (!audioBuffer) {
            console.log(`[Realtime 30s Video] Secondary fallback to direct Gemini TTS...`);
            const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            if (geminiKey) {
                try {
                    const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent?key=${geminiKey}`;
                    const ttsRes = await fetch(ttsUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: scriptText }] }],
                            generationConfig: {
                                responseModalities: ['AUDIO'],
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: { voiceName: 'Aoede' }
                                    }
                                }
                            }
                        })
                    });
                    if (ttsRes.ok) {
                        const ttsData = await ttsRes.json();
                        const b64 = ttsData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                        if (b64) {
                            audioBuffer = Buffer.from(b64, 'base64');
                            console.log(`[Realtime 30s Video] Direct Gemini TTS succeeded! (${audioBuffer.length} bytes)`);
                        }
                    }
                } catch (directTtsErr: any) {
                    console.warn('[Realtime 30s Video] Direct Gemini TTS error:', directTtsErr.message);
                }
            }
        }


        // 3. Resolve Hero Image for Grok Video (Pass ONLY the user's property image, NO Unsplash photos!)
        const selectedTemplate = input.templateId ? getReferenceTemplate(input.templateId) : null;
        let heroImgUrl = (projectImageUrl && projectImageUrl.startsWith('http'))
            ? projectImageUrl
            : (selectedTemplate?.url && selectedTemplate.url.startsWith('http') ? selectedTemplate.url : LUXURY_FALLBACK_IMAGES[0]);

        // Format hero image to clean 9:16 portrait JPEG on R2 for Kie.ai compatibility
        try {
            console.log(`[Realtime 30s Video] Formatting hero image to 9:16 JPEG via ensureJpegImage: ${heroImgUrl}`);
            heroImgUrl = await ensureJpegImage(heroImgUrl, 'demo-user', '9:16');
        } catch (convErr: any) {
            console.warn('[Realtime 30s Video] JPEG conversion warning:', convErr.message);
        }

        // 4. Launch Dual Concurrent Grok Imagine Video 1.5 Tasks (100% Pure AI Video Motion, NO Still Images!)
        // Task 1: Exterior drone push on user's property photo + AI-generated luxury double-height living salon stock B-roll
        // Task 2: AI-generated rooftop infinity pool sunset + twilight master suite terrace stock B-roll
        console.log(`[Realtime 30s Video] Launching dual Grok AI video tasks via Kie.ai for seamless 30s cinematic commercial...`);
        let grokVideoBuffer1: Buffer | null = null;
        let grokVideoBuffer2: Buffer | null = null;

        const multiScenePrompt1 = `A dynamic, photorealistic luxury architectural commercial video reel for ${projectTitle} by ${companyName} in ${location}.
The video flows smoothly across photorealistic architectural scenes:
- Scene 1: Opens with an aerial cinema drone camera pushing forward toward the iconic property exterior and entrance from Image 1 in warm natural daylight. Only animate the real architecture visible in Image 1.
- Scene 2: Cuts smoothly to a photorealistic generic luxury stock interior B-roll of an expansive double-height sunlit living salon with Italian marble, warm sunbeams, and floor-to-ceiling glass windows.
Shot on 35mm anamorphic cinema lens, natural daylight, photorealistic architectural film, 4K commercial quality. Absolutely NO still photos, NO text overlays, NO titles, NO watermarks, NO cartoons, NO CGI artifacts, silent video.`;

        const multiScenePrompt2 = `A photorealistic luxury architectural stock B-roll commercial video for high-end real estate.
The video flows across photorealistic amenity scenes:
- Scene 1: A smooth, elegant cinema camera glide over a private rooftop heated infinity pool with crystal-clear azure water and shimmering reflections at sunset against a luxury skyline.
- Scene 2: Cut smoothly to a warm twilight view of an opulent master bedroom suite with private sky terrace overlooking ambient city lights.
Shot on 35mm anamorphic cinema lens, natural sunset lighting, photorealistic 4K architectural film. Absolutely NO still photos, NO text overlays, NO titles, NO watermarks, silent video.`;

        try {
            const task1Promise = createGrokVideoTask({
                prompt: multiScenePrompt1,
                imageUrls: [heroImgUrl],
                aspectRatio: "9:16",
                duration: 15,
                resolution: "480p"
            });

            const task2Promise = createGrokVideoTask({
                prompt: multiScenePrompt2,
                aspectRatio: "9:16",
                duration: 15,
                resolution: "480p"
            });

            const [task1Res, task2Res] = await Promise.all([task1Promise, task2Promise]);
            const task1Id = task1Res.taskId;
            const task2Id = task2Res.taskId;

            console.log(`[Realtime 30s Video] Launched Grok Tasks: Clip1=${task1Id}, Clip2=${task2Id}. Polling up to 85s for completion...`);

            const startVideoPoll = Date.now();
            while (Date.now() - startVideoPoll < 85000) {
                await new Promise(r => setTimeout(r, 2500));

                if (task1Id && !grokVideoBuffer1) {
                    const status1 = await queryKieTask(task1Id);
                    if (status1.state === 'success' && status1.resultUrl) {
                        console.log(`[Realtime 30s Video] Grok Clip 1 ready! URL: ${status1.resultUrl}`);
                        const res1 = await fetch(status1.resultUrl);
                        if (res1.ok) grokVideoBuffer1 = Buffer.from(await res1.arrayBuffer());
                    }
                }

                if (task2Id && !grokVideoBuffer2) {
                    const status2 = await queryKieTask(task2Id);
                    if (status2.state === 'success' && status2.resultUrl) {
                        console.log(`[Realtime 30s Video] Grok Clip 2 ready! URL: ${status2.resultUrl}`);
                        const res2 = await fetch(status2.resultUrl);
                        if (res2.ok) grokVideoBuffer2 = Buffer.from(await res2.arrayBuffer());
                    }
                }

                // If both clips are ready, break immediately!
                if (grokVideoBuffer1 && grokVideoBuffer2) {
                    console.log(`[Realtime 30s Video] Both Grok AI clips successfully generated!`);
                    break;
                }

                // If clip 1 is ready and 75 seconds have elapsed, proceed with clip 1 to ensure prompt completion
                if (grokVideoBuffer1 && (Date.now() - startVideoPoll > 75000)) {
                    console.log(`[Realtime 30s Video] Clip 1 ready, proceeding to assemble AI video reel...`);
                    break;
                }
            }
        } catch (e: any) {
            console.warn('[Realtime 30s Video] Grok dual video error:', e.message);
        }

        // 5. FFmpeg Assembly: 100% PURE AI VIDEO FOOTAGE (ZERO Still Images!)
        const tmpDir = os.tmpdir();
        const randId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const tmpAudPath = path.join(tmpDir, `aud_${randId}.wav`);
        const tmpOutMp4 = path.join(tmpDir, `reel_${randId}.mp4`);
        const resolvedFfmpegPath = typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.default || 'ffmpeg';

        if (audioBuffer) {
            fs.writeFileSync(tmpAudPath, audioBuffer);
        }

        if (grokVideoBuffer1 && grokVideoBuffer2 && audioBuffer) {
            console.log(`[Realtime 30s Video] Stitching 100% AI Commercial: Grok Clip 1 (Exterior + Living Salon) + Grok Clip 2 (Pool + Master Suite) with Indian Voiceover...`);
            const tmpGrok1 = path.join(tmpDir, `grok1_${randId}.mp4`);
            const tmpGrok2 = path.join(tmpDir, `grok2_${randId}.mp4`);
            fs.writeFileSync(tmpGrok1, grokVideoBuffer1);
            fs.writeFileSync(tmpGrok2, grokVideoBuffer2);

            await new Promise<void>((resolve, reject) => {
                const filterComplex = [
                    "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=25[v0]",
                    "[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=25[v1]",
                    "[v0][v1]concat=n=2:v=1:a=0[outv]"
                ].join(';');

                const args = [
                    '-y',
                    '-nostats',
                    '-loglevel', 'error',
                    '-i', tmpGrok1,
                    '-i', tmpGrok2,
                    '-i', tmpAudPath,
                    '-filter_complex', filterComplex,
                    '-map', '[outv]',
                    '-map', '2:a:0',
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-pix_fmt', 'yuv420p',
                    '-crf', '22',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-shortest',
                    '-movflags', '+faststart',
                    tmpOutMp4
                ];

                execFile(resolvedFfmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err) => {
                    try { fs.unlinkSync(tmpGrok1); } catch { }
                    try { fs.unlinkSync(tmpGrok2); } catch { }
                    if (err) return reject(err);
                    resolve();
                });
            });

        } else if (grokVideoBuffer1 && audioBuffer) {
            console.log(`[Realtime 30s Video] Stitching 100% AI Commercial from Grok Clip 1 (Exterior + AI Living Salon) with Indian Voiceover...`);
            const tmpGrok1 = path.join(tmpDir, `grok1_${randId}.mp4`);
            fs.writeFileSync(tmpGrok1, grokVideoBuffer1);

            await new Promise<void>((resolve, reject) => {
                // Seamless cinematic 30s extension: play clip 1, then smooth reverse return = continuous 30s pure AI motion!
                const filterComplex = [
                    "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=25[v0]",
                    "[v0]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[outv]"
                ].join(';');

                const args = [
                    '-y',
                    '-nostats',
                    '-loglevel', 'error',
                    '-i', tmpGrok1,
                    '-i', tmpAudPath,
                    '-filter_complex', filterComplex,
                    '-map', '[outv]',
                    '-map', '1:a:0',
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-pix_fmt', 'yuv420p',
                    '-crf', '22',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-shortest',
                    '-movflags', '+faststart',
                    tmpOutMp4
                ];

                execFile(resolvedFfmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err) => {
                    try { fs.unlinkSync(tmpGrok1); } catch { }
                    if (err) return reject(err);
                    resolve();
                });
            });

        } else {
            console.log('[Realtime 30s Video] Grok video failover: returning premium R2 video asset...');
            if (!audioBuffer) {
                return { ...fallbackVideo, scriptText, scriptCues };
            }
            return {
                id: `reel-${randId}`,
                title: `${projectTitle} - 30s Voiceover Reel`,
                videoUrl: fallbackVideo.videoUrl,
                aspectRatio: '9:16',
                duration: 30,
                scriptText,
                scriptCues
            };
        }

        // 6. Upload rendered MP4 to Cloudflare R2
        try { fs.appendFileSync(path.join(process.cwd(), 'video_debug.log'), `FFmpeg finished successfully! File exists: ${fs.existsSync(tmpOutMp4)}\n`); } catch { }
        const mp4Bytes = fs.readFileSync(tmpOutMp4);
        const r2Key = `demo-creatives/reel_${randId}.mp4`;
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: mp4Bytes,
            ContentType: 'video/mp4'
        }));

        const publicVideoUrl = `${R2_PUBLIC_URL}/${r2Key}`;
        try { fs.appendFileSync(path.join(process.cwd(), 'video_debug.log'), `Uploaded to R2: ${publicVideoUrl}\n`); } catch { }
        console.log(`[Realtime 30s Video] 30s Video uploaded successfully to R2: ${publicVideoUrl} (${(mp4Bytes.length / (1024 * 1024)).toFixed(2)} MB)`);

        try { fs.unlinkSync(tmpAudPath); } catch { }
        try { fs.unlinkSync(tmpOutMp4); } catch { }

        return {
            id: `reel-${randId}`,
            title: `${projectTitle} - 30s Voiceover Reel`,
            videoUrl: publicVideoUrl,
            aspectRatio: '9:16',
            duration: 30,
            scriptText,
            scriptCues
        };

    } catch (e: any) {
        try { fs.appendFileSync(path.join(process.cwd(), 'video_debug.log'), `CATCH EXCEPTION: ${e.message}\nStack: ${e.stack}\n`); } catch { }
        console.error('[Realtime 30s Video] Render pipeline error, returning fallback:', e.message);
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
 * Generates true AI ad creative (via Kie.ai GPT Image 2.5) according to selected reference template + 30s real-time video reel.
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
        companyName = 'Apex Luxury Living',
        projectTitle = 'The Grand Crest Luxury Residences',
        projectDescription = 'Exclusive 4BHK Sky Mansions with private infinity pool and panoramic views.',
        projectPrice = 'Starting ₹1.85 Cr',
        location = 'Golf Course Extension, Prime Metro Corridor',
        logoUrl,
        projectImageUrl,
        contactNumber = '+91 98886 26786'
    } = input;

    const selectedTemplate = input.templateId ? getReferenceTemplate(input.templateId) : null;

    // 1. Generate high-converting Ad Copy via Gemini
    let copyResult = {
        headline: `Limited Inventory: ${projectTitle}`,
        primaryText: `Experience redefined luxury living in ${location}. ${projectDescription}. Book your private preview today.`,
        callToAction: 'Book VIP Site Visit'
    };

    try {
        const aiResponse = await generateObject({
            model: google('gemini-3.8-flash'),
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

    // 2. Resolve background image for video and fallback composite
    let bgBuffer1: Buffer | null = null;
    if (projectImageUrl) {
        bgBuffer1 = await fetchImageBuffer(projectImageUrl);
    }
    if (!bgBuffer1 && selectedTemplate?.fallbackImage) {
        bgBuffer1 = await fetchImageBuffer(selectedTemplate.fallbackImage);
    }
    if (!bgBuffer1) {
        bgBuffer1 = await fetchImageBuffer(LUXURY_FALLBACK_IMAGES[0]);
    }

    // 3. Launch Video Reel synthesis concurrently
    const videoPromise = generateRealtime30sVideo(input, bgBuffer1);

    // 4. Launch True AI Creative generation via Kie.ai in parallel
    console.log(`[Creative Engine] Triggering true AI creative generation via Kie.ai...`);
    const aiCreativePromise = generateRealtimeAiCreative(input, selectedTemplate);

    let creativeUrl: string | null = null;
    try {
        creativeUrl = await aiCreativePromise;
        if (creativeUrl) {
            console.log(`[Creative Engine] Successfully obtained AI-generated creative: ${creativeUrl}`);
        }
    } catch (aiErr: any) {
        console.warn(`[Creative Engine] AI creative generation error: ${aiErr.message}`);
    }

    // If Kie AI creative did not return or timed out, create a luxury high-res composite fallback
    if (!creativeUrl) {
        console.log('[Creative Engine] AI creative fallback: Generating high-converting luxury composite...');
        const width = 1200;
        const height = 1600;

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
        const cleanPriceVal = escapeXml(projectPrice.replace(/\s*\([^)]*\)/g, '').trim());
        const priceClean = cleanPriceVal.endsWith('*') ? cleanPriceVal : `${cleanPriceVal}*`;
        const locationClean = escapeXml(location.toUpperCase());
        const phoneClean = escapeXml(contactNumber || '+91 98886 26786');
        const { size, type, perk } = parseSpecs(projectDescription, projectTitle);
        const templateBadge = escapeXml(selectedTemplate?.badge || 'EXCLUSIVE LAUNCH');

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

        const svgOverlay = Buffer.from(`
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="topVignette" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#020617" stop-opacity="0.90" />
                        <stop offset="60%" stop-color="#020617" stop-opacity="0.40" />
                        <stop offset="100%" stop-color="#020617" stop-opacity="0.0" />
                    </linearGradient>
                    <linearGradient id="bottomVignette" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#020617" stop-opacity="0.0" />
                        <stop offset="20%" stop-color="#020617" stop-opacity="0.75" />
                        <stop offset="60%" stop-color="#020617" stop-opacity="0.96" />
                        <stop offset="100%" stop-color="#020617" stop-opacity="0.99" />
                    </linearGradient>
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
                        <stop offset="0%" stop-color="#050B18" stop-opacity="0.65" />
                        <stop offset="100%" stop-color="#020617" stop-opacity="0.88" />
                    </linearGradient>
                    <linearGradient id="specBoxBg" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#1E293B" stop-opacity="0.55" />
                        <stop offset="100%" stop-color="#0F172A" stop-opacity="0.75" />
                    </linearGradient>
                    <filter id="shadowLg" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.85"/>
                    </filter>
                    <filter id="shadowSm" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.6"/>
                    </filter>
                </defs>
                <rect width="${width}" height="300" fill="url(#topVignette)" />
                <rect y="640" width="${width}" height="960" fill="url(#bottomVignette)" />
                <g transform="translate(48, 48)">
                    <rect width="${companyPillWidth}" height="64" rx="32" fill="#030712" fill-opacity="0.80" stroke="url(#goldBorder)" stroke-width="1.2" />
                    ${logoBase64 ? `
                        <image href="${logoBase64}" x="14" y="14" width="36" height="36" preserveAspectRatio="xMidYMid meet" />
                    ` : `
                        <circle cx="32" cy="32" r="18" fill="#F59E0B" fill-opacity="0.2" />
                        <g transform="translate(22, 22)"><path d="M2 16L0 3L7 9L10 0L13 9L20 3L18 16H2Z" fill="#FDE68A" /></g>
                    `}
                    <text x="64" y="31" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="${companyFontSize}" font-weight="900" letter-spacing="1.5">${companyClean}</text>
                    <text x="64" y="47" fill="#F59E0B" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="800" letter-spacing="2">OFFICIAL DEVELOPER</text>
                </g>
                <g transform="translate(860, 48)">
                    <rect width="292" height="64" rx="32" fill="#030712" fill-opacity="0.80" stroke="url(#goldBorder)" stroke-width="1.2" />
                    <circle cx="28" cy="32" r="6" fill="#F59E0B" />
                    <text x="44" y="38" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="900" letter-spacing="2">${templateBadge}</text>
                </g>
                <g transform="translate(48, 800)" filter="url(#shadowLg)">
                    <rect width="1104" height="750" rx="36" fill="url(#cardBg)" stroke="url(#goldBorder)" stroke-width="1.8" />
                    <g transform="translate(48, 44)">
                        <g transform="translate(0, 0)">
                            <rect width="450" height="42" rx="21" fill="#F59E0B" fill-opacity="0.16" stroke="#F59E0B" stroke-width="1.4" />
                            <text x="24" y="27" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" letter-spacing="1.5">📍 ${locationClean.slice(0, 34)}</text>
                        </g>
                        <g transform="translate(0, 92)">
                            ${line2 ? `
                                <text x="0" y="0" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="52" font-weight="900">${escapeXml(line1)}</text>
                                <text x="0" y="58" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="52" font-weight="900">${escapeXml(line2)}</text>
                            ` : `
                                <text x="0" y="20" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="56" font-weight="900">${escapeXml(line1)}</text>
                            `}
                        </g>
                        <g transform="translate(0, ${line2 ? 185 : 150})">
                            <text x="0" y="0" fill="#F59E0B" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" letter-spacing="2">STARTING INVESTMENT • INAUGURAL PRICE</text>
                            <text x="0" y="64" fill="url(#goldText)" font-family="'Segoe UI', Roboto, sans-serif" font-size="64" font-weight="900" filter="url(#shadowSm)">${priceClean}</text>
                        </g>
                        <g transform="translate(0, ${line2 ? 295 : 260})">
                            <g transform="translate(0, 0)">
                                <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="#334155" stroke-width="1.2" />
                                <text x="24" y="34" fill="#94A3B8" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800">📐 ESTATE AREA</text>
                                <text x="24" y="68" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="900">${size}</text>
                            </g>
                            <g transform="translate(344, 0)">
                                <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="#334155" stroke-width="1.2" />
                                <text x="24" y="34" fill="#94A3B8" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="800">🏡 RESIDENCE TYPE</text>
                                <text x="24" y="68" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900">${type}</text>
                            </g>
                            <g transform="translate(688, 0)">
                                <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="url(#goldBorder)" stroke-width="1.2" />
                                <text x="24" y="34" fill="#FDE68A" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="900">💎 KEY PRIVILEGE</text>
                                <text x="24" y="68" fill="url(#goldText)" font-family="'Segoe UI', Roboto, sans-serif" font-size="21" font-weight="900">${perk}</text>
                            </g>
                        </g>
                        <g transform="translate(0, ${line2 ? 435 : 400})">
                            <g transform="translate(0, 0)">
                                <rect width="520" height="76" rx="38" fill="#020617" fill-opacity="0.85" stroke="#334155" stroke-width="1.4" />
                                <text x="40" y="33" fill="#94A3B8" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800">CALL OR WHATSAPP DIRECT</text>
                                <text x="40" y="58" fill="#FFFFFF" font-family="'Segoe UI', Roboto, sans-serif" font-size="23" font-weight="900">${phoneClean}</text>
                            </g>
                            <g transform="translate(544, 0)">
                                <rect width="464" height="76" rx="38" fill="url(#goldButton)" stroke="#FDE68A" stroke-width="1.6" />
                                <text x="232" y="47" fill="#0F172A" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" text-anchor="middle">SCHEDULE VIP SITE VISIT ➔</text>
                            </g>
                        </g>
                    </g>
                </g>
            </svg>
        `);

        try {
            const imgBuffer = await sharp(bgBuffer1!)
                .resize(width, height, { fit: 'cover', position: 'center' })
                .composite([{ input: svgOverlay, top: 0, left: 0 }])
                .jpeg({ quality: 92, progressive: true })
                .toBuffer();

            const fallbackKey = `demo-creatives/fallback_clean_${Date.now()}.jpg`;
            await r2.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: fallbackKey,
                Body: imgBuffer,
                ContentType: 'image/jpeg'
            }));
            creativeUrl = `${R2_PUBLIC_URL}/${fallbackKey}`;
        } catch (compositeErr: any) {
            console.warn('[Creative Engine] Fallback composite warning:', compositeErr.message);
            creativeUrl = selectedTemplate?.fallbackImage || LUXURY_FALLBACK_IMAGES[0];
        }
    }

    // Await the real-time video generation
    const videoResult = await videoPromise;

    return {
        creatives: [
            {
                id: `creative-${Date.now()}`,
                name: selectedTemplate?.name ? `AI Creative • ${selectedTemplate.name}` : 'AI Generated Luxury Ad Creative',
                styleName: selectedTemplate?.category || 'Minimalist Commercial (3:4)',
                aspectRatio: '3:4',
                imageUrl: creativeUrl || LUXURY_FALLBACK_IMAGES[0],
                headline: copyResult.headline,
                primaryText: copyResult.primaryText,
                ctaText: copyResult.callToAction
            }
        ],
        video: videoResult,
        adCopy: copyResult
    };
}
