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
    const model = isImg2Img ? 'gpt-image-2-5-flare-image-to-image' : 'gpt-image-2-5-flare-text-to-image';
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
            await new Promise(r => setTimeout(r, 2000));
            const statusRes = await queryKieTask(taskId);

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
                // Directly return Kie image URL if R2 failed or timed out
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
 * Delivers dynamic script, timed viral captions in the 'goldenLuxury' style (defined for automatic video generation on every 3rd day),
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
            system: 'You are an elite luxury real estate commercial director. Write a punchy, high-converting 30-second video voiceover script (60 to 70 words). Strictly follow the requested language. Do NOT include speaker labels, asterisks, brackets, or stage directions. Output ONLY the raw spoken words.',
            prompt: `Write a 30-second luxury property voiceover script:
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
            if (cleaned.length > 40) {
                scriptText = cleaned;
            }
        }
    } catch (e) {
        console.warn('[Browser Demo Video] Dynamic script generation notice:', e.message);
    }

    // Comprehensive Fallbacks for all popular Indian languages
    if (!scriptText) {
        if (langLower.includes('marathi')) {
            scriptText = `${companyName} सादर करत आहेत ${projectTitle}, ${location} च्या अत्यंत प्राईम लोकेशनवर. येथे मिळतील आलिशान ${size} ${type}, जागतिक दर्जाच्या सोयी आणि ${perk}. सुरुवातीची किंमत फक्त ${cleanPrice} पासून. मर्यादित युनिट्स शिल्लक आहेत. आजच आपली खाजगी व्हीआयपी साइट भेट निश्चित करा!`;
        } else if (langLower.includes('gujarati')) {
            scriptText = `${companyName} લાવ્યા છે ભવ્ય પ્રોજેક્ટ ${projectTitle}, ${location} ના પ્રાઇમ લોકેશન પર. અહીં તમને મળશે લક્ઝરી ${size} ${type}, આધુનિક ડિઝાઇન અને ${perk}. પ્રારંભિક કિંમત માત્ર ${cleanPrice} થી શરૂ. મર્યાદિત ઇન્વેન્ટરી ઉપલબ્ધ છે. આજે જ તમારો પ્રાઇવેટ વીઆઇપી વોકથ્રુ બુક કરો!`;
        } else if (langLower.includes('telugu')) {
            scriptText = `${companyName} గర్వంగా సమర్పిస్తున్న అత్యంత ప్రతిష్టాత్మక ప్రాజెక్ట్ ${projectTitle}, ${location} లో. ఇక్కడ మీకు లభిస్తాయి లగ్జరీ ${size} ${type}, మరియు ${perk}. ప్రారంభ ధర కేవలం ${cleanPrice} మాత్రమే. పరిమిత యూనిట్లు మాత్రమే అందుబాటులో ఉన్నాయి. ఈరోజే మీ ప్రైవేట్ విఐపి సైట్ విజిట్ బుక్ చేసుకోండి!`;
        } else if (langLower.includes('tamil')) {
            scriptText = `${companyName} பெருமையுடன் வழங்கும் பிரம்மாண்டமான ${projectTitle}, ${location} பிரைம் லொகேஷனில். இங்கு உங்களுக்கு கிடைக்கிறது ஆடம்பர ${size} ${type}, மற்றும் ${perk}. தொடக்க விலை வெறும் ${cleanPrice} மட்டுமே. குறிப்பிட்ட வீடுகள் மட்டுமே உள்ளன. இன்றே உங்கள் விஐபி தரிசனத்தை பதிவு செய்யுங்கள்!`;
        } else if (langLower.includes('kannada')) {
            scriptText = `${companyName} ಪ್ರಸ್ತುತಪಡಿಸುತ್ತಿದೆ ಅತ್ಯಂತ ಭವ್ಯವಾದ ${projectTitle}, ${location} ನ ಪ್ರೈಮ್ ಲೊಕೇಶನ್‌ನಲ್ಲಿ. ಇಲ್ಲಿ ನಿಮಗೆ ದೊರೆಯಲಿದೆ ಐಷಾರಾಮಿ ${size} ${type}, ಮತ್ತು ${perk}. ಪ್ರಾರಂಭಿಕ ಬೆಲೆ ಕೇವಲ ${cleanPrice} ಮಾತ್ರ. ಸೀಮಿತ ಮನೆಗಳು ಮಾತ್ರ ಲಭ್ಯ. ಇಂದೇ ನಿಮ್ಮ ಖಾಸಗಿ ವಿಐಪಿ ವಿಸಿಟ್ ಕಾಯ್ದಿರಿಸಿ!`;
        } else if (langLower.includes('bengali')) {
            scriptText = `${companyName} নিয়ে এলো তাদের অন্যতম সেরা প্রকল্প ${projectTitle}, ${location} এর প্রাইম লোকেশনে। এখানে আপনি পাবেন বিলাসবহুল ${size} ${type}, আধুনিক সুযোগ-সুবিধা এবং ${perk}। প্রারম্ভিক মূল্য মাত্র ${cleanPrice} থেকে শুরু। সীমিত ইউনিট বাকি। আজই আপনার প্রাইভেট ভিআইপি সাইট ভিজিট বুক করুন!`;
        } else if (langLower.includes('punjabi')) {
            scriptText = `${companyName} ਲੈ ਕੇ ਆਏ ਨੇ ਆਪਣਾ ਸਭ ਤੋਂ ਸ਼ਾਨਦਾਰ ਪ੍ਰੋਜੈਕਟ ${projectTitle}, ${location} ਦੀ ਪ੍ਰਾਈਮ ਲੋਕੇਸ਼ਨ 'ਤੇ। ਇੱਥੇ ਤੁਹਾਨੂੰ ਮਿਲਣਗੇ ਲਗਜ਼ਰੀ ${size} ${type}, ਬਿਹਤਰੀਨ ਡਿਜ਼ਾਈਨ ਅਤੇ ${perk}। ਕੀਮਤ ਸ਼ੁਰੂ ਹੁੰਦੀ ਹੈ ਸਿਰਫ ${cleanPrice} ਤੋਂ। ਅੱਜ ਹੀ ਸੰਪਰਕ ਕਰੋ ਅਤੇ ਆਪਣਾ ਵੀਆਈਪੀ ਪ੍ਰਿਵਿਊ ਬੁੱਕ ਕਰੋ ਜੀ।`;
        } else if (langLower.includes('hindi') && !langLower.includes('hinglish')) {
            scriptText = `${companyName} प्रस्तुत करते हैं अपना सबसे भव्य प्रोजेक्ट, ${projectTitle}, ${location} की प्राइम लोकेशन में। यहाँ आपको मिलते हैं आलीशान ${size} ${type}, आधुनिक डिज़ाइन और ${perk} जैसी बेहतरीन सुविधाएं। कीमतें शुरू होती हैं मात्र ${cleanPrice} से। सीमित इन्वेंटरी उपलब्ध है। अपना वीआईपी साइट विज़िट आज ही बुक करें।`;
        } else if (langLower.includes('english')) {
            scriptText = `Welcome to ${projectTitle} by ${companyName}, prestigiously positioned at ${location}. Offering magnificent ${size} ${type} crafted with bespoke architecture and ${perk}. Special launch pricing starts at just ${cleanPrice}. Limited inventory available. Schedule your private VIP walkthrough preview today.`;
        } else {
            // Conversational Hinglish
            scriptText = `${companyName} lekar aaye hain apna sabse premium project: ${projectTitle}, ${location} ki prime location par. Yahan aapko milte hain ultra luxury ${size} ${type}, bespoke architecture aur ${perk}. Inaugural launch price shuru ho rahi hai sirf ${cleanPrice} se! High appreciation aur zero brokerage offer. Limited units available — Aaj hi apna private VIP walkthrough schedule karein!`;
        }
    }

    // 2. Generate Rapid Viral Caption Cues in the exact 'goldenLuxury' / AI edit style (Every 3rd Day Automation Style)
    // Short, punchy 3 to 4 words per segment so text is never too long or overwhelming
    let scriptCues: CaptionCue[] = [];
    const words = scriptText.split(/\s+/).filter(Boolean);
    const wordsPerCue = 3; // 3 words at a time for optimal high-retention readability
    const totalCues = Math.ceil(words.length / wordsPerCue);
    const activeDuration = 25.5; // Final 4.5s strictly reserved for the Remotion Outro
    const cueDuration = activeDuration / Math.max(1, totalCues);

    for (let i = 0; i < totalCues; i++) {
        const segWords = words.slice(i * wordsPerCue, (i + 1) * wordsPerCue);
        const segText = segWords.join(' ').trim();
        if (segText) {
            const hasEmphasis = /₹|Cr|Lakh|Price|VIP|Launch|Luxury|Ultra|Private|Exclusive|किंमत|કિંમત|ధర|விலை|ಬೆಲೆ|मूल्य/i.test(segText);
            scriptCues.push({
                start: Math.round(i * cueDuration * 10) / 10,
                end: Math.round((i + 1) * cueDuration * 10) / 10,
                text: segText,
                emphasis: hasEmphasis || i === 0 || i % 4 === 0
            });
        }
    }

    // 3. Synthesize Indian accent voiceover in background via Kie TTS (allowing up to 20s for full audio generation)
    let audioUrl = undefined;
    try {
        const isHinglishOrHindi = langLower.includes('hinglish') || langLower.includes('hindi');
        const ttsScene = isHinglishOrHindi
            ? "A confident, polished Indian voiceover artist speaking fluent Indian English and natural conversational Hindi in a professional recording studio."
            : "A confident, polished Indian voiceover artist speaking in a professional recording studio with warm, clear, enthusiastic cadence.";

        const { taskId: ttsTaskId } = await createGeminiTTS({
            dialogueText: scriptText,
            speakerName: "Aoede",
            scene: ttsScene,
            sampleContext: "Luxury real estate video ad commercial"
        });

        if (ttsTaskId) {
            for (let p = 0; p < 10; p++) {
                await new Promise(r => setTimeout(r, 2000));
                const ttsStatus = await queryKieTask(ttsTaskId);
                if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                    audioUrl = ttsStatus.resultUrl;
                    console.log(`[Browser Demo Video] Synthesized voiceover audio URL: ${audioUrl}`);
                    break;
                }
            }
        }
    } catch (ttsErr: any) {
        console.warn('[Browser Demo Video] Quick voiceover synthesis notice:', ttsErr.message);
    }

    return {
        id: `reel-${Date.now()}`,
        title: `${projectTitle} - 30s Voiceover Reel (${videoLanguage.toUpperCase()})`,
        videoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/demo-creatives/clean_silent_luxury_walkthrough.mp4',
        aspectRatio: '9:16',
        duration: 30,
        scriptText,
        scriptCues,
        audioUrl: audioUrl || 'https://file.aiquickdraw.com/as/6d50c95cee0c07540606a98b15e0d2a3_1793432995729.wav',
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
