import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { generateContentWithFallback } from "./gemini-fallback";

// Using the correct key that has full Gemini 3 access
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

export async function transcribeVideoWithGemini(videoUrl: string) {
    try {
        console.log(`[Gemini Video] Starting transcription for: ${videoUrl}`);

        const response = await fetch(videoUrl);
        const buffer = await response.arrayBuffer();
        
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const localTempPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`);
        fs.writeFileSync(localTempPath, Buffer.from(buffer));

        // 2. Upload to Gemini
        console.log(`[Gemini Video] Uploading to FileManager...`);
        const uploadResponse = await fileManager.uploadFile(localTempPath, {
            mimeType: "video/mp4",
            displayName: "Video for Transcription",
        });

        // 3. Wait for file to be ready
        let file = await fileManager.getFile(uploadResponse.file.name);
        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            file = await fileManager.getFile(uploadResponse.file.name);
        }

        if (file.state === "FAILED") {
            throw new Error("Video processing failed in Gemini");
        }

        console.log(`[Gemini Video] File ready. Generating transcript...`);

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

        // 4. Generate Transcript using Gemini 3.5 Flash
        const result = await generateContentWithFallback(
            genAI,
            [
                {
                    fileData: {
                        mimeType: file.mimeType,
                        fileUri: file.uri,
                    },
                },
                { text: "Generate a precise transcript of this video. For every segment of speech, provide the start time, end time, and text. Return the result in a clean JSON format matching the schema." },
            ],
            "gemini-3.5-flash",
            null,
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
        fs.unlinkSync(localTempPath);
        await fileManager.deleteFile(file.name);

        return data;

    } catch (error: any) {
        console.error("[Gemini Video] Transcription Error:", error);
        throw error;
    }
}
