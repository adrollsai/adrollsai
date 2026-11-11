import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VIDEO_ANALYSIS_MODEL, VIDEO_ANALYSIS_FALLBACK_MODEL } from '@/lib/agent/models';

/**
 * Video understanding via Gemini.
 *
 * DeepSeek (the agent's own model) cannot accept video, so video work is
 * delegated: the agent calls a tool, this module uploads the file to Gemini's
 * Files API and asks `gemini-3.8-flash` about it, falling back to
 * `gemini-2.5-flash` if that model is unavailable.
 */

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const UPLOAD_TIMEOUT_MS = 180_000;

export interface VideoAnalysisResult {
  analysis: string;
  model: string;
  /** True when the file was uploaded rather than passed as a URL. */
  uploaded: boolean;
  /** Token counts, when the provider reported them — used for billing. */
  usage?: { input: number; output: number } | null;
}

function getApiKey(): string {
  const raw = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
  return raw.replace(/^["']|["']$/g, '').trim();
}

function mimeTypeFor(url: string): string {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'video/mp4';
  }
}

function isYoutube(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

export async function analyzeVideoWithGemini(options: {
  videoUrl: string;
  prompt?: string;
}): Promise<VideoAnalysisResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Gemini API key configured (GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY).');

  const { videoUrl } = options;
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    throw new Error(`A public video URL is required, got: ${videoUrl || '(empty)'}`);
  }

  const instruction =
    options.prompt?.trim() ||
    'Analyse this video in detail for a marketing operator. Cover: what happens visually shot by shot, ' +
      'the setting, people and products, on-screen text, the spoken words (transcribe key lines), ' +
      'pacing and editing style, music or sound, resolution/aspect ratio, and overall quality. ' +
      'Then state whether it is usable as-is and what would need to change to reuse it as an ad creative.';

  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);

  let tempFile = '';
  let uploadedName = '';

  try {
    const mimeType = mimeTypeFor(videoUrl);
    let parts: any[];

    if (isYoutube(videoUrl)) {
      // Gemini ingests YouTube URLs directly — no upload needed.
      parts = [{ fileData: { mimeType, fileUri: videoUrl } }, { text: instruction }];
    } else {
      console.log(`[Video Vision] downloading ${videoUrl.slice(0, 90)}…`);
      // Several CDNs reject requests without a browser UA.
      const res = await fetch(videoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NobogentHarness/1.0)', Accept: 'video/*,*/*' },
      });
      if (!res.ok) throw new Error(`Could not download video (HTTP ${res.status}).`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) throw new Error('Downloaded video is empty.');
      if (buffer.length > MAX_DOWNLOAD_BYTES) {
        throw new Error(
          `Video is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit.`
        );
      }

      tempFile = path.join(os.tmpdir(), `nobo_video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      fs.writeFileSync(tempFile, buffer);

      console.log(`[Video Vision] uploading ${(buffer.length / 1024 / 1024).toFixed(1)} MB to the Gemini Files API…`);
      const uploaded = await fileManager.uploadFile(tempFile, {
        mimeType,
        displayName: path.basename(videoUrl.split('?')[0]) || 'video',
      });
      uploadedName = uploaded.file.name;

      // Videos are processed server-side before they can be used.
      let file = await fileManager.getFile(uploadedName);
      const startedAt = Date.now();
      while (file.state === 'PROCESSING') {
        if (Date.now() - startedAt > UPLOAD_TIMEOUT_MS) {
          throw new Error('Gemini is still processing the video after 3 minutes.');
        }
        await new Promise((r) => setTimeout(r, 1500));
        file = await fileManager.getFile(uploadedName);
      }
      if (file.state === 'FAILED') {
        throw new Error('Gemini failed to process this video (unsupported codec or corrupt file).');
      }

      parts = [{ fileData: { mimeType: file.mimeType || mimeType, fileUri: file.uri } }, { text: instruction }];
    }

    // Token usage is returned so the agent can bill the call. Video analysis is
    // not free and was previously invisible to the meter.
    let lastUsage: { input: number; output: number } | null = null;
    const run = async (modelId: string) => {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent(parts);
      const meta: any = (result.response as any)?.usageMetadata;
      if (meta) {
        lastUsage = {
          input: Number(meta.promptTokenCount || 0),
          output: Number(meta.candidatesTokenCount || 0),
        };
      }
      return result.response.text();
    };

    let analysis = '';
    let usedModel = VIDEO_ANALYSIS_MODEL;
    try {
      analysis = await run(VIDEO_ANALYSIS_MODEL);
    } catch (primaryErr: any) {
      console.warn(
        `[Video Vision] ${VIDEO_ANALYSIS_MODEL} failed (${primaryErr?.message}); retrying with ${VIDEO_ANALYSIS_FALLBACK_MODEL}`
      );
      usedModel = VIDEO_ANALYSIS_FALLBACK_MODEL;
      analysis = await run(VIDEO_ANALYSIS_FALLBACK_MODEL);
    }

    if (!analysis || !analysis.trim()) {
      throw new Error('Gemini returned an empty analysis.');
    }

    console.log(`[Video Vision] analysed with ${usedModel} (${analysis.length} chars).`);

    // Metered here, at the vendor wrapper, so every caller is covered — the agent
    // tool, the dashboard routes and any script. Metering again in the tool would
    // double-charge.
    //
    // `billed` is a widened alias on purpose: `lastUsage` is only assigned inside
    // the `run` closure, so TypeScript's flow analysis narrows it to null here and
    // rejects the property reads.
    const billed = lastUsage as { input: number; output: number } | null;
    try {
      const { recordSpend, priceTokensInr } = await import('@/lib/agent/spend');
      const costInr = priceTokensInr(usedModel, billed || undefined);
      const inTokens = billed?.input || 0;
      const outTokens = billed?.output || 0;
      await recordSpend({
        service: 'gemini',
        model: usedModel,
        units: inTokens + outTokens,
        unit: 'token',
        costInr,
        detail: `video analysis (${videoUrl.slice(0, 70)}): in ${inTokens}, out ${outTokens}`,
      });
    } catch {
      /* never block an analysis on billing */
    }

    return { analysis: analysis.trim(), model: usedModel, uploaded: Boolean(uploadedName), usage: lastUsage };
  } finally {
    try {
      if (uploadedName) await fileManager.deleteFile(uploadedName);
    } catch (err: any) {
      console.warn('[Video Vision] temp file cleanup warning:', err?.message);
    }
    try {
      if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {
      /* best effort */
    }
  }
}
