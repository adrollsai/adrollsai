import { tool } from 'ai';
import { z } from 'zod';
import { meterOf } from '../usage';
import { analyzeVideoWithGemini } from '@/utils/gemini-video-analysis';
import { VIDEO_ANALYSIS_MODEL } from '@/lib/agent/models';

/**
 * Video understanding for the agent.
 *
 * The agent itself runs on `deepseek-flash`, which is multimodal for images but
 * does not accept video. This tool hands the video to Gemini instead. It is the
 * only way the agent should reason about moving pictures — it must not guess
 * what a video contains from its filename.
 */
export function createVideoVisionTools() {
  return {
    analyze_video_with_gemini: tool({
      description:
        `Watch and analyse a video with ${VIDEO_ANALYSIS_MODEL}. Use this whenever the user attaches or references a video ` +
        '(an "[Attached File: name (video)]" with a URL, a YouTube link, or a URL from a previous tool result): ' +
        'pass that exact URL here and you get back a detailed description of what is on screen, the spoken words, ' +
        'pacing, on-screen text, and a verdict on whether it is reusable as an ad creative. ' +
        'Do not attempt to infer a video\'s contents any other way — download-and-ffprobe only tells you technical metadata, not what happens.',
      inputSchema: z.object({
        videoUrl: z
          .string()
          .describe('Publicly reachable video URL (mp4/mov/webm, a YouTube link, or an R2/CDN URL).'),
        prompt: z
          .string()
          .optional()
          .describe(
            'Optional specific question about the video (e.g. "what product is shown and what text appears on screen?"). ' +
              'Leave empty for a full analysis.'
          ),
      }),
      execute: async ({ videoUrl, prompt }) => {
        try {
          const result = await analyzeVideoWithGemini({ videoUrl, prompt });
      try {
        if (result.usage) {
          meterOf()?.addModelUsage('gemini', {
            inputTokens: result.usage.input,
            outputTokens: result.usage.output,
          });
        }
      } catch {}
          return {
            success: true,
            model: result.model,
            videoUrl,
            analysis: result.analysis,
            message: `Analysed the video with ${result.model}.`,
          };
        } catch (err: any) {
          console.error('[analyze_video_with_gemini] failed:', err?.message);
          return {
            success: false,
            videoUrl,
            error:
              err?.message ||
              'Video analysis failed. If the URL is not public, download the file into the sandbox first and publish it, then pass that URL.',
          };
        }
      },
    }),

    analyze_image_with_gemini: tool({
      description:
        'Analyse an image with Gemini when the image is NOT already attached to the conversation. ' +
        'Images attached by the user ("[Attached File: name (image)]") are already visible to you directly — ' +
        'do not call this for those. Use it only for images you generated or found via a URL, ' +
        'e.g. to judge a rendered creative or compare against a reference.',
      inputSchema: z.object({
        imageUrl: z.string().describe('Publicly reachable image URL.'),
        prompt: z.string().optional().describe('What to look for. Leave empty for a general description.'),
      }),
      execute: async ({ imageUrl, prompt }) => {
        try {
          const { analyzeImageWithGemini } = await import('@/utils/image-analysis');
          const analysis = await analyzeImageWithGemini(
            imageUrl,
            prompt || 'Describe this image in detail: subject, composition, colours, text, and quality.'
          );
          return { success: true, imageUrl, analysis };
        } catch (err: any) {
          return { success: false, imageUrl, error: err?.message || 'Image analysis failed.' };
        }
      },
    }),
  };
}
