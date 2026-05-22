import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import os from "os";

export async function renderVideoWithCaptions({
    videoUrl,
    captions,
    theme,
    onProgress
}: {
    videoUrl: string;
    captions: any[];
    theme: any;
    onProgress?: (progress: number) => void;
}) {
    // 0. Get Video Duration
    const ffmpeg = require('fluent-ffmpeg');
    const getVideoDuration = (url: string): Promise<number> => {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(url, (err: any, metadata: any) => {
                if (err) reject(err);
                resolve(metadata.format.duration);
            });
        });
    };

    const duration = await getVideoDuration(videoUrl);
    const fps = 30;
    const durationInFrames = Math.floor(duration * fps);

    console.log(`[Remotion Render] Detected duration: ${duration}s (${durationInFrames} frames)`);

    // 1. Bundle the composition
    const bundleLocation = await bundle({
        entryPoint: path.resolve("remotion/index.ts"),
        webpackOverride: (config) => config,
    });

    // 2. Get the composition
    const comps = await getCompositions(bundleLocation, {
        inputProps: { videoUrl, captions, theme },
    });
    
    const composition = comps.find((c) => c.id === "CaptionsComposition");
    if (!composition) {
        throw new Error("Composition 'CaptionsComposition' not found");
    }

    // Override duration to match the video
    composition.durationInFrames = durationInFrames;

    const outputLocation = path.join(os.tmpdir(), `render_${Date.now()}.mp4`);

    console.log("[Remotion Render] Starting renderMedia...");

    // 3. Render the media
    await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: "h264",
        outputLocation,
        inputProps: { videoUrl, captions, theme },
        onProgress: ({ progress }) => {
            console.log(`[Remotion Render] Progress: ${Math.round(progress * 100)}%`);
            if (onProgress) onProgress(progress);
        },
    });

    console.log("[Remotion Render] Render finished:", outputLocation);
    
    return outputLocation;
}
