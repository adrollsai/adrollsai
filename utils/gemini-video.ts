import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { generateContentWithFallback } from "./gemini-fallback";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function transcribeVideoWithGemini(videoUrl: string, fallbackAudioUrl?: string) {
    let localTempPath = '';
    let uploadedFileName = '';
    try {
        const targetUrl = fallbackAudioUrl || videoUrl;
        console.log(`[Gemini Video] Starting transcription for target URL: ${targetUrl}`);

        const response = await fetch(targetUrl);
        const buffer = await response.arrayBuffer();
        
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const isAudio = targetUrl.includes('.mp3') || targetUrl.includes('.wav') || targetUrl.includes('.m4a') || targetUrl.includes('voiceover');
        const ext = isAudio ? 'mp3' : 'mp4';
        const mimeType = isAudio ? 'audio/mp3' : 'video/mp4';

        localTempPath = path.join(os.tmpdir(), `media_${Date.now()}.${ext}`);
        fs.writeFileSync(localTempPath, Buffer.from(buffer));

        // 2. Upload to Gemini
        console.log(`[Gemini Video] Uploading to FileManager (mimeType: ${mimeType})...`);
        const uploadResponse = await fileManager.uploadFile(localTempPath, {
            mimeType: mimeType,
            displayName: "Media for Transcription",
        });
        uploadedFileName = uploadResponse.file.name;

        // 3. Wait for file to be ready
        let file = await fileManager.getFile(uploadedFileName);
        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 1500));
            file = await fileManager.getFile(uploadedFileName);
        }

        if (file.state === "FAILED") {
            // If video failed and we haven't tried fallback audio yet, attempt with fallbackAudioUrl if present
            if (!isAudio && fallbackAudioUrl && fallbackAudioUrl !== videoUrl) {
                console.warn(`[Gemini Video] MP4 video processing failed in Gemini, retrying with fallback audio: ${fallbackAudioUrl}`);
                return await transcribeVideoWithGemini(fallbackAudioUrl);
            }
            throw new Error("Video processing failed in Gemini");
        }

        console.log(`[Gemini Video] File ready (${file.state}). Generating transcript...`);

        const videoTranscriptionSchema = {
            type: "OBJECT",
            properties: {
                segments: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            start: { type: "NUMBER" },
                            end: { type: "NUMBER" },
                            text: { type: "STRING" }
                        },
                        required: ["start", "end", "text"]
                    }
                }
            },
            required: ["segments"]
        };

        // 4. Generate Transcript using Gemini 2.5 Flash with fallback to 3.5 Flash
        const result = await generateContentWithFallback(
            genAI,
            [
                {
                    fileData: {
                        mimeType: file.mimeType,
                        fileUri: file.uri,
                    },
                },
                { text: "Generate a precise transcript of this video/audio. For every segment of speech, provide the start time, end time, and text. Return the result in a clean JSON format matching the schema." },
            ],
            "gemini-3.5-flash",
            "gemini-2.5-flash",
            4,
            2000,
            {
                responseMimeType: "application/json",
                responseSchema: videoTranscriptionSchema
            }
        );

        const transcriptText = result.response.text();
        const data = JSON.parse(transcriptText);

        // Cleanup
        try {
            if (fs.existsSync(localTempPath)) fs.unlinkSync(localTempPath);
            if (uploadedFileName) await fileManager.deleteFile(uploadedFileName);
        } catch (cleanErr) {
            console.warn("[Gemini Video] Cleanup warning:", cleanErr);
        }

        return data;

    } catch (error: any) {
        console.error("[Gemini Video] Transcription Error:", error);
        // Attempt cleanup on failure
        try {
            const fs = require('fs');
            if (localTempPath && fs.existsSync(localTempPath)) fs.unlinkSync(localTempPath);
            if (uploadedFileName) await fileManager.deleteFile(uploadedFileName);
        } catch (e) {}
        throw error;
    }
}
