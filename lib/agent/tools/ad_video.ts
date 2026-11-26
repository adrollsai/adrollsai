import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * MAKE AN AD VIDEO THROUGH THE CREATION TAB'S PIPELINE, NOT AROUND IT.
 *
 * WHY THIS TOOL EXISTS
 * The owner's report, after watching a run: "the agent is not acting as it should, as we discussed earlier that on
 * priority the agent will use the creation tab pipelines for making videos and images".
 *
 * Investigated: there was no agent tool that reached that pipeline at all. `lib/agent/video-plan.ts` returns
 * `lane: 'default'` and describes it as "the creation-tab pipeline", but that is guidance TEXT — the agent held only
 * `generate_ai_image` (one still), `generate_grok_video` (one 15s clip), `composeCreative` and the sandbox film skill.
 * So a "make a video" turn improvised a film in the sandbox with hand-built motion graphics, which is why the output
 * did not look like what the Creation tab produces: no scripted scenes, no dialogue-bound visuals, no voiceover mode.
 *
 * This tool drives the real thing — the same two endpoints the Creation tab calls:
 *   POST /api/video/script    → the scripted scenes and dialogue for this business
 *   POST /api/video/generate  → the render (one brief per spoken line, TTS voiceover or avatar speaks, owner delivery)
 * It authenticates with the caller's own session token, so it can only ever act for the account in the conversation,
 * and it is listed in the review gate like every other billable generation.
 */
export function createAdVideoTool(supabase: SupabaseClient, userId: string) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com').replace(/\/$/, '');

  const post = async (path: string, body: unknown, token: string) => {
    const res = await fetch(`${appUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  };

  return {
    create_ad_video: tool({
      description:
        'Make a video ad through the Creation-tab pipeline (script → render). Use THIS for any "make me a video / reel / ad" request. It writes the scripted scenes and dialogue from the business profile, then renders with either a voiceover (default, no presenter) or your uploaded avatar speaking the lines, and it delivers to the owner. Do NOT hand-build films in the sandbox unless the ask is motion graphics with no spoken script; do NOT use generate_grok_video or generate_ai_image for an ad, they produce one clip or one still.',
      inputSchema: z.object({
        brief: z
          .string()
          .describe('What the video is about, in the owner\'s words — the offer, the product, the message. This is the only source of style when no reference is given.'),
        durationSeconds: z
          .number()
          .default(30)
          .describe('Target length in seconds. The renderer uses 15s clips, so 30 means two.'),
        language: z
          .string()
          .default('hinglish')
          .describe('Spoken language for the script and voiceover, e.g. hinglish, english_in, hindi.'),
        presenter: z
          .enum(['voiceover', 'avatar'])
          .default('voiceover')
          .describe('voiceover = narration over b-roll (default). avatar = the uploaded avatar photo speaks the lines; only use it when the owner asked for their avatar.'),
        productId: z
          .string()
          .optional()
          .describe('A catalogue item (properties/products row) to feature. Omit to let the pipeline pick from the business profile.'),
      }),
      execute: async ({ brief, durationSeconds, language, presenter, productId }) => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = (sessionData as any)?.session?.access_token;
          if (!token) {
            return {
              success: false,
              error:
                'I cannot reach the video pipeline without your session. Ask the owner to run it from the Creation tab, or retry in this chat.',
            };
          }

          // 1. Script — the creation tab's own planner.
          const scriptRes = await post(
            '/api/video/script',
            {
              propertyId: productId || undefined,
              concept: brief,
              userInstructions: brief,
              duration: durationSeconds,
              language,
            },
            token
          );
          if (!scriptRes.ok) {
            return {
              success: false,
              error: `The video script step failed (${scriptRes.status}): ${scriptRes.json?.error || 'unknown error'}`,
            };
          }
          const script = scriptRes.json?.script || scriptRes.json?.data || scriptRes.json;
          const dialogue = String(script?.dialogue || '').trim();

          // 2. Render — the same endpoint the Creation tab calls, with the presenter mode the owner wants.
          const generateRes = await post(
            '/api/video/generate',
            {
              presenterType: presenter === 'avatar' ? 'avatar' : 'none',
              script,
              propertyId: productId || undefined,
              duration: durationSeconds,
              language,
            },
            token
          );
          if (!generateRes.ok) {
            return {
              success: false,
              error: `The render step failed (${generateRes.status}): ${generateRes.json?.error || 'unknown error'}`,
              script,
            };
          }

          const taskIds = generateRes.json?.taskIds || generateRes.json?.tasks || [];
          return {
            success: true,
            status: 'rendering',
            presenter,
            durationSeconds,
            dialogue: dialogue.slice(0, 600),
            scenes: Array.isArray(script?.scenes) ? script.scenes.length : undefined,
            clips: Array.isArray(taskIds) ? taskIds.length : undefined,
            message:
              `Scripted and rendering through the Creation pipeline (${presenter === 'avatar' ? 'avatar speaks the lines' : 'voiceover'}, ` +
              `${durationSeconds}s). It lands in Assets when it finishes, and the owner is notified.`,
            note: 'Do not re-render the same brief while this is rendering; it is already billing.',
          };
        } catch (err: any) {
          return { success: false, error: `Video pipeline call failed: ${err?.message || err}` };
        }
      },
    }),
  };
}
