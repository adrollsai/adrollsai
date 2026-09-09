import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateContentWithFallback } from "./gemini-fallback";
import { extractJsonFromText } from "./json-parser";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function optimizeCaptionsForRetention(
    segments: { start: number; end: number; text: string }[] = [],
    targetLanguage: string = 'hinglish'
) {
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
        return { captions: [], effects: [] };
    }

    try {
        // Map input segments with unique ID indices so LLM matching is 100% reliable
        const inputSegments = segments.map((seg, idx) => ({
            id: idx,
            start: seg.start,
            end: seg.end,
            text: seg.text
        }));

        const lang = (targetLanguage || 'hinglish').toLowerCase();
        let langFormattingRule = "- Output the captions in UPPERCASE with a few relevant emojis.";
        if (lang === 'hinglish') {
            langFormattingRule = `- Make it UPPERCASE.
           - MANDATORY SCRIPT RULE: Write strictly in HINGLISH using Roman/Latin alphabet (English letters, e.g. "NAGPUR MEIN APNA DREAM HOME 🏡"). ABSOLUTELY DO NOT output any Devanagari script (no देवनागरी). If the input text is in Devanagari Hindi, transliterate it into natural, clean Roman Hinglish characters.
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'english') {
            langFormattingRule = `- Make it UPPERCASE.
           - Write strictly in clear, compelling ENGLISH using standard English letters (e.g. "LOOKING FOR YOUR DREAM HOME IN NAGPUR? 🏡"). If input is in another language, translate it to English.
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'hindi') {
            langFormattingRule = `- Write in natural HINDI using native Devanagari script (हिन्दी, e.g. "नागपुर में परफेक्ट प्रॉपर्टी 🏢").
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'punjabi') {
            langFormattingRule = `- Write in natural PUNJABI using native Gurmukhi script (ਪੰਜਾਬੀ).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'marathi') {
            langFormattingRule = `- Write in natural MARATHI using Devanagari script (मराठी).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'gujarati') {
            langFormattingRule = `- Write in natural GUJARATI using Gujarati script (ગુજરાતી).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'bengali') {
            langFormattingRule = `- Write in natural BENGALI using Bengali script (বাংলা).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'tamil') {
            langFormattingRule = `- Write in natural TAMIL using Tamil script (தமிழ்).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'telugu') {
            langFormattingRule = `- Write in natural TELUGU using Telugu script (తెలుగు).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'kannada') {
            langFormattingRule = `- Write in natural KANNADA using Kannada script (ಕನ್ನಡ).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'malayalam') {
            langFormattingRule = `- Write in natural MALAYALAM using Malayalam script (മലയാളം).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'arabic') {
            langFormattingRule = `- Write in natural ARABIC using Arabic script (العربية).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'spanish') {
            langFormattingRule = `- Write in natural SPANISH (Español).
           - Add a few relevant emojis to key words.`;
        } else if (lang === 'french') {
            langFormattingRule = `- Write in natural FRENCH (Français).
           - Add a few relevant emojis to key words.`;
        } else {
            langFormattingRule = `- Output all captions in ${targetLanguage}.
           - Add a few relevant emojis to key words.`;
        }

        const prompt = `
        You are a world-class short-form video editor specialized in viral captions (Alex Hormozi style) and code-generated motion graphic effects.
        
        INPUT:
        A list of video transcript segments. Each segment has a unique "id", "start", "end", and "text".
        
        TASK:
        1. For each input segment, optimize the text:
           ${langFormattingRule}
        2. Identify which words in each optimized segment should be emphasized (highly styled/highlighted, e.g. key high-impact nouns, verbs, or adjectives).
        3. Map visual effects to key moments in the video:
           - "zoom": a temporary camera zoom (scale up to 1.15) to emphasize a bold point or transition (typically 1.0 - 2.5 seconds duration).
           - "emoji": an emoji popped in the center/corner of the screen (typically 0.8 - 1.5 seconds duration) timed with key nouns/adjectives.
           - "border": a glowing pulsing neon border around the video frame (typically 1.5 - 3.0 seconds duration).
           - "shake": a intense screen-shake effect (typically 0.5 - 1.2 seconds duration) during high intensity words.
        
        DATA:
        ${JSON.stringify(inputSegments)}
        `;

        const responseSchema = {
            type: "OBJECT",
            properties: {
                segments: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "NUMBER" },
                            optimized_text: { type: "STRING" },
                            emphasis_words: {
                                type: "ARRAY",
                                items: { type: "STRING" }
                            }
                        },
                        required: ["id", "optimized_text", "emphasis_words"]
                    }
                },
                effects: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            type: { type: "STRING" },
                            value: { type: "STRING" },
                            start: { type: "NUMBER" },
                            end: { type: "NUMBER" }
                        },
                        required: ["type", "start", "end"]
                    }
                }
            },
            required: ["segments", "effects"]
        };

        const result = await generateContentWithFallback(
            genAI,
            prompt,
            "gemini-3.5-flash",
            null,
            4,
            2000,
            {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        );
        const text = result.response.text();
        const responseData = extractJsonFromText<{ segments?: any[]; effects?: any[] }>(text, { segments: [], effects: [] });

        // Reconstruct the captions array deterministically in Javascript to guarantee perfect audio sync
        const finalCaptions: { text: string; start: number; end: number; emphasis: boolean }[] = [];
        
        const optMap = new Map();
        if (responseData.segments && Array.isArray(responseData.segments)) {
            for (const optSeg of responseData.segments) {
                optMap.set(optSeg.id, optSeg);
            }
        }

        for (let idx = 0; idx < segments.length; idx++) {
            const rawSeg = segments[idx];
            const optSeg = optMap.get(idx);
            
            const textToSplit = optSeg ? optSeg.optimized_text : rawSeg.text.toUpperCase();
            const emphasisWords = optSeg ? optSeg.emphasis_words : [];
            const cleanEmpWords = new Set((emphasisWords || []).map((w: string) => w.toLowerCase().replace(/[^a-zA-Z0-9]/g, '')));
            
            const words = textToSplit.trim().split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;

            const duration = Math.max(0.5, rawSeg.end - rawSeg.start);
            const totalWords = words.length;
            
            // Mathematically group words into 1-2 words per chunk for Hormozi style
            const groupSize = 2;
            const totalGroups = Math.ceil(totalWords / groupSize);
            const groupDuration = duration / totalGroups;

            for (let g = 0; g < totalGroups; g++) {
                const groupWords = words.slice(g * groupSize, (g + 1) * groupSize);
                const isEmphasized = groupWords.some((w: string) => cleanEmpWords.has(w.toLowerCase().replace(/[^a-zA-Z0-9]/g, '')));

                finalCaptions.push({
                    text: groupWords.join(' '),
                    start: Number((rawSeg.start + (g * groupDuration)).toFixed(2)),
                    end: Number((rawSeg.start + ((g + 1) * groupDuration)).toFixed(2)),
                    emphasis: isEmphasized
                });
            }
        }

        return {
            captions: finalCaptions,
            effects: responseData.effects || []
        };

    } catch (error: any) {
        console.error("[Caption Optimizer] Optimization failed, generating baseline captions:", error?.message || error);
        // Fallback: build baseline captions directly from raw segments
        const fallbackCaptions: { text: string; start: number; end: number; emphasis: boolean }[] = [];
        for (const rawSeg of (segments || [])) {
            const words = (rawSeg.text || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;
            const duration = Math.max(0.5, rawSeg.end - rawSeg.start);
            const totalGroups = Math.ceil(words.length / 2);
            const groupDuration = duration / totalGroups;
            for (let g = 0; g < totalGroups; g++) {
                const chunkWords = words.slice(g * 2, (g + 1) * 2);
                fallbackCaptions.push({
                    text: chunkWords.join(' '),
                    start: Number((rawSeg.start + g * groupDuration).toFixed(2)),
                    end: Number((rawSeg.start + (g + 1) * groupDuration).toFixed(2)),
                    emphasis: g % 2 === 0
                });
            }
        }
        return {
            captions: fallbackCaptions,
            effects: []
        };
    }
}
