import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateContentWithFallback } from "./gemini-fallback";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function optimizeCaptionsForRetention(segments: { start: number, end: number, text: string }[]) {
    try {
        // Map input segments with unique ID indices so LLM matching is 100% reliable
        const inputSegments = segments.map((seg, idx) => ({
            id: idx,
            start: seg.start,
            end: seg.end,
            text: seg.text
        }));

        const prompt = `
        You are a world-class short-form video editor specialized in viral captions (Alex Hormozi style) and code-generated motion graphic effects.
        
        INPUT:
        A list of video transcript segments. Each segment has a unique "id", "start", "end", and "text".
        
        TASK:
        1. For each input segment, optimize the text:
           - Make it UPPERCASE.
           - If Hindi is spoken, write it in HINGLISH (English characters/Latin script). Do NOT use Devanagari script.
           - Add a few relevant emojis to key words.
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
        const responseData = JSON.parse(text);

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
            const cleanEmpWords = new Set(emphasisWords.map((w: string) => w.toLowerCase().replace(/[^a-zA-Z0-9]/g, '')));
            
            const words = textToSplit.trim().split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;

            const duration = rawSeg.end - rawSeg.start;
            const totalWords = words.length;
            
            // Mathematically group words into 1-2 words per chunk for Hormozi style
            const groupSize = 2;
            const totalGroups = Math.ceil(totalWords / groupSize);
            const groupDuration = duration / totalGroups;
            
            for (let i = 0; i < totalGroups; i++) {
                const startIdx = i * groupSize;
                const endIdx = Math.min(startIdx + groupSize, totalWords);
                const groupWords = words.slice(startIdx, endIdx);
                
                const groupStart = rawSeg.start + i * groupDuration;
                const groupEnd = rawSeg.start + (i + 1) * groupDuration;
                
                // Set emphasis true if any word in this group is flagged by LLM
                let hasEmphasis = false;
                for (const w of groupWords) {
                    const cleanW = w.toLowerCase().replace(/[^a-zA-Z0-9]/g, '');
                    if (cleanEmpWords.has(cleanW)) {
                        hasEmphasis = true;
                        break;
                    }
                }
                
                finalCaptions.push({
                    text: groupWords.join(" "),
                    start: parseFloat(groupStart.toFixed(2)),
                    end: parseFloat(groupEnd.toFixed(2)),
                    emphasis: hasEmphasis
                });
            }
        }

        return {
            captions: finalCaptions,
            effects: responseData.effects || []
        };

    } catch (error: any) {
        console.error("[Caption Optimizer] Error:", error);
        throw error;
    }
}

