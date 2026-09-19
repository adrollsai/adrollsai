import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { generateContentWithFallback } from "./gemini-fallback";
import { extractJsonFromText } from "./json-parser";
import { getFfmpegPath } from "./ffmpeg-helper";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export interface WordItem {
    word: string;
    start: number;
    end: number;
}

export interface TranscriptionSegment {
    id: number;
    start: number;
    end: number;
    text: string;
    words?: WordItem[];
}

export interface TranscriptionResult {
    words: WordItem[];
    segments: TranscriptionSegment[];
}

/**
 * Intelligent acoustic cadence chunker:
 * Groups individual word tokens into 1 to 3 word cards based on real physical acoustic
 * pauses (> 0.22s) and punctuation boundaries. Card start and end timestamps are strictly
 * anchored to the physical waveform start of word 1 and end of the final word.
 */
export function chunkWordsAcoustically(words: WordItem[]): TranscriptionSegment[] {
    const chunks: TranscriptionSegment[] = [];
    if (!words || !Array.isArray(words) || words.length === 0) return chunks;

    let currentGroup: WordItem[] = [];

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w || !w.word || typeof w.start !== 'number' || typeof w.end !== 'number') continue;

        currentGroup.push(w);

        const isLastWord = (i === words.length - 1);
        const nextWord = !isLastWord ? words[i + 1] : null;

        // 1. Natural acoustic pause/silence between current word and next word (silence > 0.22s)
        const hasAcousticPause = nextWord && typeof nextWord.start === 'number' && (nextWord.start - w.end > 0.22);

        // 2. Punctuation boundary in current word (e.g. "?", "!", ".", ",")
        const hasPunctuation = /[.?!,]/.test(w.word);

        // 3. Maximum length threshold: 3 words maximum per card (Alex Hormozi / TikTok reel style)
        const reachedMaxWords = currentGroup.length >= 3;

        // 4. Maximum duration threshold: card shouldn't exceed 2.0s
        const cardDuration = w.end - currentGroup[0].start;
        const reachedMaxDuration = cardDuration >= 2.0;

        if (isLastWord || hasAcousticPause || hasPunctuation || reachedMaxWords || reachedMaxDuration) {
            const cardStart = Number(currentGroup[0].start.toFixed(2));
            const cardEnd = Number(Math.max(cardStart + 0.35, currentGroup[currentGroup.length - 1].end).toFixed(2));
            const cardText = currentGroup.map(item => item.word.replace(/[.?!,]/g, '').trim()).filter(Boolean).join(' ');

            if (cardText.length > 0) {
                chunks.push({
                    id: chunks.length,
                    text: cardText,
                    start: cardStart,
                    end: cardEnd,
                    words: [...currentGroup]
                });
            }

            currentGroup = [];
        }
    }

    if (currentGroup.length > 0) {
        const cardStart = Number(currentGroup[0].start.toFixed(2));
        const cardEnd = Number(Math.max(cardStart + 0.35, currentGroup[currentGroup.length - 1].end).toFixed(2));
        const cardText = currentGroup.map(item => item.word.replace(/[.?!,]/g, '').trim()).filter(Boolean).join(' ');
        if (cardText.length > 0) {
            chunks.push({
                id: chunks.length,
                text: cardText,
                start: cardStart,
                end: cardEnd,
                words: [...currentGroup]
            });
        }
    }

    return chunks;
}

export async function transcribeVideoWithGemini(
    videoUrl: string, 
    fallbackAudioUrl?: string, 
    targetLanguage: string = 'hinglish'
): Promise<TranscriptionResult> {
    let tempDownloadPath = '';
    let audioUploadPath = '';
    let uploadedFileName = '';

    try {
        const targetUrl = fallbackAudioUrl || videoUrl;
        console.log(`[Gemini Audio] Starting transcription (language: ${targetLanguage}, target: ${targetUrl})`);

        // 1. Check if URL points directly to an audio file
        const isDirectAudio = targetUrl.includes('.mp3') || 
                              targetUrl.includes('.wav') || 
                              targetUrl.includes('.m4a') || 
                              targetUrl.includes('.aac') || 
                              targetUrl.includes('.ogg') ||
                              targetUrl.includes('voiceover') ||
                              targetUrl.includes('/tts');

        const response = await fetch(targetUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch media file (${response.status}): ${targetUrl}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());

        if (isDirectAudio) {
            // Target is already an audio file - upload directly
            audioUploadPath = path.join(os.tmpdir(), `gemini_audio_${Date.now()}.mp3`);
            fs.writeFileSync(audioUploadPath, buffer);
            console.log(`[Gemini Audio] Direct audio track detected (${buffer.length} bytes). Processing audio directly.`);
        } else {
            // Target is a video file - extract audio track via FFmpeg to save 8x-10x token costs!
            tempDownloadPath = path.join(os.tmpdir(), `gemini_vid_${Date.now()}.mp4`);
            fs.writeFileSync(tempDownloadPath, buffer);

            audioUploadPath = path.join(os.tmpdir(), `gemini_extracted_${Date.now()}.mp3`);
            console.log(`[Gemini Audio] Extracting audio stream from MP4 video (${buffer.length} bytes) via FFmpeg...`);

            try {
                const ffmpegBin = getFfmpegPath();
                await new Promise<void>((resolve, reject) => {
                    exec(`"${ffmpegBin}" -nostdin -y -i "${tempDownloadPath}" -vn -acodec libmp3lame -b:a 128k -ar 24000 "${audioUploadPath}"`, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                const extractedSize = fs.statSync(audioUploadPath).size;
                console.log(`[Gemini Audio] FFmpeg successfully extracted lightweight MP3 (${extractedSize} bytes).`);
                
                // Clean up video temp immediately to save disk space
                try { if (fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath); tempDownloadPath = ''; } catch (_) {}
            } catch (ffmpegErr: any) {
                console.warn(`[Gemini Audio] FFmpeg audio extraction encountered an issue (${ffmpegErr?.message}), falling back to direct video upload:`, ffmpegErr);
                audioUploadPath = tempDownloadPath;
            }
        }

        // 2. Upload lightweight audio (or video fallback) to Google AI FileManager
        const isMp3 = audioUploadPath.endsWith('.mp3');
        const mimeType = isMp3 ? 'audio/mp3' : 'video/mp4';

        console.log(`[Gemini Audio] Uploading to FileManager (mimeType: ${mimeType}, size: ${fs.statSync(audioUploadPath).size} bytes)...`);
        const uploadResponse = await fileManager.uploadFile(audioUploadPath, {
            mimeType: mimeType,
            displayName: "Audio for Word-Level Transcription",
        });
        uploadedFileName = uploadResponse.file.name;

        // 3. Wait for file to be ready
        let file = await fileManager.getFile(uploadedFileName);
        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 1000));
            file = await fileManager.getFile(uploadedFileName);
        }

        if (file.state === "FAILED") {
            throw new Error("Media file processing failed in Gemini");
        }

        console.log(`[Gemini Audio] File active. Generating word-level transcript using gemini-3.8-flash in ${targetLanguage}...`);

        // Word-level acoustic schema for millisecond alignment
        const wordTranscriptionSchema = {
            type: "OBJECT",
            properties: {
                words: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            word: { type: "STRING" },
                            start: { type: "NUMBER" },
                            end: { type: "NUMBER" }
                        },
                        required: ["word", "start", "end"]
                    }
                }
            },
            required: ["words"]
        };

        const langLower = (targetLanguage || '').toLowerCase();
        let languageSpecificInstruction = "Generate an exact word-by-word transcript of this audio.";
        if (langLower === 'hinglish') {
            languageSpecificInstruction = "Transcribe the audio speech strictly into natural conversational HINGLISH using Roman/Latin alphabet (English letters, e.g. 'Mohali mein apna dream home dekh rahe ho'). MANDATORY SCRIPT RULE: ABSOLUTELY DO NOT use Devanagari script.";
        } else if (langLower === 'english') {
            languageSpecificInstruction = "Transcribe and translate the audio speech into clear, conversational ENGLISH. If any other language is spoken, translate the speech into high-converting English subtitles.";
        } else if (langLower === 'hindi') {
            languageSpecificInstruction = "Transcribe the audio speech into HINDI using native Devanagari script (हिन्दी).";
        } else if (langLower === 'punjabi') {
            languageSpecificInstruction = "Transcribe the audio speech into PUNJABI (ਪੰਜਾਬੀ).";
        } else if (langLower === 'marathi') {
            languageSpecificInstruction = "Transcribe the audio speech into MARATHI (मराठी).";
        } else if (langLower === 'gujarati') {
            languageSpecificInstruction = "Transcribe the audio speech into GUJARATI (ગુજરાતી).";
        } else if (langLower === 'bengali') {
            languageSpecificInstruction = "Transcribe the audio speech into BENGALI (বাংলা).";
        } else if (langLower === 'tamil') {
            languageSpecificInstruction = "Transcribe the audio speech into TAMIL (தமிழ்).";
        } else if (langLower === 'telugu') {
            languageSpecificInstruction = "Transcribe the audio speech into TELUGU (తెలుగు).";
        } else if (langLower === 'kannada') {
            languageSpecificInstruction = "Transcribe the audio speech into KANNADA (ಕನ್ನಡ).";
        } else if (langLower === 'malayalam') {
            languageSpecificInstruction = "Transcribe the audio speech into MALAYALAM (മലയാളം).";
        } else if (langLower === 'arabic') {
            languageSpecificInstruction = "Transcribe the audio speech into ARABIC (العربية).";
        } else if (langLower === 'spanish') {
            languageSpecificInstruction = "Transcribe the audio speech into SPANISH (Español).";
        } else if (langLower === 'french') {
            languageSpecificInstruction = "Transcribe the audio speech into FRENCH (Français).";
        } else if (langLower && langLower !== 'auto') {
            languageSpecificInstruction = `Transcribe or translate the audio speech into ${targetLanguage}.`;
        }

        const promptInstructions = `
${languageSpecificInstruction}

CRITICAL WORD-LEVEL ACOUSTIC SYNCHRONIZATION RULES:
1. Output every single spoken word individually with its exact start and end timestamp in seconds (with up to 3 decimal places, e.g. 0.352).
2. "start" must be the exact millisecond the speaker starts uttering this word. "end" must be the exact millisecond the word ends.
3. If there is silence or a pause between words, do NOT stretch words across silence.
4. Do NOT group words into phrases or sentences in the output schema. Output strictly word by word.
5. Return JSON matching the schema: { "words": [{ "word": string, "start": number, "end": number }] }`;

        // 4. Generate Transcript using Gemini 3.8 Flash (with fallback to 2.5 Flash)
        const result = await generateContentWithFallback(
            genAI,
            [
                {
                    fileData: {
                        mimeType: file.mimeType,
                        fileUri: file.uri,
                    },
                },
                { text: promptInstructions },
            ],
            "gemini-3.8-flash",
            "gemini-2.5-flash",
            4,
            2000,
            {
                responseMimeType: "application/json",
                responseSchema: wordTranscriptionSchema
            }
        );

        const transcriptText = result.response.text();
        const data = extractJsonFromText<{ words?: WordItem[] }>(transcriptText, { words: [] });
        const rawWords: WordItem[] = data.words || [];

        console.log(`[Gemini Audio] Successfully transcribed ${rawWords.length} individual words with exact millisecond timestamps.`);

        // 5. Build acoustic cadence segments (1-3 words) with physical timestamps
        const acousticSegments = chunkWordsAcoustically(rawWords);
        console.log(`[Gemini Audio] Formed ${acousticSegments.length} synchronized acoustic subtitle cards.`);

        // 6. Cleanup temp files and Google AI storage
        try {
            if (audioUploadPath && fs.existsSync(audioUploadPath)) fs.unlinkSync(audioUploadPath);
            if (tempDownloadPath && fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath);
            if (uploadedFileName) await fileManager.deleteFile(uploadedFileName);
        } catch (cleanErr) {
            console.warn("[Gemini Audio] Cleanup warning:", cleanErr);
        }

        return {
            words: rawWords,
            segments: acousticSegments
        };

    } catch (error: any) {
        console.error("[Gemini Audio] Transcription Error:", error);
        // Attempt cleanup on failure
        try {
            if (audioUploadPath && fs.existsSync(audioUploadPath)) fs.unlinkSync(audioUploadPath);
            if (tempDownloadPath && fs.existsSync(tempDownloadPath)) fs.unlinkSync(tempDownloadPath);
            if (uploadedFileName) await fileManager.deleteFile(uploadedFileName);
        } catch (_) {}
        throw error;
    }
}
