/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and provider payloads are untyped (stale generated types), matching lib/agent/tools/media_studio.ts. */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getActivePlaybook } from '@/lib/automation/ceo';
import { industryVocabulary } from '@/lib/automation/industry';
import { resolveRecipes, type RecipeSet } from '@/lib/automation/recipes';
import {
  reserveCredits,
  closeHold,
  quoteJob,
  QUOTE_APPROVAL_THRESHOLD,
} from '@/lib/automation/billing';
import { videoCredits, imageCredits, vendorVideoSeconds } from '@/lib/automation/onboarding-plan';
import { brandKitFor } from '../media/brand-kit';
import { outboundRecipient, testBanner } from '@/lib/automation/test-mode';
import { deliverVideoToAdmin } from '@/lib/automation/video-delivery';
import { createKieImageTask, createKieTask } from '@/utils/external-apis';
import { imageModelFor } from '@/lib/agent/media-models';

/**
 * Composition tools: the agent makes an artefact from its own tools, guided by the
 * recipe, instead of calling a pipeline that decided the model and the format.
 *
 * WHY THIS LAYER EXISTS
 * `generate_ai_image` and `generate_grok_video` are primitives — give them a
 * prompt and they render it. What they cannot do is know that this business sells
 * courses rather than flats, that a photo of the actual offering is mandatory and
 * an invented building is not, or that a silent poster is the right answer when
 * there is no photo at all. That is what the recipe carries, and these tools apply
 * it so the agent does not have to re-derive it on every run.
 *
 * THE MONEY CONTRACT (read this before changing anything here)
 * A hold is a FUNDING RESERVATION, not a charge. Composing inside an agent turn,
 * the vendor cost is already metered and charged once by the turn's usage meter
 * (`lib/agent/usage.ts`), so reserving AND charging here would bill the customer
 * twice. So these tools reserve, and then release — the reservation exists to stop
 * two concurrent runs from both committing the same last 50 credits. The only
 * place a hold is actually charged is `app/api/onboarding/complete`, which runs
 * outside a turn where nothing else would ever collect the money.
 */
export function createCompositionTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  const saveAsset = async (args: {
    title: string;
    type: 'video' | 'image';
    url: string;
    status?: string;
    taskId?: string;
    metadata?: Record<string, any>;
  }) => {
    try {
      // The live `assets` table has no `title` column (the repo migration is
      // stale) and its status vocabulary is capitalised — 'Ready' / 'Rendering' /
      // 'Failed'. Writing `title` fails the whole insert with PGRST204, and a
      // lowercase status makes the asset invisible to the library filters.
      const { data, error } = await db
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
        console.warn(`[Compose] Asset save failed: ${error.message}`);
        return null;
      }
      return data;
    } catch (e: any) {
      console.warn(`[Compose] Asset save failed: ${e?.message || e}`);
      return null;
    }
  };

  /** Facts are rendered as a plain block: the agent writes them, we never invent. */
  const factsBlock = (facts?: Record<string, unknown> | null): string => {
    if (!facts) return '';
    const lines = Object.entries(facts)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`);
    return lines.length ? lines.join('\n') : '';
  };

  const listOf = (value: unknown): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v)).filter(Boolean);

  /** Recipe rules, as prompt lines rather than prose the model can skim past. */
  const recipeLines = (recipe: Record<string, unknown>, heading: string): string => {
    const out: string[] = [`${heading}`];
    const add = (label: string, value: unknown) => {
      const items = listOf(value);
      if (items.length) out.push(`${label}: ${items.join('; ')}`);
    };
    add('Must include', recipe.must_include);
    add('Structure', recipe.structure);
    add('Layout', recipe.layout);
    add('Avoid', recipe.avoid);
    if (recipe.format && typeof recipe.format === 'object') {
      out.push(`Format: ${JSON.stringify(recipe.format)}`);
    }
    if (recipe.language) out.push(`Language: ${String(recipe.language)}`);
    return out.join('\n');
  };

  const loadGuidance = async () => {
    const playbook = await getActivePlaybook(db, userId);
    const recipes: RecipeSet = resolveRecipes((playbook as any).recipes);
    const vocab = industryVocabulary(playbook.industry || null);
    return { playbook, recipes, vocab };
  };

  /**
   * Reserve funding for this artefact, and say so clearly when there is none.
   * Returns the hold so the caller can release it (see the money contract above).
   */
  const reserveForArtefact = async (jobId: string, credits: number, reason: string) => {
    const reservation = await reserveCredits(db, {
      userId,
      jobId,
      amount: credits,
      ttlMinutes: 45,
      reason,
    });
    return reservation;
  };

  return {
    composeCreative: tool({
      description:
        'Compose one marketing creative (poster / social image) for this business, applying its stored creative recipe: what must be included, the layout rules, what to avoid, and the degraded path when no usable photo exists. Use this instead of generate_ai_image when the artefact is an ad for the business — it knows the industry vocabulary and refuses to depict a product that was not supplied. Returns a task id; poll it with check_media_task before treating it as delivered.',
      inputSchema: z.object({
        brief: z
          .string()
          .describe(
            'What the creative is for, in one or two sentences, in this business\'s own terms. e.g. "Diwali offer on the 2BHK at Green Meadows, price on request".'
          ),
        facts: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Verified facts only: name, price, location, dates, offer. Anything not in here must not appear in the artefact.'
          ),
        photoUrls: z
          .array(z.string())
          .optional()
          .describe(
            'Public HTTPS photos of the ACTUAL offering. If empty, the degraded typographic path is used automatically.'
          ),
        title: z.string().optional().describe('Title for the saved asset'),
        jobId: z
          .string()
          .optional()
          .describe('Stable id for this piece of work, so a retry reuses the same reservation'),
      }),
      execute: async ({ brief, facts, photoUrls, title, jobId }: any) => {
        const text = String(brief || '').trim();
        if (!text) return { success: false, error: 'brief is required.' };

        const { recipes, vocab } = await loadGuidance();
        const photos = (photoUrls || []).filter((u: string) => /^https?:\/\//i.test(String(u)));
        const degraded = photos.length === 0;

        const job = jobId || `creative:${userId}:${Date.now()}`;
        const credits = imageCredits();

        // Above the approval threshold a single artefact is unusual, but if the
        // recipe ever grows past it the rule still holds: quote, do not execute.
        const quote = quoteJob(job, [{ id: 'creative', kind: 'image', units: 1 }]);
        if (quote.costInCredits > QUOTE_APPROVAL_THRESHOLD) {
          return {
            success: false,
            requiresApproval: true,
            quote,
            error: `This creative costs ${quote.costInCredits} credits, above the ${QUOTE_APPROVAL_THRESHOLD}-credit threshold. Ask the owner first.`,
          };
        }

        const reservation = await reserveForArtefact(job, credits, `composeCreative: ${text.slice(0, 60)}`);
        if (!reservation.ok) {
          return {
            success: false,
            insufficientCredits: true,
            available: reservation.available,
            needed: credits,
            error:
              `A creative needs about ${credits} credits and only ${reservation.available ?? 0} are available ` +
              '(part of the balance is already committed to work in progress). Do the cheaper thing or ask the owner to top up.',
          };
        }

        try {
          const factLines = factsBlock(facts);
          const degradedLine = degraded
            ? `NO USABLE PHOTO WAS SUPPLIED. Follow the recipe's degraded path exactly: ${String(
                recipes.creative.degraded_path || 'make a clean typographic poster and do NOT invent the product.'
              )}`
            : 'Use the supplied photo(s) as the actual subject. Never replace them with a different location, building or person.';

          /**
           * THE BRAND KIT, APPLIED HERE TOO.
           *
           * This tool had NO brand awareness at all — no brand colour, no standing rules, no logo discipline — so a
           * composed poster came out in whatever palette the model chose. That is the tool that produced the customer's
           * Black Friday poster after the brand kit shipped, which is why they said "still not taking the brand
           * guidelines": the kit was wired into generate_ai_image and never into this one.
           */
          const brandKit = await brandKitFor(supabase, userId);

          const prompt = [
            `Create one ${vocab.productNoun} advertisement image for ${vocab.key === 'generic' ? 'this business' : `a ${vocab.productNounPlural} business`}.`,
            '',
            `BRIEF: ${text}`,
            factLines ? `\nVERIFIED FACTS (the only facts allowed to appear):\n${factLines}` : '\nNo facts supplied: use no prices, no numbers, no claims.',
            '',
            degradedLine,
            '',
            recipeLines(recipes.creative, 'CREATIVE RECIPE (first-draft guidance):'),
            '',
            brandKit.rules
              ? `BRAND LOCK — this business's own design system, which outranks the recipe and any generic styling:\n${brandKit.rules}`
              : '',
            'Rules: photorealistic, one clear focal point, generous margins, text legible at thumbnail size.',
            'Never bake a phone number or a price into the image.',
          ]
            .filter(Boolean)
            .join('\n');

          const model = imageModelFor(photos);
          const taskId = await createKieImageTask(prompt, model, '3:4', photos);

          if (!taskId) throw new Error('the image provider did not return a task id');

          const asset = await saveAsset({
            title: title || `Creative: ${text.slice(0, 48)}`,
            type: 'image',
            url: '',
            status: 'Rendering',
            taskId,
            metadata: {
              engine: 'compose_creative',
              prompt,
              degraded,
              job_id: job,
              facts: facts || null,
            },
          });

          return {
            success: true,
            status: 'processing',
            taskId,
            assetId: asset?.id || null,
            degraded,
            usedRecipe: 'creative',
            reservedCredits: credits,
            message: degraded
              ? 'Composing the degraded typographic poster (no usable photo was supplied). Poll check_media_task with the taskId.'
              : 'Creative is rendering. Poll check_media_task with the taskId before delivering it.',
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Creative composition failed', degraded };
        } finally {
          // Reservation only — the turn's usage meter settles the money.
          await closeHold(db, reservation.holdId, 'composeCreative submitted');
        }
      },
    }),

    composeVideo: tool({
      description:
        'Compose one short vertical video for this business, applying its stored video recipe (structure beats, audio rules, degraded path). Decides the audio mode for you: if a presenter speaks in the clip it will NOT add a separate voiceover; if the visuals are silent it will tell you the exact next step to add narration. Returns a task id — the render is asynchronous, so poll with check_media_task and only call deliverArtefact once it has succeeded.',
      inputSchema: z.object({
        brief: z.string().describe('What the clip is about, and the one beat it must land.'),
        facts: z
          .record(z.string(), z.any())
          .optional()
          .describe('Verified facts only. Anything not here must not be spoken or shown.'),
        photoUrls: z
          .array(z.string())
          .optional()
          .describe('Public HTTPS photos of the real offering, used as the video reference frames.'),
        seconds: z
          .number()
          .optional()
          .describe('Target length. 15 or 30 is what the model renders well; anything longer is billed as 30.'),
        presenterSpeaks: z
          .boolean()
          .optional()
          .describe(
            'True when a person/avatar speaks inside the clip. Then the speaking IS the narration and no voiceover may be added.'
          ),
        narration: z
          .string()
          .optional()
          .describe('A line to be spoken over silent visuals. Ignored when presenterSpeaks is true.'),
        title: z.string().optional(),
        jobId: z.string().optional(),
      }),
      execute: async ({ brief, facts, photoUrls, seconds, presenterSpeaks, narration, title, jobId }: any) => {
        const text = String(brief || '').trim();
        if (!text) return { success: false, error: 'brief is required.' };

        const { recipes, vocab } = await loadGuidance();
        const photos = (photoUrls || []).filter((u: string) => /^https?:\/\//i.test(String(u)));
        const requested = Number(seconds) || 15;
        const vendorSeconds = vendorVideoSeconds(requested);

        // THE AUDIO DECISION — the owner's own note, encoded once.
        const presenterIsSpeaking = Boolean(presenterSpeaks);
        const wantVoiceover = Boolean(String(narration || '').trim()) && !presenterIsSpeaking;
        const audioMode: 'presenter' | 'voiceover_after' | 'silent' = presenterIsSpeaking
          ? 'presenter'
          : wantVoiceover
            ? 'voiceover_after'
            : 'silent';

        const job = jobId || `video:${userId}:${Date.now()}`;
        const credits = videoCredits(requested);

        const reservation = await reserveForArtefact(job, credits, `composeVideo: ${text.slice(0, 60)}`);
        if (!reservation.ok) {
          return {
            success: false,
            insufficientCredits: true,
            available: reservation.available,
            needed: credits,
            error: `A ${vendorSeconds}s video needs about ${credits} credits and only ${reservation.available ?? 0} are available. Offer the poster instead.`,
            degradedSuggestion: 'composeCreative',
          };
        }

        try {
          const factLines = factsBlock(facts);
          const spoken = presenterIsSpeaking
            ? `${String(narration || '').trim() || 'One short line, in the presenter\'s own voice, drawn from the facts.'} (spoken by the presenter on camera; about ${Math.round(vendorSeconds * 2.2)} words)`
            : '';

          const prompt = [
            `Vertical ${vendorSeconds}-second advertisement for this ${vocab.productNoun} business.`,
            '',
            `BRIEF: ${text}`,
            factLines ? `\nVERIFIED FACTS (the only facts allowed):\n${factLines}` : '\nNo facts supplied: make no specific claims.',
            '',
            recipeLines(recipes.video, 'VIDEO RECIPE (first-draft guidance):'),
            '',
            photos.length
              ? 'Use the supplied photo(s) as the real subject of the footage. Do not invent a different place or product.'
              : `No photo supplied. Keep it abstract and honest; ${String(recipes.video.degraded_path || 'prefer a clean graphic reel over an invented scene')}`,
            '',
            `AUDIO: ${
              audioMode === 'presenter'
                ? `the presenter speaks on camera. DIALOGUE: ${spoken}`
                : audioMode === 'voiceover_after'
                  ? 'the visuals are silent; narration will be added afterwards as a separate track, so generate NO speech.'
                  : 'fully silent clip. Generate NO speech and NO music bed that suggests dialogue.'
            }`,
          ]
            .filter(Boolean)
            .join('\n');

          const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
          const payload: any = {
            model: 'bytedance/seedance-2-mini',
            input: {
              prompt,
              aspect_ratio: '9:16',
              duration: vendorSeconds,
              generate_audio: audioMode === 'presenter',
              resolution: '480p',
              nsfw_checker: true,
              web_search: false,
            },
          };
          if (baseUrl) payload.callBackUrl = `${baseUrl}/api/video/callback`;
          if (photos.length) payload.input.reference_image_urls = [photos[0]];

          const { taskId, error } = await createKieTask(payload);
          if (error || !taskId) throw new Error(error || 'the video provider did not return a task id');

          const asset = await saveAsset({
            title: title || `Video: ${text.slice(0, 48)}`,
            type: 'video',
            url: '',
            status: 'Rendering',
            taskId,
            metadata: {
              engine: 'compose_video',
              prompt,
              audio_mode: audioMode,
              job_id: job,
              requested_seconds: requested,
              vendor_seconds: vendorSeconds,
              facts: facts || null,
            },
          });

          // The callback route and the stitcher both work off `video_tasks`, so a
          // submitted render that is not registered there is never finished.
          if (asset?.id) {
            await db.from('video_tasks').insert([
              {
                user_id: userId,
                property_id: null,
                asset_id: asset.id,
                prompts: [prompt],
                current_index: 0,
                last_task_id: taskId,
                last_successful_task_id: '',
                aspect_ratio: '9:16',
                status: 'Processing',
                final_caption: text.slice(0, 300),
              },
            ]);
          }

          const audioNote =
            audioMode === 'presenter'
              ? 'The presenter speaks in the clip, so NO separate voiceover was added (per the audio rule).'
              : audioMode === 'voiceover_after'
                ? 'The visuals are silent. Next step: call generate_voiceover with the narration, then mux it under the clip in the sandbox.'
                : 'The clip is silent. Add a voiceover only if the owner asks for one.';

          return {
            success: true,
            status: 'processing',
            taskId,
            assetId: asset?.id || null,
            audioMode,
            reservedCredits: credits,
            usedRecipe: 'video',
            message: `Video is rendering. ${audioNote} Poll check_media_task with the taskId, and only then call deliverArtefact.`,
          };
        } catch (err: any) {
          // The recipe's degraded path, offered rather than assumed: a failed
          // render must not end the day's output.
          return {
            success: false,
            error: err?.message || 'Video composition failed',
            degradedPath: String(recipes.video.degraded_path || ''),
            degradedSuggestion: 'composeCreative',
            message:
              'The video could not be started. Per the video recipe, deliver a poster or a stills reel instead — do not retry the same render blindly.',
          };
        } finally {
          await closeHold(db, reservation.holdId, 'composeVideo submitted');
        }
      },
    }),

    deliverArtefact: tool({
      description:
        'Deliver a finished artefact to the owner, or mark it as not-to-be-delivered. Only call this when check_media_task has reported success — never deliver something that is still rendering. Videos go out through the approved video-ready template plus email; images go out as a WhatsApp image from the business\'s own number. Every channel is subject to outbound test mode.',
      inputSchema: z.object({
        assetId: z.string().describe('The assetId returned by composeCreative / composeVideo'),
        channel: z
          .enum(['whatsapp', 'none'])
          .default('whatsapp')
          .describe('whatsapp = send it to the owner now; none = mark it delivered-in-app only'),
        note: z.string().optional().describe('One line to accompany it, in the owner\'s language'),
      }),
      execute: async ({ assetId, channel, note }: any) => {
        try {
          const { data: asset, error } = await db
            .from('assets')
            .select('id, type, url, status, caption, metadata')
            .eq('id', assetId)
            .eq('user_id', userId)
            .maybeSingle();

          if (error || !asset) return { success: false, error: 'Artefact not found for this business.' };

          const url = String(asset.url || '');
          const rendering = ['Rendering', 'Processing', 'Draft'].includes(String(asset.status || ''));
          if (!url || rendering || url.includes('designs.adrolls.in/processing')) {
            return {
              success: false,
              notReady: true,
              error:
                'That artefact is still rendering or has no final URL. Poll check_media_task first, then deliver it.',
            };
          }

          if (channel === 'none') {
            await db
              .from('assets')
              .update({ metadata: { ...(asset.metadata || {}), delivered_in_app: true } })
              .eq('id', assetId)
              .eq('user_id', userId);
            return { success: true, delivered: false, message: 'Left in the owner\'s library and not sent anywhere.' };
          }

          if (asset.type === 'video') {
            const result = await deliverVideoToAdmin(db, {
              userId,
              assetId,
              videoUrl: url,
              title: asset.metadata?.title || 'Your video',
              caption: note || asset.caption || null,
            });
            return {
              success: result.whatsapp || result.email,
              delivered: Boolean(result.whatsapp || result.email),
              skipped: result.skipped,
              error: result.error,
              channels: { whatsapp: result.whatsapp, email: result.email },
            };
          }

          // Images: send from the business's own WABA to the owner's own number.
          const { data: profile } = await db
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, whatsapp_personal_number, contact_number, business_name, client_features')
            .eq('id', userId)
            .maybeSingle();

          const token = profile?.whatsapp_access_token || profile?.facebook_token;
          const phoneId = profile?.whatsapp_phone_number_id;
          const owner = outboundRecipient(profile?.whatsapp_personal_number || profile?.contact_number);

          if (!token || !phoneId) {
            return {
              success: false,
              notConfigured: true,
              message: 'The business has no WhatsApp number connected, so the artefact was left in the library.',
            };
          }
          if (!owner) {
            return {
              success: false,
              testModeBlocked: true,
              message: 'Outbound test mode is on with no test number configured — refusing to send.',
            };
          }

          const caption = `${note || asset.metadata?.title || 'Your creative'}${testBanner()}`;
          const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: String(owner).replace(/\D/g, ''),
              type: 'image',
              image: { link: url, caption: caption.slice(0, 1000) },
            }),
          });

          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            return {
              success: false,
              error: `WhatsApp rejected the image send (${res.status}). ${detail.slice(0, 200)}`,
            };
          }

          await db
            .from('assets')
            .update({ metadata: { ...(asset.metadata || {}), image_delivered: true } })
            .eq('id', assetId)
            .eq('user_id', userId);

          return { success: true, delivered: true, channels: { whatsapp: true, email: false } };
        } catch (e: any) {
          return { success: false, error: e?.message || 'Delivery failed' };
        }
      },
    }),
  };
}
