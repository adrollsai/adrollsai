import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateObject, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
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
    taskId?: string;
    isFinal?: boolean;
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
    ttsTaskId?: string;
    scriptText?: string;
    scriptCues?: CaptionCue[];
    audioUrl?: string;
    captionStyle?: string;
    isAudioFinal?: boolean;
}

export const REFERENCE_TEMPLATES = REFERENCE_TEMPLATES_MAP;

export const LUXURY_FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=80',
    'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1400&q=80'
];

/**
 * Downloads an image buffer from an external URL with timeout and fallback.
 */
export async function fetchImageBuffer(url?: string): Promise<Buffer | null> {
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
        const timeout = setTimeout(() => controller.abort(), 8000);
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
 * Intelligently extracts architectural specifications (Size, Type, Key Privilege) from project text.
 */
export function parseSpecs(description: string, title: string): { size: string; type: string; perk: string } {
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
 * Builds acoustically synchronized caption cues anchored to speech duration.
 * Factors in commas (+0.25s), periods (+0.5s), and price/luxury emphasis keywords.
 */
export function buildAcousticCues(scriptText: string, actualAudioDuration = 22.0): CaptionCue[] {
    const words = scriptText.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const wordsPerCue = 3;
    const totalCues = Math.ceil(words.length / wordsPerCue);

    // Speech strictly ends before 25.0s, leaving room for Outro Card
    const speechDuration = Math.min(24.5, Math.max(14.0, actualAudioDuration));
    const leadSilence = 0.35;
    const activeSpeechTime = Math.max(8.0, speechDuration - leadSilence);

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
    const scriptCues: CaptionCue[] = [];

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

    return scriptCues;
}

/**
 * Fast AI Ad Copy Generation via Gemini (~500ms) with high-converting fallbacks.
 */
export async function generateDemoAdCopy(input: CreativeInput): Promise<{
    headline: string;
    primaryText: string;
    callToAction: string;
}> {
    const {
        companyName = 'Apex Luxury Living',
        projectTitle = 'The Grand Crest Luxury Residences',
        projectDescription = 'Exclusive 4BHK Sky Mansions with private infinity pool and panoramic views.',
        projectPrice = 'Starting ₹1.85 Cr',
        location = 'Golf Course Extension, Prime Metro Corridor'
    } = input;

    let copyResult = {
        headline: `Limited Inventory: ${projectTitle}`,
        primaryText: `Experience redefined luxury living in ${location}. ${projectDescription}. Book your private preview today.`,
        callToAction: 'Book VIP Site Visit'
    };

    try {
        const copyPromise = generateObject({
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

        const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Ad copy timeout')), 1600)
        );

        const aiResponse: any = await Promise.race([copyPromise, timeoutPromise]);
        if (aiResponse?.object) {
            copyResult = aiResponse.object;
        }
    } catch (e: any) {
        console.warn('[Demo Creative Engine] Ad copy fallback:', e.message);
    }

    return copyResult;
}

/**
 * Fast 20s script generation across all Indian languages (~500ms) with high-converting fallbacks.
 */
export async function generateDemoScriptText(input: CreativeInput): Promise<string> {
    const {
        projectTitle = 'The Grand Crest Luxury Residences',
        companyName = 'Apex Luxury Living',
        location = 'Golf Course Extension, Prime Metro Corridor',
        projectPrice = 'Starting ₹1.85 Cr',
        projectDescription = 'Exclusive luxury villas with sky terraces and infinity pool',
        videoLanguage = 'hinglish'
    } = input;

    const { size, type, perk } = parseSpecs(projectDescription, projectTitle);
    const cleanPrice = projectPrice.replace(/\s*\([^)]*\)/g, '').trim();
    const langLower = (videoLanguage || 'hinglish').toLowerCase();

    let langInstruction = 'Conversational Indian Hinglish (natural blend of Romanized Hindi and English)';
    if (langLower.includes('marathi')) langInstruction = 'Fluent, prestigious Marathi in Devanagari script for luxury real estate';
    else if (langLower.includes('gujarati')) langInstruction = 'Persuasive, high-converting Gujarati in Gujarati script for luxury properties';
    else if (langLower.includes('telugu')) langInstruction = 'Prestigious Telugu in Telugu script for high-end luxury real estate';
    else if (langLower.includes('tamil')) langInstruction = 'Eloquent Tamil in Tamil script for luxury residential property';
    else if (langLower.includes('kannada')) langInstruction = 'Regal Kannada in Kannada script for premium luxury homes';
    else if (langLower.includes('bengali')) langInstruction = 'Sophisticated Bengali in Bengali script for luxury living';
    else if (langLower.includes('punjabi')) langInstruction = 'Persuasive Punjabi in Gurmukhi script for luxury residences';
    else if (langLower.includes('hindi') && !langLower.includes('hinglish')) langInstruction = 'Fluent authentic Hindi in Devanagari script for luxury real estate';
    else if (langLower.includes('english')) langInstruction = 'Sophisticated Indian luxury real estate English';

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

        const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('AI script timeout')), 1600)
        );

        const aiRes: any = await Promise.race([scriptPromise, timeoutPromise]);
        if (aiRes && aiRes.text) {
            const cleaned = aiRes.text.replace(/[*#_\[\]()]/g, '').trim();
            if (cleaned.length > 30) {
                return cleaned;
            }
        }
    } catch (e: any) {
        console.warn('[Demo Script] Dynamic generation fallback:', e.message);
    }

    // High-converting multilingual fallbacks
    if (langLower.includes('marathi')) {
        return `${companyName} सादर करत आहेत ${projectTitle}, ${location} येथे. येथे मिळतील आलिशान ${size} ${type} आणि ${perk}. सुरुवातीची किंमत फक्त ${cleanPrice}. मर्यादित युनिट्स उपलब्ध. आजच आपली खाजगी व्हीआयपी साइट भेट निश्चित करा!`;
    } else if (langLower.includes('gujarati')) {
        return `${companyName} લાવ્યા છે ${projectTitle}, ${location} ના પ્રાઇમ લોકેશન પર. અહીં મળશે લક્ઝરી ${size} ${type} અને ${perk}. પ્રારંભિક કિંમત માત્ર ${cleanPrice}. આજે જ તમારો પ્રાઇવેટ વીઆઇપી વોકથ્રુ બુક કરો!`;
    } else if (langLower.includes('telugu')) {
        return `${companyName} గర్వంగా సమర్పిస్తున్న ${projectTitle}, ${location} లో. ఇక్కడ లభిస్తాయి లగ్జరీ ${size} ${type} మరియు ${perk}. ప్రారంభ ధర కేవలం ${cleanPrice}. ఈరోజే మీ ప్రైవేట్ విఐపి సైట్ విజిట్ బుక్ చేసుకోండి!`;
    } else if (langLower.includes('tamil')) {
        return `${companyName} வழங்கும் பிரம்மாண்டமான ${projectTitle}, ${location} லொகேஷனில். இங்கு கிடைக்கிறது ஆடம்பர ${size} ${type} மற்றும் ${perk}. தொடக்க விலை ${cleanPrice}. இன்றே உங்கள் விஐபி தரிசனத்தை பதிவு செய்யுங்கள்!`;
    } else if (langLower.includes('kannada')) {
        return `${companyName} ಪ್ರಸ್ತುತಪಡಿಸುತ್ತಿದೆ ${projectTitle}, ${location} ನಲ್ಲಿ. ದೊರೆಯಲಿದೆ ಐಷಾರಾಮಿ ${size} ${type} ಮತ್ತು ${perk}. ಪ್ರಾರಂಭಿಕ ಬೆಲೆ ಕೇವಲ ${cleanPrice}. ಇಂದೇ ನಿಮ್ಮ ಖಾಸಗಿ ವಿಐಪಿ ವಿಸಿಟ್ ಕಾಯ್ದಿರಿಸಿ!`;
    } else if (langLower.includes('bengali')) {
        return `${companyName} নিয়ে এলো ${projectTitle}, ${location} এর প্রাইম লোকেশনে। এখানে পাবেন বিলাসবহুল ${size} ${type} এবং ${perk}। প্রারম্ভিক মূল্য মাত্র ${cleanPrice}। আজই আপনার প্রাইভেট ভিআইপি সাইট ভিজিট বুক করুন!`;
    } else if (langLower.includes('punjabi')) {
        return `${companyName} ਲੈ ਕੇ ਆਏ ਨੇ ${projectTitle}, ${location} ਦੀ ਪ੍ਰਾਈਮ ਲੋਕੇਸ਼ਨ 'ਤੇ। ਇੱਥੇ ਮਿਲਣਗੇ ਲਗਜ਼ਰੀ ${size} ${type} ਅਤੇ ${perk}। ਕੀਮਤ ਸ਼ੁਰੂ ਹੁੰਦੀ ਹੈ ਸਿਰਫ ${cleanPrice} ਤੋਂ। ਅੱਜ ਹੀ ਆਪਣਾ ਵੀਆਈਪੀ ਪ੍ਰਿਵਿਊ ਬੁੱਕ ਕਰੋ ਜੀ!`;
    } else if (langLower.includes('hindi') && !langLower.includes('hinglish')) {
        return `${companyName} प्रस्तुत करते हैं ${projectTitle}, ${location} की प्राइम लोकेशन में। यहाँ मिलते हैं आलीशान ${size} ${type} और ${perk}। कीमतें शुरू मात्र ${cleanPrice} से। अपना वीआईपी साइट विज़िट आज ही बुक करें।`;
    } else if (langLower.includes('english')) {
        return `Welcome to ${projectTitle} by ${companyName}, located at ${location}. Offering magnificent ${size} ${type} with bespoke architecture and ${perk}. Special launch pricing starts at just ${cleanPrice}. Schedule your private VIP walkthrough today.`;
    }
    return `${companyName} lekar aaye hain ${projectTitle}, ${location} ki prime location par. Yahan aapko milte hain ultra luxury ${size} ${type} aur ${perk}. Starting inaugural price sirf ${cleanPrice}! Limited inventory available. Aaj hi apna private VIP walkthrough schedule karein.`;
}

/**
 * Dispatches Kie AI Image Generation task asynchronously (< 300ms execution).
 * Zero server-side polling, immune to Vercel timeouts.
 */
export async function dispatchRealtimeAiCreative(
    input: CreativeInput,
    selectedTemplate?: ReferenceTemplate | null
): Promise<{ taskId?: string; error?: string }> {
    const {
        companyName = 'Apex Luxury Living',
        projectTitle = 'The Grand Crest Luxury Residences',
        projectDescription = 'Ultra luxury residences with sky terraces, private infinity pool and smart concierge',
        projectPrice = 'Starting ₹1.85 Cr',
        location = 'Golf Course Extension, Prime Metro Corridor',
        projectImageUrl,
        contactNumber = '+91 98886 26786'
    } = input;

    const templateName = selectedTemplate?.name || 'DAMAC Waterfront Luxury';
    const templateCategory = selectedTemplate?.category || 'Ultra Luxury Real Estate';
    const templateBadge = selectedTemplate?.badge || 'EXCLUSIVE LAUNCH';

    const masterPrompt = `Create an ultra-premium, agency-level ad creative design in 3:4 portrait ratio for Instagram/Meta ad campaigns.
Design System Blueprint: ${templateName} (${templateCategory}). Signature layout with prominent starting price ribbon (${projectPrice}), modern typography, and urgent CTA ribbon.

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

    const isCustomUpload = Boolean(
        projectImageUrl &&
        projectImageUrl.startsWith('http') &&
        !projectImageUrl.includes('pinterest_pin') &&
        !projectImageUrl.includes('unsplash.com')
    );

    try {
        if (isCustomUpload) {
            console.log(`[Demo AI Creative] Dispatching img2img task for "${projectTitle}"...`);
            const { taskId, error } = await createKieTask({
                model: 'gpt-image-2-5-flare-image-to-image',
                input: {
                    prompt: masterPrompt,
                    aspect_ratio: '3:4',
                    resolution: '1K',
                    input_urls: [projectImageUrl!]
                }
            });
            if (taskId) return { taskId };
            if (error) console.warn('[Demo AI Creative] Img2img notice, falling back to text-to-image:', error);
        }

        console.log(`[Demo AI Creative] Dispatching fast text-to-image task for "${projectTitle}"...`);
        const { taskId, error } = await createKieTask({
            model: 'gpt-image-2-5-flare-text-to-image',
            input: {
                prompt: masterPrompt,
                aspect_ratio: '3:4',
                resolution: '1K',
                output_format: 'png'
            }
        });

        if (error || !taskId) {
            console.warn('[Demo AI Creative] Kie task dispatch error:', error);
            return { error: error || 'Failed to dispatch task' };
        }
        return { taskId };
    } catch (e: any) {
        console.warn('[Demo AI Creative] Dispatch exception:', e.message);
        return { error: e.message };
    }
}

/**
 * Dispatches Kie TTS voiceover synthesis task asynchronously (< 300ms execution).
 */
export async function dispatchDemoTTS(
    scriptText: string,
    videoLanguage = 'hinglish'
): Promise<{ taskId?: string; error?: string }> {
    const langLower = (videoLanguage || 'hinglish').toLowerCase();
    const isHinglishOrHindi = langLower.includes('hinglish') || langLower.includes('hindi');
    const ttsScene = isHinglishOrHindi
        ? "A confident, polished Indian voiceover artist speaking fluent Indian English and natural conversational Hindi in a professional recording studio."
        : "A confident, polished Indian voiceover artist speaking in a professional recording studio with warm, clear, enthusiastic cadence.";

    try {
        console.log(`[Demo TTS] Dispatching voiceover synthesis (${videoLanguage})...`);
        const { taskId, error } = await createGeminiTTS({
            dialogueText: scriptText,
            speakerName: "Aoede",
            scene: ttsScene,
            sampleContext: "Luxury real estate video ad commercial"
        });
        if (error || !taskId) {
            console.warn('[Demo TTS] Dispatch error:', error);
            return { error: error || 'TTS dispatch failed' };
        }
        return { taskId };
    } catch (e: any) {
        console.warn('[Demo TTS] Exception:', e.message);
        return { error: e.message };
    }
}

/**
 * Dispatches Grok AI 9:16 drone camera motion task asynchronously (< 300ms execution).
 */
export async function dispatchDemoVideoTask(
    input: CreativeInput,
    videoSourceImage?: string
): Promise<{ taskId?: string; error?: string }> {
    const { projectTitle = 'The Grand Crest Luxury Residences' } = input;
    if (!videoSourceImage) return {};

    try {
        console.log(`[Demo Video] Dispatching Grok video task for "${projectTitle}"...`);
        const grokRes = await createGrokVideoTask({
            prompt: `Cinematic ultra-luxury slow camera pan across ${projectTitle}, golden hour warm sunlight, architectural photography, photorealistic 8k, smooth cinematic drone motion`,
            imageUrls: [videoSourceImage],
            aspectRatio: "9:16",
            resolution: "480p",
            duration: 8
        });
        if (grokRes && grokRes.taskId) {
            return { taskId: grokRes.taskId };
        }
        return { error: grokRes?.error || 'Grok dispatch failed' };
    } catch (e: any) {
        console.warn('[Demo Video] Grok dispatch error:', e.message);
        return { error: e.message };
    }
}

/**
 * Non-blocking master coordinator for demo asset generation.
 * Completes in < 1.5 seconds by dispatching all AI tasks in parallel.
 * Zero dependency on Vercel long-running execution!
 */
export async function generateDualDemoCreatives(input: CreativeInput): Promise<{
    creatives: GeneratedCreative[];
    video: GeneratedVideo;
    adCopy: {
        headline: string;
        primaryText: string;
        callToAction: string;
    };
    creativeTaskId?: string;
    ttsTaskId?: string;
    videoTaskId?: string;
    scriptText: string;
}> {
    const selectedTemplate = input.templateId ? getReferenceTemplate(input.templateId) : null;

    // 1. Resolve preview / source image (ALWAYS clean architectural photo, never Pinterest pin or ad banner)
    const cleanUserImage = (input.projectImageUrl && !input.projectImageUrl.includes('pinterest_pin'))
        ? input.projectImageUrl
        : null;
    const previewImageUrl = cleanUserImage || selectedTemplate?.fallbackImage || LUXURY_FALLBACK_IMAGES[0];

    // 2. Parallel AI generation & dispatches (< 1.5s total!)
    const [adCopy, scriptText, creativeDispatch] = await Promise.all([
        generateDemoAdCopy(input),
        generateDemoScriptText(input),
        dispatchRealtimeAiCreative(input, selectedTemplate)
    ]);

    const initialCues = buildAcousticCues(scriptText, 22.0);

    const [ttsDispatch, videoDispatch] = await Promise.all([
        dispatchDemoTTS(scriptText, input.videoLanguage || 'hinglish'),
        dispatchDemoVideoTask(input, previewImageUrl)
    ]);

    const initialCreative: GeneratedCreative = {
        id: `creative-${Date.now()}`,
        name: selectedTemplate?.name ? `AI Creative • ${selectedTemplate.name}` : 'AI Generated Luxury Ad Creative',
        styleName: selectedTemplate?.category || 'Minimalist Commercial (3:4)',
        aspectRatio: '3:4',
        imageUrl: previewImageUrl,
        headline: adCopy.headline,
        primaryText: adCopy.primaryText,
        ctaText: adCopy.callToAction,
        taskId: creativeDispatch.taskId,
        isFinal: false
    };

    const initialVideo: GeneratedVideo = {
        id: `reel-${Date.now()}`,
        title: `${input.projectTitle || 'Luxury Residences'} - 30s Voiceover Reel (${(input.videoLanguage || 'hinglish').toUpperCase()})`,
        videoUrl: '',
        aspectRatio: '9:16',
        duration: 30,
        scriptText,
        scriptCues: initialCues,
        audioUrl: '',
        captionStyle: 'goldenLuxury',
        taskId: videoDispatch.taskId,
        ttsTaskId: ttsDispatch.taskId,
        isAudioFinal: false
    };

    return {
        creatives: [initialCreative],
        video: initialVideo,
        adCopy,
        creativeTaskId: creativeDispatch.taskId,
        ttsTaskId: ttsDispatch.taskId,
        videoTaskId: videoDispatch.taskId,
        scriptText
    };
}
