import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  createGeminiTTS,
  createGrokVideoTask,
  createKieImageTask,
  queryKieTask,
} from '@/utils/external-apis';
import { ensureMp3AudioBuffer } from '@/utils/audio-converter';
import { uploadBufferToR2 } from '../sandbox';
import { meterOf } from '../usage';

/**
 * Media generation tools: the same models the Nobogent app itself uses, exposed
 * to the agent so it can actually produce voiceover, AI video and AI imagery
 * instead of only talking about them.
 *
 * Model IDs come from the app's own integrations and are overridable by env:
 *  - Kie `google/gemini-3-1-flash-tts` â€” Gemini 3.1 Flash TTS (the catalogue has
 *    no 3.8 TTS entry; `KIE_TTS_MODEL` adopts a future one without a code change)
 *  - Kie `grok-imagine-video-1-5-preview` â€” Grok Imagine 1.5, and it accepts
 *    `image_urls` (up to 7), which is what makes image-to-video possible
 *
 * Every finished artifact is mirrored into our own R2 bucket, because Kie's
 * result URLs are short-lived and the user's library must not rot.
 */

/** Gemini TTS voices, with the character each one reads in. */
const GEMINI_TTS_VOICES = [
  'Aoede (breezy, warm â€” best all-round commercial read)',
  'Kore (firm, confident)',
  'Puck (upbeat, energetic)',
  'Charon (informative, deep)',
  'Fenrir (excitable)',
  'Leda (youthful)',
  'Orus (firm, assured)',
  'Zephyr (bright)',
  'Autonoe (bright, airy)',
  'Enceladus (breathy)',
  'Umbriel (easy-going)',
  'Algieba (smooth)',
  'Callirrhoe (easy-going, calm)',
  'Despina (smooth)',
  'Erinome (clear)',
  'Algenib (gravelly)',
  'Rasalgethi (informative)',
  'Laomedeia (upbeat)',
  'Achernar (soft)',
  'Alnilam (firm)',
  'Schedar (even)',
  'Gacrux (mature)',
  'Pulcherrima (forward)',
  'Achird (friendly)',
  'Zubenelgenubi (casual)',
  'Vindemiatrix (gentle)',
  'Sadachbia (lively)',
  'Sadaltager (knowledgeable)',
  'Sulafat (warm)',
  'Iapetus (clear)',
];

const VOICE_NAMES = GEMINI_TTS_VOICES.map((v) => v.split(' ')[0]);

/** Languages the app ships voiceover for, mapped to the TTS read direction. */
const LANGUAGE_PROFILES: Record<string, { scene: string; context: string }> = {
  english: {
    scene:
      'A confident, polished Indian voiceover artist speaking fluent Indian English in a professional recording studio. Warm, clear, enthusiastic, natural Indian vocal cadence, and convincing tone for a high-converting commercial.',
    context: 'High converting luxury marketing video commercial with natural Indian English delivery',
  },
  american_english: {
    scene:
      'A professional commercial voiceover studio with warm, clear, and engaging American tonality. Natural pacing, confident and friendly.',
    context: 'High converting commercial marketing video with neutral American delivery',
  },
  hinglish: {
    scene:
      'A confident, polished Indian voiceover artist speaking natural Hinglish â€” fluent Indian English mixed with conversational Hindi â€” in a professional recording studio. Warm, enthusiastic, high-converting commercial delivery.',
    context: 'Indian social media ad read in Hinglish, natural urban code-switching',
  },
  hindi: {
    scene:
      'A polished Indian voiceover artist speaking clear, natural Hindi in a professional recording studio. Warm, emotive, authentic commercial delivery.',
    context: 'High converting Hindi marketing video commercial',
  },
  punjabi: {
    scene: 'A polished Punjabi voiceover artist speaking natural Punjabi in a professional recording studio. Warm, energetic commercial delivery.',
    context: 'Punjabi marketing video commercial',
  },
  tamil: {
    scene: 'A polished Tamil voiceover artist speaking natural Tamil in a professional recording studio. Warm, confident commercial delivery.',
    context: 'Tamil marketing video commercial',
  },
  telugu: {
    scene: 'A polished Telugu voiceover artist speaking natural Telugu in a professional recording studio. Warm, confident commercial delivery.',
    context: 'Telugu marketing video commercial',
  },
  kannada: {
    scene: 'A polished Kannada voiceover artist speaking natural Kannada in a professional recording studio. Warm, confident commercial delivery.',
    context: 'Kannada marketing video commercial',
  },
  marathi: {
    scene: 'A polished Marathi voiceover artist speaking natural Marathi in a professional recording studio. Warm, confident commercial delivery.',
    context: 'Marathi marketing video commercial',
  },
  bengali: {
    scene: 'A polished Bengali voiceover artist speaking natural Bengali in a professional recording studio. Warm, confident commercial delivery.',
    context: 'Bengali marketing video commercial',
  },
  gujarati: {
    scene: 'A polished Gujarati voiceover artist speaking natural Gujarati in a professional recording studio. Warm, confident commercial delivery.',
    context: 'Gujarati marketing video commercial',
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kie hands back short-lived URLs, so copy the bytes into our own bucket. */
async function mirrorToR2(url: string, fileName: string, userId: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.warn(`[Media Studio] Mirror skipped (${res.status}) for ${url.slice(0, 80)}`);
      return url;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return url;
    return await uploadBufferToR2(buffer, fileName, userId);
  } catch (err: any) {
    console.warn(`[Media Studio] Mirror failed: ${err?.message || err}`);
    return url;
  }
}

function cleanUrls(urls?: string[]): string[] {
  return (urls || [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim()))
    .map((u) => u.trim())
    .slice(0, 7);
}

function kindFromUrl(url: string): 'video' | 'audio' | 'image' {
  const path = url.split('?')[0].toLowerCase();
  if (/\.(mp4|mov|webm|m4v)$/.test(path)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(path)) return 'audio';
  return 'image';
}

export function createMediaStudioTools(supabase: SupabaseClient, userId: string) {
  /** Persist a finished generation into the user's asset library. */
  const saveAsset = async (args: {
    title: string;
    type: 'video' | 'image' | 'audio';
    url: string;
    status?: string;
    taskId?: string;
    metadata?: Record<string, any>;
  }) => {
    try {
      // The live `assets` table has no `title` column (the repo migration is
      // stale) and its status vocabulary is capitalised â€” 'Ready' / 'Draft' /
      // 'Failed'. Writing 'title' fails the whole insert with PGRST204, and a
      // lowercase status makes the asset invisible to the library filters.
      const { data, error } = await supabase
        .from('assets')
        .insert({
          user_id: userId,
          type: args.type,
          url: args.url || null,
          status: args.status || 'Ready',
          kie_task_id: args.taskId || null,
          metadata: { title: args.title, ...(args.metadata || {}) },
        })
        .select('id, url')
        .maybeSingle();

      if (error) {
        console.warn(`[Media Studio] Asset save failed: ${error.message}`);
        return null;
      }
      return data;
    } catch (err: any) {
      console.warn(`[Media Studio] Asset save failed: ${err?.message || err}`);
      return null;
    }
  };

  return {
    generate_voiceover: tool({
      description:
        'Creates a real spoken voiceover / narration audio track from a script using Gemini TTS (the same engine the Nobogent app uses for video ads). Use this whenever the user needs narration, a voiceover, an ad read, a reel script spoken aloud, or audio to lay under a video. Returns a permanent audio URL you can pass to FFmpeg in the sandbox to mux under a video.',
      inputSchema: z.object({
        script: z
          .string()
          .describe(
            'The exact words to speak. Write it as natural spoken copy â€” no speaker labels, stage directions, asterisks or brackets, and no emoji. Numbers and prices should be written the way they should be read out.'
          ),
        voiceName: z
          .string()
          .default('Aoede')
          .describe(
            `Voice character. Available: ${VOICE_NAMES.join(', ')}. Aoede is the warm all-round commercial voice; Puck/Kore/Fenrir are more energetic; Charon/Algenib are deeper.`
          ),
        language: z
          .enum(['english', 'american_english', 'hinglish', 'hindi', 'punjabi', 'tamil', 'telugu', 'kannada', 'marathi', 'bengali', 'gujarati'])
          .default('english')
          .describe('Accent and language of the read. Use hinglish/hindi for Indian mass-market campaigns.'),
        scene: z
          .string()
          .optional()
          .describe('Optional override of the recording-direction prompt. Leave empty to use the tuned default for the chosen language.'),
        title: z.string().optional().describe('Title for the saved audio asset in the user library'),
      }),
      execute: async ({ script, voiceName, language, scene, title }) => {
        const spoken = (script || '').trim();
        if (!spoken) return { success: false, error: 'script is required.' };

        const profile = LANGUAGE_PROFILES[language] || LANGUAGE_PROFILES.english;
        const voice = VOICE_NAMES.includes(voiceName) ? voiceName : 'Aoede';

        try {
          const { taskId, error } = await createGeminiTTS({
            dialogueText: spoken,
            speakerName: voice,
            scene: scene || profile.scene,
            sampleContext: profile.context,
          });
          if (error || !taskId) throw new Error(error || 'TTS task was not created');

          // Poll inline, but never past this turn's budget: if the provider is
          // slow we hand back the task id and let the agent collect it later
          // rather than burning the whole turn waiting.
          let rawUrl: string | null = null;
          let providerError: string | null = null;
          for (let attempt = 0; attempt < 40; attempt++) {
            await sleep(3000);
            const status = await queryKieTask(taskId);
            if (status.state === 'success' && status.resultUrl) {
              rawUrl = status.resultUrl;
              break;
            }
            if (status.state === 'fail') {
              providerError = status.error || 'Voiceover generation failed';
              break;
            }
          }

          if (providerError) throw new Error(providerError);

          if (!rawUrl) {
            await saveAsset({
              title: title || `Voiceover: ${spoken.slice(0, 40)}`,
              type: 'audio',
              url: '',
              status: 'Rendering',
              taskId,
              metadata: { engine: 'gemini_tts', voice, language, script: spoken },
            });
            return {
              success: true,
              status: 'processing_in_background',
              taskId,
              message: `Voiceover task ${taskId} is still generating. Call check_media_task with this taskId to collect the audio URL.`,
            };
          }

          // Normalise to MP3 so it muxes cleanly with FFmpeg.
          let audioUrl = rawUrl;
          try {
            const res = await fetch(rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (res.ok) {
              const mp3 = await ensureMp3AudioBuffer(Buffer.from(await res.arrayBuffer()));
              audioUrl = await uploadBufferToR2(mp3, `voiceover_${Date.now()}.mp3`, userId);
            }
          } catch (convErr: any) {
            console.warn(`[Media Studio] MP3 normalise failed, using raw URL: ${convErr?.message || convErr}`);
          }

          try {
            meterOf()?.addMedia('tts', spoken.length / 1000, `${voice} voice`);
          } catch {}
          const asset = await saveAsset({
            title: title || `Voiceover: ${spoken.slice(0, 40)}`,
            type: 'audio',
            url: audioUrl,
            taskId,
            metadata: { engine: 'gemini_tts', voice, language, script: spoken },
          });

          return {
            success: true,
            status: 'ready',
            audioUrl: asset?.url || audioUrl,
            voice,
            language,
            taskId,
            script: spoken,
            message: `Voiceover generated (${voice}, ${language}). Use this URL with FFmpeg to mux it under a video.`,
            artifact: {
              type: 'audio_player',
              title: title || 'Voiceover',
              audioUrl: asset?.url || audioUrl,
              transcript: spoken,
            },
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Voiceover generation failed' };
        }
      },
    }),

    generate_grok_video: tool({
      description:
        'Generates a real AI video clip with Grok Imagine 1.5. Supports BOTH text-to-video (prompt only) and image-to-video (pass imageUrls to animate real photos, a property, a product, or a generated image). Ideal for cinematic B-roll, drone-style flyovers, product reveals, and social ads. Returns a permanent MP4 URL.',
      inputSchema: z.object({
        prompt: z
          .string()
          .describe(
            'Detailed visual direction: subject, camera move, lighting, mood, style. e.g. "Slow cinematic 35mm push-in on a modern white villa at golden hour, infinity pool reflections, palm trees swaying, photorealistic, warm natural light". Describe motion explicitly.'
          ),
        imageUrls: z
          .array(z.string())
          .optional()
          .describe(
            'Optional 1-7 public HTTPS image URLs. When present this becomes image-to-video: the clip animates those images. Use the user\'s own photos, a generated image, or any hosted asset. Must be publicly reachable.'
          ),
        aspectRatio: z.enum(['9:16', '16:9', '1:1']).default('9:16').describe('9:16 vertical for reels/shorts, 16:9 landscape, 1:1 square'),
        resolution: z.enum(['480p', '720p']).default('720p').describe('720p for deliverables, 480p for quick drafts'),
        durationSeconds: z.number().default(8).describe('Clip length in seconds, 1-15'),
        title: z.string().optional().describe('Title for the saved video asset'),
      }),
      execute: async ({ prompt, imageUrls, aspectRatio, resolution, durationSeconds, title }) => {
        const text = (prompt || '').trim();
        if (!text) return { success: false, error: 'prompt is required.' };

        const images = cleanUrls(imageUrls);
        const mode = images.length > 0 ? 'image_to_video' : 'text_to_video';
        const duration = Math.min(Math.max(Math.round(durationSeconds || 8), 1), 15);

        try {
          const { taskId, error } = await createGrokVideoTask({
            prompt: text,
            imageUrls: images.length ? images : undefined,
            aspectRatio,
            resolution,
            duration,
          });
          if (error || !taskId) throw new Error(error || 'Grok video task was not created');

          // Video takes longer than audio; 5s x 30 = 150s, inside the turn budget.
          let rawUrl: string | null = null;
          let providerError: string | null = null;
          for (let attempt = 0; attempt < 30; attempt++) {
            await sleep(5000);
            const status = await queryKieTask(taskId);
            if (status.state === 'success' && status.resultUrl) {
              rawUrl = status.resultUrl;
              break;
            }
            if (status.state === 'fail') {
              providerError = status.error || 'Grok video generation failed';
              break;
            }
          }

          if (providerError) throw new Error(providerError);

          const baseTitle = title || `Grok ${mode === 'image_to_video' ? 'Image' : 'Text'}-to-Video: ${text.slice(0, 36)}`;

          if (!rawUrl) {
            await saveAsset({
              title: baseTitle,
              type: 'video',
              url: '',
              status: 'Rendering',
              taskId,
              metadata: { engine: 'grok_imagine_1_5', mode, prompt: text, imageUrls: images, duration, aspectRatio, resolution },
            });
            return {
              success: true,
              status: 'processing_in_background',
              taskId,
              mode,
              message: `Grok video task ${taskId} is still rendering. Call check_media_task with this taskId to collect the MP4 URL.`,
            };
          }

          const videoUrl = await mirrorToR2(rawUrl, `grok_${mode}_${Date.now()}.mp4`, userId);
          // Bill the clip: Grok Imagine is by far our most expensive per-call model.
          try { meterOf()?.addMedia(`grok-video:${resolution}`, duration); } catch {}
          const asset = await saveAsset({
            title: baseTitle,
            type: 'video',
            url: videoUrl,
            taskId,
            metadata: { engine: 'grok_imagine_1_5', mode, prompt: text, imageUrls: images, duration, aspectRatio, resolution },
          });

          return {
            success: true,
            status: 'ready',
            mode,
            engine: 'Grok Imagine 1.5',
            videoUrl: asset?.url || videoUrl,
            durationSeconds: duration,
            aspectRatio,
            resolution,
            taskId,
            message: `Grok Imagine 1.5 ${mode.replace(/_/g, '-')} clip generated (${duration}s, ${aspectRatio}, ${resolution}).`,
            artifact: {
              type: 'video_player',
              title: baseTitle,
              videoUrl: asset?.url || videoUrl,
              duration: `${duration}s`,
            },
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Grok video generation failed' };
        }
      },
    }),

    generate_ai_image: tool({
      description:
        'Generates a photorealistic marketing image (or edits/restyles supplied images) using the app\'s image model. Use for ad creatives, banners, product shots, festive graphics, and for producing the still frames that generate_grok_video can then animate.',
      inputSchema: z.object({
        prompt: z.string().describe('High-fidelity image prompt: subject, lighting, composition, lens, style'),
        aspectRatio: z.enum(['9:16', '16:9', '1:1', '3:4']).default('9:16').describe('Output aspect ratio'),
        referenceImageUrls: z
          .array(z.string())
          .optional()
          .describe('Optional public HTTPS image URLs to use as references (image-to-image / edit / restyle)'),
        title: z.string().optional().describe('Title for the saved image asset'),
      }),
      execute: async ({ prompt, aspectRatio, referenceImageUrls, title }) => {
        const text = (prompt || '').trim();
        if (!text) return { success: false, error: 'prompt is required.' };

        try {
          const taskId = await createKieImageTask(
            text,
            'gpt-image-2-5-flare-text-to-image',
            aspectRatio,
            cleanUrls(referenceImageUrls)
          );

          let rawUrl: string | null = null;
          for (let attempt = 0; attempt < 24; attempt++) {
            await sleep(2500);
            const status = await queryKieTask(taskId);
            if (status.state === 'success' && status.resultUrl) {
              rawUrl = status.resultUrl;
              break;
            }
            if (status.state === 'fail') throw new Error(status.error || 'Image generation failed');
          }

          if (!rawUrl) {
            await saveAsset({
              title: title || `AI Image: ${text.slice(0, 40)}`,
              type: 'image',
              url: '',
              status: 'Rendering',
              taskId,
              metadata: { engine: 'kie_image', prompt: text, aspectRatio },
            });
            return {
              success: true,
              status: 'processing_in_background',
              taskId,
              message: `Image task ${taskId} is still generating. Call check_media_task with this taskId.`,
            };
          }

          try { meterOf()?.addMedia('image', 1); } catch {}
          const imageUrl = await mirrorToR2(rawUrl, `ai_image_${Date.now()}.png`, userId);
          const asset = await saveAsset({
            title: title || `AI Image: ${text.slice(0, 40)}`,
            type: 'image',
            url: imageUrl,
            taskId,
            metadata: { engine: 'kie_image', prompt: text, aspectRatio },
          });

          return {
            success: true,
            status: 'ready',
            imageUrl: asset?.url || imageUrl,
            prompt: text,
            taskId,
            artifact: {
              type: 'image_preview',
              title: title || text.slice(0, 50),
              imageUrl: asset?.url || imageUrl,
            },
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Image generation failed' };
        }
      },
    }),

    check_media_task: tool({
      description:
        'Checks a media generation task started by generate_voiceover, generate_grok_video or generate_ai_image that returned status "processing_in_background". Returns the finished media URL once ready and updates the saved asset.',
      inputSchema: z.object({
        taskId: z.string().describe('The taskId returned by an earlier media generation tool'),
      }),
      execute: async ({ taskId }) => {
        try {
          const status = await queryKieTask(taskId);
          if (status.state === 'fail') {
            await supabase.from('assets').update({ status: 'Failed' }).eq('kie_task_id', taskId).eq('user_id', userId);
            return { success: false, state: 'failed', taskId, error: status.error || 'Generation failed' };
          }
          if (status.state !== 'success' || !status.resultUrl) {
            return { success: true, state: 'processing', taskId, message: 'Still generating â€” check again shortly.' };
          }

          const rawUrl = status.resultUrl;
          const kind = kindFromUrl(rawUrl);
          const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
          const permanentUrl = await mirrorToR2(rawUrl, `media_${taskId}.${ext}`, userId);

          const { data: existing } = await supabase
            .from('assets')
            .select('id, type, metadata')
            .eq('kie_task_id', taskId)
            .eq('user_id', userId)
            .maybeSingle();

          if (existing?.id) {
            await supabase.from('assets').update({ url: permanentUrl, status: 'ready' }).eq('id', existing.id);
          } else {
            await saveAsset({
              title: `Generated ${kind}`,
              type: kind,
              url: permanentUrl,
              taskId,
              metadata: { engine: 'kie_task_recovery' },
            });
          }

          const title = (existing as any)?.metadata?.title || `Generated ${kind}`;
          const artifact =
            kind === 'video'
              ? { type: 'video_player', title, videoUrl: permanentUrl }
              : kind === 'audio'
                ? { type: 'audio_player', title, audioUrl: permanentUrl }
                : { type: 'image_preview', title, imageUrl: permanentUrl };

          return {
            success: true,
            state: 'ready',
            taskId,
            mediaType: kind,
            url: permanentUrl,
            artifact,
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not check media task' };
        }
      },
    }),
  };
}
