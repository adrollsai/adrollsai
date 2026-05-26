import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateContentWithFallback } from "./gemini-fallback";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function optimizeCaptionsForRetention(segments: { start: number, end: number, text: string }[]) {
    try {

        const prompt = `
        You are a world-class short-form video editor specialized in viral captions (Alex Hormozi style) and code-generated motion graphic effects.
        
        INPUT:
        A list of video transcript segments with timestamps.
        
        TASK:
        1. Break down the transcript into VERY small caption chunks (1-2 words per chunk maximum) with frame-perfect timing.
        2. Assign "emphasis": true to high-impact words (e.g. "CRAZY", "NEVER", "MONEY", "SECRET").
        3. ALL captions text must be UPPERCASE for maximum impact.
        4. If Hindi is spoken, write it in HINGLISH (English characters/Latin script). Do NOT use Devanagari script.
        5. Map high-impact moment timestamps to pre-defined, code-generated visual motion graphic effects:
           - "zoom": a temporary camera zoom (scale up to 1.15) to emphasize a bold point or transition (typically 1.0 - 2.5 seconds duration).
           - "emoji": an emoji (like 🔥, 🚀, 🤫, 💸, 🏡, 💎) popped in the center/corner of the screen (typically 0.8 - 1.5 seconds duration) timed with key nouns/adjectives.
           - "border": a glowing pulsing neon border around the video frame (typically 1.5 - 3.0 seconds duration) to emphasize a key statement.
           - "shake": a intense screen-shake effect (typically 0.5 - 1.2 seconds duration) during high intensity words.
        
        OUTPUT FORMAT:
        Return a clean JSON object containing both "captions" and "effects" arrays.
        Example output format:
        {
          "captions": [
             { "text": "HELLO", "start": 0.2, "end": 0.9, "emphasis": false },
             { "text": "WORLD 🔥", "start": 0.9, "end": 1.5, "emphasis": true }
          ],
          "effects": [
             { "type": "zoom", "start": 0.9, "end": 2.5 },
             { "type": "emoji", "value": "🔥", "start": 0.9, "end": 1.9 },
             { "type": "border", "start": 3.0, "end": 4.8 }
          ]
        }

        RULES:
        - 1-2 words per caption chunk. NO EXCEPTIONS.
        - Use Hinglish script for Hindi words (e.g. write "MERA" instead of "मेरा").
        - The timing must be CONTINUOUS (no gaps between segments if they are part of the same sentence).
        - NO punctuation at the end of chunks unless it's an emoji.
        - Add a few relevant emojis to important chunks.
        - Make sure effects "start" and "end" timestamps fall strictly within the video boundaries and correspond to speech timings.
        - Return ONLY the JSON object. No markdown, no preambles, no triple backticks. Just the raw JSON.
        
        DATA:
        ${JSON.stringify(segments)}
        `;

        const result = await generateContentWithFallback(
            genAI,
            prompt,
            "gemini-3-flash-preview",
            null
        );
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            throw new Error("Failed to parse optimized captions and effects JSON");
        }

        return JSON.parse(jsonMatch[0]);

    } catch (error: any) {
        console.error("[Caption Optimizer] Error:", error);
        throw error;
    }
}

