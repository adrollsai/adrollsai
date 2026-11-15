/**
 * The video skill, as the agent uses it.
 *
 * THE GAP THIS CLOSES
 * `lib/agent/tools/skills/video/` holds the whole video contract — the beats schema,
 * the readability rule, the 0.5 s lead-in, the credit model and the emitter — and the
 * agent could not call ANY of it. Asked for a film it reached for `composeVideo`, which
 * is a different, older path with none of those checks. The skill was a library only the
 * test scripts could use.
 *
 * WHAT IS EXPOSED, AND WHAT IS DELIBERATELY NOT
 *   plan_video   the whole contract, without spending anything: validate the beats the
 *                agent wrote, quote the credits per step, name every problem in words the
 *                agent can act on. This is the Plan Card the platform requires — ask
 *                before spending — implemented as the thing that must pass first.
 *
 * The RENDER itself is not exposed here. It is the durable runner (P1): a sandbox, a
 * credit reservation, per-step charges and an R2 artefact. Wrapping that in a tool the
 * model can call mid-conversation is a real piece of work with real money behind it, and
 * getting it wrong is worse than not having it. Until then `composeVideo` is the path
 * that actually renders, and this tool is what stops a bad brief reaching it.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { BeatsError, MAX_LINE_WORDS } from './skills/video/beats';
import { planVideoSkill } from './skills/video/index';

export interface PlanVideoResult {
  success: boolean;
  /** What the owner would be told before paying. */
  briefing?: string;
  slug?: string;
  artefactKey?: string;
  credits?: { total: number; voice: number; clips: number; render: number };
  steps?: { name: string; credits: number; artefact: string }[];
  beats?: number;
  scenes?: number;
  plates?: number;
  clipSeconds?: number;
  voiceLines?: number;
  notes?: string[];
  /** Every rule the brief broke, in words the agent can act on. */
  problems?: string[];
  error?: string;
}

/**
 * Validate a beats brief and quote it. Pure: no vendor, no sandbox, no charge.
 *
 * Exported so the gate can drive it without an agent context.
 */
export function planVideo(input: unknown): PlanVideoResult {
  try {
    const payload = (input ?? {}) as Record<string, unknown>;
    const plan = planVideoSkill({
      beats: payload.beats,
      ...(payload.aspect ? { aspect: payload.aspect as never } : {}),
      ...(payload.voiceLanguage ? { voiceLanguage: String(payload.voiceLanguage) } : {}),
      ...(payload.onScreenLanguage ? { onScreenLanguage: String(payload.onScreenLanguage) } : {}),
      ...(payload.targetSeconds === undefined ? {} : { targetSeconds: Number(payload.targetSeconds) }),
      ...(payload.logoOnScreen === undefined ? {} : { logoOnScreen: Boolean(payload.logoOnScreen) }),
      ...(payload.endCard ? { endCard: payload.endCard as never } : {}),
    });

    const maxWords = MAX_LINE_WORDS[plan.beats.aspect];
    const problems: string[] = [];
    for (const beat of plan.beats.beats) {
      for (const line of beat.lines) {
        const words = line.split(/\s+/).filter(Boolean).length;
        if (words > maxWords) {
          problems.push(
            `beat ${beat.id}: "${line}" is ${words} words; at ${plan.beats.aspect} the limit is ${maxWords}. ` +
              'Split it across two beats or shorten it.',
          );
        }
      }
    }

    return {
      success: true,
      briefing: plan.briefing,
      slug: plan.slug,
      artefactKey: plan.artefactKey,
      credits: {
        total: plan.credits.total,
        voice: plan.credits.voice,
        clips: plan.credits.clips,
        render: plan.credits.render,
      },
      steps: plan.steps.map((step) => ({ name: step.name, credits: step.credits, artefact: step.artefact })),
      beats: plan.beats.beats.length,
      scenes: plan.beats.scenes.length,
      plates: plan.beats.plates.length,
      clipSeconds: plan.clipSeconds,
      voiceLines: plan.voiceLines,
      notes: plan.notes,
      problems,
    };
  } catch (error: any) {
    if (error instanceof BeatsError) {
      // The beats validator names the exact path that is wrong; pass it through rather
      // than replacing it with "invalid brief".
      return { success: false, error: String(error.message) };
    }
    return { success: false, error: String(error?.message ?? error) };
  }
}

export function createVideoSkillTools() {
  return {
    plan_video: tool({
      description:
        'Validate a video brief and quote it before anything is spent. Pass a beats file ' +
        '({ version, jobId, aspect, fps, targetSeconds, onScreenLanguage, beats[], scenes[], plates[], endCard }) ' +
        'and this returns whether the renderer will accept it, the credits per step, and what to fix. ' +
        'ALWAYS call this before telling the owner a film will be made: it enforces the rules the render ' +
        'refuses later — every line needs 0.5 s + 0.3 s per word on screen, at most ' +
        `${MAX_LINE_WORDS['9:16']} words a line at 9:16, and the film opens with a 0.5 s plate-only lead-in. ` +
        'Read get_skill("nobogent-video-brief") first.',
      inputSchema: z.object({
        beats: z
          .record(z.string(), z.any())
          .describe('The beats file. Must include beats[], scenes[], plates[] and an endCard.'),
        aspect: z.enum(['9:16', '16:9']).optional(),
        voiceLanguage: z.string().optional().describe('Language the voice SPEAKS. Hinglish by default.'),
        onScreenLanguage: z.string().optional().describe('Language the viewer READS. English by default.'),
        targetSeconds: z.number().optional().describe('Declared floor for the finished film, never below 30'),
        logoOnScreen: z.boolean().optional(),
        endCard: z.record(z.string(), z.any()).optional(),
      }),
      execute: async (input: any) => planVideo(input),
    }),
  };
}
