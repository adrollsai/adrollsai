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
    emphasis?: boolean;
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
    audioUrl?: string;
    captionStyle?: string;
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
import { transcribeVideoWithGemini } from '@/utils/gemini-video';
import { ensureJpegImage } from '@/utils/image-converter';

export const REFERENCE_TEMPLATES = REFERENCE_TEMPLATES_MAP;

const LUXURY_FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1400&q=80'
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
 * Synthesizes a true AI-generated ad creative using Kie.ai (`gpt-image-2-5-flare-text-to-image` or `gpt-image-2-5-flare-image-to-image`)
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
                    model: google('gemini-2.5-flash'),
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

    // 3. Check if user provided an actual custom uploaded photo (not a reference template pin)
    const isCustomUpload = Boolean(
        projectImageUrl &&
        projectImageUrl.startsWith('http') &&
        !projectImageUrl.includes('pinterest_pin') &&
        !projectImageUrl.includes('unsplash.com')
    );

    const masterPrompt = `Create an ultra-premium, agency-level ad creative design in 3:4 portrait ratio for Instagram/Meta ad campaigns using the Graphic Design Blueprint below.

=== EXTRACTED GRAPHIC DESIGN BLUEPRINT (APPLY THIS STYLE FRAMEWORK TO THE USER'S PROPERTY) ===
${styleDescription || `Style: ${templateName} (${templateCategory}). Signature layout with prominent starting price ribbon (${projectPrice}), modern typography, and urgent CTA ribbon.`}

CRITICAL DIRECTIVES:
- Subject: ${projectTitle}
- Developer / Company: ${companyName}
- Starting Price: ${projectPrice}
- Location: ${location}
- Highlights & Amenities: ${projectDescription}
- Badge: ${templateBadge}
- Contact / CTA: ${contactNumber}
- Typography: Luxury champagne gold and ivory tones, clean Trajan/Bodoni serif headings, modern geometric sans-serif subtext, perfectly aligned without any messy or gibberish text.

CRITICAL BRANDING & URL RESTRICTIONS:
- Developer Name: "${companyName}". STRICTLY and ONLY display this exact company name.
- STRICT PROHIBITION: Do NOT invent, hallucinate, synthesize, or display ANY website URL, domain name, or dot-com address anywhere on the canvas (specifically NEVER display "nobogent.com", or any .com, .in, .ae address). There is NO website URL.
- NEVER display "nobogent.com", "Nobogent", or any third-party agency name on the ad creative.
- Only use the contact number: ${contactNumber}.`;

    // Fast, ultra-reliable path: When generating for demo projects or without a raw uploaded file,
    // text-to-image finishes in 15-18 seconds with pristine typography and ZERO timeout risk!
    const pollForKieTask = async (tId: string, maxWaitMs = 85000): Promise<string | null> => {
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
            await new Promise(r => setTimeout(r, 1500));
            const statusRes = await queryKieTask(tId);

            if (statusRes.state === 'success' && statusRes.resultUrl) {
                console.log(`[Demo AI Creative] Kie task succeeded! Result URL: ${statusRes.resultUrl}`);
                try {
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
                } catch (r2Err: any) {
                    console.warn('[Demo AI Creative] R2 upload error, returning direct Kie URL:', r2Err.message);
                }
                return statusRes.resultUrl;
            }

            if (statusRes.state === 'fail') {
                console.warn(`[Demo AI Creative] Kie task ${tId} failed:`, statusRes.error);
                return null;
            }
        }
        return null;
    };

    // Attempt 1: If user uploaded custom property photo, try img2img with only that 1 image
    if (isCustomUpload) {
        try {
            console.log(`[Demo AI Creative] Attempting img2img with custom user photo for "${projectTitle}"...`);
            const { taskId: imgTaskId } = await createKieTask({
                model: 'gpt-image-2-5-flare-image-to-image',
                input: {
                    prompt: masterPrompt,
                    aspect_ratio: '3:4',
                    resolution: '1K',
                    input_urls: [projectImageUrl]
                }
            });
            if (imgTaskId) {
                const resUrl = await pollForKieTask(imgTaskId, 45000);
                if (resUrl) return resUrl;
            }
        } catch (imgErr: any) {
            console.warn('[Demo AI Creative] Img2img notice, switching to fast text-to-image failover:', imgErr.message);
        }
    }

    // Primary / Failover Model: Fast, agency-quality text-to-image (finishes in 15-18 seconds)
    try {
        console.log(`[Demo AI Creative] Creating fast Kie task (gpt-image-2-5-flare-text-to-image) for "${projectTitle}" with template "${templateName}"...`);
        const { taskId, error: createErr } = await createKieTask({
            model: 'gpt-image-2-5-flare-text-to-image',
            input: {
                prompt: masterPrompt,
                aspect_ratio: '3:4',
                resolution: '1K',
                output_format: 'png'
            }
        });

        if (createErr || !taskId) {
            console.warn('[Demo AI Creative] Task creation error:', createErr);
            return null;
        }

        console.log(`[Demo AI Creative] Task created: ${taskId}. Polling for completion...`);
        return await pollForKieTask(taskId, 85000);
    } catch (e: any) {
        console.warn('[Demo AI Creative] Exception:', e.message);
        return null;
    }
}

/**
 * Delivers dynamic script, timed viral captions in the 'goldenLuxury' style,
 * and audio for live in-browser preview without requiring slow server-side video rendering.
 */
async function generateBrowserDemoVideo(input: CreativeInput): Promise<GeneratedVideo> {
    const {
        projectTitle = 'The Grand Crest Luxury Residences',
        companyName = 'Apex Luxury Living',
        location = 'Golf Course Extension, Prime Metro Corridor',
        projectPrice = 'Starting ₹1.85 Cr',
        projectDescription = 'Exclusive luxury villas with sky terraces and infinity pool',
        videoLanguage = 'hinglish'
    } = input;

    console.log(`[Browser Demo Video] Generating 30s preview metadata (${videoLanguage}) for "${projectTitle}"...`);

    const { size, type, perk } = parseSpecs(projectDescription, projectTitle);
    const cleanPrice = projectPrice.replace(/\s*\([^)]*\)/g, '').trim();
    const langLower = (videoLanguage || 'hinglish').toLowerCase();

    // 1. Language-specific AI prompt & Fallback scripts for all popular Indian languages
    // Optimized for ~45 words so spoken voiceover naturally finishes at ~20-22 seconds, leaving 4s for VIP Outro
    let scriptText = '';
    let langInstruction = 'Conversational Indian Hinglish (natural blend of Romanized Hindi and English)';

    if (langLower.includes('marathi')) {
        langInstruction = 'Fluent, prestigious Marathi in Devanagari script for luxury real estate';
    } else if (langLower.includes('gujarati')) {
        langInstruction = 'Persuasive, high-converting Gujarati in Gujarati script for luxury properties';
    } else if (langLower.includes('telugu')) {
        langInstruction = 'Prestigious Telugu in Telugu script for high-end luxury real estate';
    } else if (langLower.includes('tamil')) {
        langInstruction = 'Eloquent Tamil in Tamil script for luxury residential property';
    } else if (langLower.includes('kannada')) {
        langInstruction = 'Regal Kannada in Kannada script for premium luxury homes';
    } else if (langLower.includes('bengali')) {
        langInstruction = 'Sophisticated Bengali in Bengali script for luxury living';
    } else if (langLower.includes('punjabi')) {
        langInstruction = 'Persuasive Punjabi in Gurmukhi script for luxury residences';
    } else if (langLower.includes('hindi') && !langLower.includes('hinglish')) {
        langInstruction = 'Fluent authentic Hindi in Devanagari script for luxury real estate';
    } else if (langLower.includes('english')) {
        langInstruction = 'Sophisticated Indian luxury real estate English';
    }

    try {
        const scriptPromise = generateText({
            model: google('gemini-2.5-flash'),
            system: 'You are an elite luxury real estate commercial director. Write a punchy, high-converting 20-second video voiceover commercial script (strictly between 42 to 48 words). It must be spoken comfortably within 20 seconds. Strictly follow the requested language. Do NOT include speaker labels, asterisks, brackets, or stage directions. Output ONLY the raw spoken words.',
            prompt: `Write a 20-second luxury property voiceover script:
Company: ${companyName}
Project: ${projectTitle}
Location: ${location}
Starting Price: ${cleanPrice}
Unit Specs: ${size} ${type}
Key Privilege: ${perk}
Description: ${projectDescription}
Language: ${langInstruction}`
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI script generation timed out')), 6000)
        );

        const aiRes: any = await Promise.race([scriptPromise, timeoutPromise]);
        if (aiRes && aiRes.text) {
            const cleaned = aiRes.text.replace(/[*#_\[\]()]/g, '').trim();
            if (cleaned.length > 30) {
                scriptText = cleaned;
            }
        }
    } catch (e: any) {
        console.warn('[Browser Demo Video] Dynamic script generation notice:', e.message);
    }

    // Concise, high-converting fallbacks (approx. 40 words, ~19 seconds spoken)
    if (!scriptText) {
        if (langLower.includes('marathi')) {
            scriptText = `${companyName} सादर करत आहेत ${projectTitle}, ${location} येथे. येथे मिळतील आलिशान ${size} ${type} आणि ${perk}. सुरुवातीची किंमत फक्त ${cleanPrice}. मर्यादित युनिट्स उपलब्ध. आजच आपली खाजगी व्हीआयपी साइट भेट निश्चित करा!`;
        } else if (langLower.includes('gujarati')) {
            scriptText = `${companyName} લાવ્યા છે ${projectTitle}, ${location} ના પ્રાઇમ લોકેશન પર. અહીં મળશે લક્ઝરી ${size} ${type} અને ${perk}. પ્રારંભિક કિંમત માત્ર ${cleanPrice}. આજે જ તમારો પ્રાઇવેટ વીઆઇપી વોકથ્રુ બુક કરો!`;
        } else if (langLower.includes('telugu')) {
            scriptText = `${companyName} గర్వంగా సమర్పిస్తున్న ${projectTitle}, ${location} లో. ఇక్కడ లభిస్తాయి లగ్జరీ ${size} ${type} మరియు ${perk}. ప్రారంభ ధర కేవలం ${cleanPrice}. ఈరోజే మీ ప్రైవేట్ విఐపి సైట్ విజిట్ బుక్ చేసుకోండి!`;
        } else if (langLower.includes('tamil')) {
            scriptText = `${companyName} வழங்கும் பிரம்மாண்டமான ${projectTitle}, ${location} லொகேஷனில். இங்கு கிடைக்கிறது ஆடம்பர ${size} ${type} மற்றும் ${perk}. தொடக்க விலை ${cleanPrice}. இன்றே உங்கள் விஐபி தரிசனத்தை பதிவு செய்யுங்கள்!`;
        } else if (langLower.includes('kannada')) {
            scriptText = `${companyName} ಪ್ರಸ್ತುತಪಡಿಸುತ್ತಿದೆ ${projectTitle}, ${location} ನಲ್ಲಿ. ದೊರೆಯಲಿದೆ ಐಷಾರಾಮಿ ${size} ${type} ಮತ್ತು ${perk}. ಪ್ರಾರಂಭಿಕ ಬೆಲೆ ಕೇವಲ ${cleanPrice}. ಇಂದೇ ನಿಮ್ಮ ಖಾಸಗಿ ವಿಐಪಿ ವಿಸಿಟ್ ಕಾಯ್ದಿರಿಸಿ!`;
        } else if (langLower.includes('bengali')) {
            scriptText = `${companyName} নিয়ে এলো ${projectTitle}, ${location} এর প্রাইম লোকেশনে। এখানে পাবেন বিলাসবহুল ${size} ${type} এবং ${perk}। প্রারম্ভিক মূল্য মাত্র ${cleanPrice}। আজই আপনার প্রাইভেট ভিআইপি সাইট ভিজিট বুক করুন!`;
        } else if (langLower.includes('punjabi')) {
            scriptText = `${companyName} ਲੈ ਕੇ ਆਏ ਨੇ ${projectTitle}, ${location} ਦੀ ਪ੍ਰਾਈਮ ਲੋਕੇਸ਼ਨ 'ਤੇ। ਇੱਥੇ ਮਿਲਣਗੇ ਲਗਜ਼ਰੀ ${size} ${type} ਅਤੇ ${perk}। ਕੀਮਤ ਸ਼ੁਰੂ ਹੁੰਦੀ ਹੈ ਸਿਰਫ ${cleanPrice} ਤੋਂ। ਅੱਜ ਹੀ ਆਪਣਾ ਵੀਆਈਪੀ ਪ੍ਰਿਵਿਊ ਬੁੱਕ ਕਰੋ ਜੀ!`;
        } else if (langLower.includes('hindi') && !langLower.includes('hinglish')) {
            scriptText = `${companyName} प्रस्तुत करते हैं ${projectTitle}, ${location} की प्राइम लोकेशन में। यहाँ मिलते हैं आलीशान ${size} ${type} और ${perk}। कीमतें शुरू मात्र ${cleanPrice} से। अपना वीआईपी साइट विज़िट आज ही बुक करें।`;
        } else if (langLower.includes('english')) {
            scriptText = `Welcome to ${projectTitle} by ${companyName}, located at ${location}. Offering magnificent ${size} ${type} with bespoke architecture and ${perk}. Special launch pricing starts at just ${cleanPrice}. Schedule your private VIP walkthrough today.`;
        } else {
            // Conversational Hinglish
            scriptText = `${companyName} lekar aaye hain ${projectTitle}, ${location} ki prime location par. Yahan aapko milte hain ultra luxury ${size} ${type} aur ${perk}. Starting inaugural price sirf ${cleanPrice}! Limited inventory available. Aaj hi apna private VIP walkthrough schedule karein.`;
        }
    }

    // 2. Synthesize authentic voiceover via Kie TTS (4 to 8 seconds generation)
    let audioUrl = undefined;
    let actualAudioDuration = 22.0;

    try {
        const isHinglishOrHindi = langLower.includes('hinglish') || langLower.includes('hindi');
        const ttsScene = isHinglishOrHindi
            ? "A confident, polished Indian voiceover artist speaking fluent Indian English and natural conversational Hindi in a professional recording studio."
            : "A confident, polished Indian voiceover artist speaking in a professional recording studio with warm, clear, enthusiastic cadence.";

        console.log(`[Browser Demo Video] Requesting voiceover synthesis for "${projectTitle}" (${videoLanguage})...`);
        const { taskId: ttsTaskId } = await createGeminiTTS({
            dialogueText: scriptText,
            speakerName: "Aoede",
            scene: ttsScene,
            sampleContext: "Luxury real estate video ad commercial"
        });

        if (ttsTaskId) {
            for (let p = 0; p < 9; p++) {
                await new Promise(r => setTimeout(r, 1800));
                const ttsStatus = await queryKieTask(ttsTaskId);
                if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                    audioUrl = ttsStatus.resultUrl;
                    console.log(`[Browser Demo Video] Synthesized voiceover audio URL: ${audioUrl}`);

                    // Inspect audio duration from WAV header byte rate
                    try {
                        const headRes = await fetch(audioUrl, { method: 'HEAD' });
                        const cl = headRes.headers.get('content-length');
                        if (cl) {
                            const bytes = parseInt(cl, 10);
                            if (bytes > 44) {
                                // 24000Hz 16-bit mono WAV = 48000 bytes/sec
                                actualAudioDuration = Math.max(8.0, Math.min(25.5, (bytes - 44) / 48000));
                                console.log(`[Browser Demo Video] Probed audio duration: ${actualAudioDuration.toFixed(2)}s`);
                            }
                        }
                    } catch (durErr) {}
                    break;
                }
            }
        }
    } catch (ttsErr: any) {
        console.warn('[Browser Demo Video] Quick voiceover synthesis notice:', ttsErr.message);
    }

    // 3. Generate Acoustically Synchronized Caption Cues anchored to the real voiceover
    let scriptCues: CaptionCue[] = [];

    // Attempt Gemini acoustic transcription if audio was generated
    if (audioUrl) {
        try {
            console.log(`[Browser Demo Video] Running acoustic millisecond alignment on synthesized voiceover...`);
            const transcribePromise = transcribeVideoWithGemini('', audioUrl, videoLanguage);
            const timeoutPromise = new Promise<null>((r) => setTimeout(() => r(null), 8000));
            const transcript = await Promise.race([transcribePromise, timeoutPromise]);

            if (transcript && transcript.segments && transcript.segments.length > 0) {
                scriptCues = transcript.segments.map((seg, i) => ({
                    start: Number(seg.start.toFixed(2)),
                    end: Number(Math.min(25.5, seg.end).toFixed(2)),
                    text: seg.text,
                    emphasis: /₹|Cr|Lakh|Price|VIP|Launch|Luxury|Ultra|Private|Exclusive|किंमत|કિંમત|ధర|விலை|ಬೆಲೆ|मूल्य/i.test(seg.text) || i === 0 || i % 4 === 0
                }));
                console.log(`[Browser Demo Video] Successfully synced ${scriptCues.length} acoustic caption cards with exact voiceover speech!`);
            }
        } catch (transcribeErr: any) {
            console.warn('[Browser Demo Video] Acoustic transcription fallback:', transcribeErr.message);
        }
    }

    // High-precision fallback alignment: distribute word segments across actual speech duration
    if (scriptCues.length === 0) {
        console.log(`[Browser Demo Video] Building duration-aware acoustic cadence across ${actualAudioDuration.toFixed(2)}s...`);
        const words = scriptText.split(/\s+/).filter(Boolean);
        const wordsPerCue = 3;
        const totalCues = Math.ceil(words.length / wordsPerCue);

        // Speech ends strictly before 25.0s, leaving room for Outro Card
        const speechDuration = Math.min(24.5, Math.max(14.0, actualAudioDuration));
        const leadSilence = 0.35;
        const activeSpeechTime = speechDuration - leadSilence;

        // Calculate acoustic weight per cue (words + punctuation pauses)
        const cueWeights: number[] = [];
        for (let i = 0; i < totalCues; i++) {
            const seg = words.slice(i * wordsPerCue, (i + 1) * wordsPerCue).join(' ');
            let weight = seg.length;
            if (/[,;:]/.test(seg)) weight += 6; // +pause for comma
            if (/[.!?]/.test(seg)) weight += 12; // +pause for sentence end
            if (/₹|Cr|Lakh|Price|VIP/i.test(seg)) weight += 6; // spoken slower
            cueWeights.push(weight);
        }

        const totalWeight = cueWeights.reduce((a, b) => a + b, 0) || 1;
        let runningTime = leadSilence;

        for (let i = 0; i < totalCues; i++) {
            const segWords = words.slice(i * wordsPerCue, (i + 1) * wordsPerCue);
            const segText = segWords.join(' ').trim();
            const dur = (cueWeights[i] / totalWeight) * activeSpeechTime;
            const start = Number(runningTime.toFixed(2));
            const end = Number(Math.min(25.5, runningTime + dur).toFixed(2));
            runningTime += dur;

            if (segText) {
                const hasEmphasis = /₹|Cr|Lakh|Price|VIP|Launch|Luxury|Ultra|Private|Exclusive|किंमत|કિંમત|ధర|விலை|ಬೆಲೆ|मूल्य/i.test(segText);
                scriptCues.push({
                    start,
                    end,
                    text: segText,
                    emphasis: hasEmphasis || i === 0 || i % 4 === 0
                });
            }
        }
    }

    return {
        id: `reel-${Date.now()}`,
        title: `${projectTitle} - 30s Voiceover Reel (${videoLanguage.toUpperCase()})`,
        videoUrl: '', // Browser player integrates motion video, property photo, and AI creative seamlessly
        aspectRatio: '9:16',
        duration: 30,
        scriptText,
        scriptCues,
        audioUrl: audioUrl || 'https://file.aiquickdraw.com/as/bedbb619cb2a26d3af5eb9ba2c193a23_1794205484799.wav',
        captionStyle: 'goldenLuxury'
    };
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

    // 2. Resolve clean architectural background image for video and fallback composite
    const cleanUserImage = (projectImageUrl && !projectImageUrl.includes('pinterest_pin')) ? projectImageUrl : null;
    let bgBuffer1: Buffer | null = null;
    if (cleanUserImage) {
        bgBuffer1 = await fetchImageBuffer(cleanUserImage);
    }
    if (!bgBuffer1 && selectedTemplate?.fallbackImage) {
        bgBuffer1 = await fetchImageBuffer(selectedTemplate.fallbackImage);
    }
    if (!bgBuffer1) {
        bgBuffer1 = await fetchImageBuffer(LUXURY_FALLBACK_IMAGES[0]);
    }

    // 3. Launch Video Reel synthesis + Grok AI Video task concurrently using clean property photo
    let grokTaskId: string | undefined = undefined;
    const videoSourceImage = cleanUserImage || selectedTemplate?.fallbackImage || LUXURY_FALLBACK_IMAGES[0];

    if (videoSourceImage) {
        try {
            console.log(`[Demo Video] Triggering Grok AI Video task using: ${videoSourceImage.slice(0, 80)}...`);
            const grokRes = await createGrokVideoTask({
                prompt: `Cinematic ultra-luxury slow camera pan across ${projectTitle}, golden hour warm sunlight, architectural photography, photorealistic 8k, smooth cinematic drone motion`,
                imageUrls: [videoSourceImage],
                aspectRatio: "9:16",
                resolution: "480p",
                duration: 8
            });
            if (grokRes && grokRes.taskId) {
                grokTaskId = grokRes.taskId;
                console.log(`[Demo Video] Grok video task ID: ${grokTaskId}`);
            }
        } catch (grokErr: any) {
            console.warn('[Demo Video] Grok video task launch notice:', grokErr.message);
        }
    }

    const videoPromise = generateBrowserDemoVideo(input);

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
                    <text x="64" y="31" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="${companyFontSize}" font-weight="900" letter-spacing="1.5">${companyClean}</text>
                    <text x="64" y="47" fill="#F59E0B" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="10" font-weight="800" letter-spacing="2">OFFICIAL DEVELOPER</text>
                </g>
                <g transform="translate(860, 48)">
                    <rect width="292" height="64" rx="32" fill="#030712" fill-opacity="0.80" stroke="url(#goldBorder)" stroke-width="1.2" />
                    <circle cx="28" cy="32" r="6" fill="#F59E0B" />
                    <text x="44" y="38" fill="#FDE68A" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="13" font-weight="900" letter-spacing="2">${templateBadge}</text>
                </g>
                <g transform="translate(48, 800)" filter="url(#shadowLg)">
                    <rect width="1104" height="750" rx="36" fill="url(#cardBg)" stroke="url(#goldBorder)" stroke-width="1.8" />
                    <g transform="translate(48, 44)">
                        <g transform="translate(0, 0)">
                            <rect width="450" height="42" rx="21" fill="#F59E0B" fill-opacity="0.16" stroke="#F59E0B" stroke-width="1.4" />
                            <text x="24" y="27" fill="#FDE68A" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="14" font-weight="900" letter-spacing="1.5">📍 ${locationClean.slice(0, 34)}</text>
                        </g>
                        <g transform="translate(0, 92)">
                            ${line2 ? `
                                <text x="0" y="0" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="52" font-weight="900">${escapeXml(line1)}</text>
                                <text x="0" y="58" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="52" font-weight="900">${escapeXml(line2)}</text>
                            ` : `
                                <text x="0" y="20" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="56" font-weight="900">${escapeXml(line1)}</text>
                            `}
                        </g>
                        <g transform="translate(0, ${line2 ? 185 : 150})">
                            <text x="0" y="0" fill="#F59E0B" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="14" font-weight="900" letter-spacing="2">STARTING INVESTMENT • INAUGURAL PRICE</text>
                            <text x="0" y="64" fill="url(#goldText)" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="64" font-weight="900" filter="url(#shadowSm)">${priceClean}</text>
                        </g>
                        <g transform="translate(0, ${line2 ? 295 : 260})">
                            <g transform="translate(0, 0)">
                                <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="#334155" stroke-width="1.2" />
                                <text x="24" y="34" fill="#94A3B8" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="12" font-weight="800">📐 ESTATE AREA</text>
                                <text x="24" y="68" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="24" font-weight="900">${size}</text>
                            </g>
                            <g transform="translate(344, 0)">
                                <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="#334155" stroke-width="1.2" />
                                <text x="24" y="34" fill="#94A3B8" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="12" font-weight="800">🏡 RESIDENCE TYPE</text>
                                <text x="24" y="68" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="22" font-weight="900">${type}</text>
                            </g>
                            <g transform="translate(688, 0)">
                                <rect width="320" height="110" rx="20" fill="url(#specBoxBg)" stroke="url(#goldBorder)" stroke-width="1.2" />
                                <text x="24" y="34" fill="#FDE68A" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="12" font-weight="900">💎 KEY PRIVILEGE</text>
                                <text x="24" y="68" fill="url(#goldText)" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="21" font-weight="900">${perk}</text>
                            </g>
                        </g>
                        <g transform="translate(0, ${line2 ? 435 : 400})">
                            <g transform="translate(0, 0)">
                                <rect width="520" height="76" rx="38" fill="#020617" fill-opacity="0.85" stroke="#334155" stroke-width="1.4" />
                                <text x="40" y="33" fill="#94A3B8" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="11" font-weight="800">CALL OR WHATSAPP DIRECT</text>
                                <text x="40" y="58" fill="#FFFFFF" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="23" font-weight="900">${phoneClean}</text>
                            </g>
                            <g transform="translate(544, 0)">
                                <rect width="464" height="76" rx="38" fill="url(#goldButton)" stroke="#FDE68A" stroke-width="1.6" />
                                <text x="232" y="47" fill="#0F172A" font-family="sans-serif, Arial, Helvetica, DejaVu Sans" font-size="18" font-weight="900" text-anchor="middle">SCHEDULE VIP SITE VISIT ➔</text>
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
    if (grokTaskId) {
        videoResult.taskId = grokTaskId;
    }

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
