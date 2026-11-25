/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs and Supabase rows are untyped. */
/**
 * One tool that runs any of the app's pipelines.
 *
 * WHY ONE TOOL AND NOT SIX
 * The agent already reaches the ACTIONS (launch_meta_campaign, whatsapp_create_template,
 * start_calling_campaign, create_audience_group, launch_meta_retargeting, add_catalog_offering). What
 * it could not do in a fresh session was remember the ORDER of questions each screen asks — so it
 * improvised, differently every time. Teaching it six more tools would cost six descriptions in every
 * prompt and still leave the order to the model.
 *
 * So the boilerplates live in `lib/agent/pipelines/registry.ts` as data, and this single tool drives
 * whichever one is needed. A new workflow in the app becomes a spec, not a new dialect.
 *
 * WHAT IT NEVER DOES
 * It asks and it maps. It creates nothing, spends nothing, and messages nobody: it ends by naming the
 * composed tool and its arguments, and the agent calls that. The approval gate therefore still stands
 * exactly where it did, because the pipeline hands off to the same tool the screen uses.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PIPELINE_IDS,
  PIPELINES,
  findPipeline,
  pipelineFromAnswer,
  pipelineMenu,
} from '@/lib/agent/pipelines/registry';
import type { PipelineContext } from '@/lib/agent/pipelines/types';

const CALLING_VOICES = ['Aoede', 'Kore', 'Charon', 'Fenrir', 'Puck'];

export function createPipelineTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  /** Everything the pipelines can offer as an option, gathered once per call. */
  async function loadContext(): Promise<PipelineContext> {
    const ctx: PipelineContext = {
      currency: 'INR',
      minDailyBudget: 300,
      assets: [],
      products: [],
      audienceGroups: [],
      voices: CALLING_VOICES,
    };

    try {
      const { data: profile } = await db.from('profiles').select('currency').eq('id', userId).maybeSingle();
      if (profile?.currency) ctx.currency = String(profile.currency);
    } catch {
      // Defaults stay honest; a profile read failure must not stop the conversation.
    }

    // The real minimum, so a budget question never offers something the launch will refuse.
    try {
      const { MIN_DAILY_BUDGET_INR } = await import('@/lib/ads/launch-service');
      if (Number.isFinite(Number(MIN_DAILY_BUDGET_INR))) ctx.minDailyBudget = Number(MIN_DAILY_BUDGET_INR);
    } catch {
      // keep the default
    }

    try {
      const { data: assets } = await db
        .from('assets')
        .select('id, url, type, caption, created_at')
        .eq('user_id', userId)
        .in('type', ['image', 'video'])
        .order('created_at', { ascending: false })
        .limit(12);
      ctx.assets = (assets ?? []).map((asset: any, index: number) => ({
        id: String(asset.id),
        label: String(asset.caption || `${asset.type ?? 'image'} ${index + 1}`).slice(0, 60),
        kind: String(asset.type ?? 'image'),
        url: asset.url ? String(asset.url) : undefined,
      }));
    } catch {
      ctx.assets = [];
    }

    try {
      const { data: products } = await db.from('inventory').select('id, title, name').eq('user_id', userId).limit(10);
      ctx.products = (products ?? [])
        .map((product: any) => ({ id: String(product.id), label: String(product.title || product.name || '').trim() }))
        .filter((product: any) => product.label);
    } catch {
      ctx.products = [];
    }

    try {
      const { data: groups } = await db
        .from('audience_groups')
        .select('id, name')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      ctx.audienceGroups = (groups ?? [])
        .map((group: any) => ({ id: String(group.id), name: String(group.name || '').trim() }))
        .filter((group: any) => group.name);
    } catch {
      ctx.audienceGroups = [];
    }

    return ctx;
  }

  return {
    start_pipeline: tool({
      description:
        'The HEADSTART for anything this app already does as a workflow, so you never have to reinvent it in a fresh ' +
        'session. Call it with NO pipeline to get the menu, and the owner picks with one tap. Then call it again with ' +
        'the pipeline id plus the accumulated answers, and again with what they just said (justAnswered + lastStep) ' +
        'until it returns ready:true — at which point it gives you the exact tool call to make.\n' +
        'PIPELINES: ' +
        PIPELINES.map((pipeline) => `${pipeline.id} (${pipeline.title}: ${pipeline.summary})`).join('; ') +
        '.\n' +
        'RULES: never ask in prose a question a pipeline renders as buttons; put the free-text box to work for anything ' +
        'the pipeline has no field for (the notes it returns tell you what to honour); and if the owner has already ' +
        'answered some questions unprompted, pass those as answers and continue from what is missing. ' +
        'The primitives (meta_graph_*, generate_ai_image, data_write, …) remain yours for genuinely one-off work the ' +
        'pipelines do not cover — a pipeline is a headstart, not a cage.',
      inputSchema: z
        .object({
          pipeline: z.string().optional().describe(`One of: ${PIPELINE_IDS.join(', ')}. Omit to see the menu.`),
          answers: z
            .record(z.string(), z.any())
            .optional()
            .describe('Everything answered so far, as returned by the previous call. Omit to start from the top.'),
          justAnswered: z
            .string()
            .optional()
            .describe("The owner's latest reply, verbatim — a tapped option label or something they typed."),
          lastStep: z.string().optional().describe('Which question justAnswered was answering.'),
        })
        .passthrough(),
      execute: async (input: any) => {
        try {
          const ctx = await loadContext();

          // ── no pipeline named: show the menu ────────────────────────────────────────────────
          if (!input?.pipeline) {
            const menu = pipelineMenu();
            return {
              ok: true,
              ready: false,
              step: 'pipeline',
              menu,
              artifact: {
                type: 'user_input_prompt',
                question: 'Which workflow should I run?',
                context: 'These are the ones this app already does properly. Anything else, just say it.',
                suggestedOptions: menu.map((entry) => entry.label),
                allowFreeText: true,
              },
              suggestedOptions: menu.map((entry) => entry.label),
              message:
                'Ask which workflow they want, offering exactly these options (the chat renders them as buttons): ' +
                `${menu.map((entry) => `"${entry.label}"`).join(', ')}. ` +
                'When they pick one, call start_pipeline again with that pipeline id.',
            };
          }

          let spec = findPipeline(input.pipeline);
          if (!spec) spec = pipelineFromAnswer(String(input.pipeline));
          if (!spec) {
            return {
              ok: false,
              error: `"${input.pipeline}" is not a pipeline. Available: ${PIPELINE_IDS.join(', ')}.`,
            };
          }

          // ── fold in the answer they just gave ──────────────────────────────────────────────
          /**
           * The answered-map is carried across turns, not rebuilt.
           *
           * It is what stops a pipeline asking the same question twice: a step counts as answered when
           * it appears here. Rebuilding it each turn (or dropping it) makes the first question come back
           * for ever, which in a chat looks like the agent ignoring what it was just told.
           */
          const answers: Record<string, any> = { ...(input?.answers ?? {}) };
          const answered: Record<string, boolean> = { ...(answers.__answered ?? {}) };
          // The context is loaded fresh on every call; never trust one that came back through the model.
          delete answers.__ctx;
          answers.__answered = answered;
          let acknowledged: string | null = null;

          if (input?.justAnswered && input?.lastStep) {
            const step = String(input.lastStep);
            const parsed = spec.parse(step, String(input.justAnswered), ctx);
            if (parsed && Object.keys(parsed).length) {
              Object.assign(answers, parsed);
              acknowledged = `Recorded for ${step}`;
            } else {
              /**
               * They said something the options did not cover. Take it as an instruction and carry on
               * rather than bouncing the same buttons back — the agent can do more than the pipeline.
               */
              answers.instructions = [answers.instructions, String(input.justAnswered).trim()]
                .filter(Boolean)
                .join('. ');
              acknowledged = `Recorded as an instruction: "${String(input.justAnswered).trim().slice(0, 200)}"`;
            }
            // Answered either way: a question they replied to must not be asked again.
            answered[step] = true;
            answers.__answered = answered;
          }

          const question = spec.nextQuestion(answers, ctx);

          if (!question) {
            const completion = spec.complete(answers, ctx);
            if (!completion.ready) {
              return {
                ok: false,
                pipeline: spec.id,
                blockers: completion.blockers,
                answers,
                message: `Still needed: ${completion.blockers.join('; ')}. Ask for these, then call start_pipeline again.`,
              };
            }
            return {
              ok: true,
              ready: true,
              pipeline: spec.id,
              answers,
              call: completion.call,
              ...(completion.notes?.length ? { notes: completion.notes } : {}),
              message:
                `Call ${completion.call.tool} with call.args — it is the same path the screen uses, and it stays behind ` +
                'the approval gate. Then tell the owner what you did.' +
                (completion.notes?.length ? ` ${completion.notes.join(' ')}` : '') +
                (answers.instructions ? ` Also honour this instruction: "${answers.instructions}".` : ''),
            };
          }

          return {
            ok: true,
            ready: false,
            pipeline: spec.id,
            step: question.step,
            answers,
            ...(acknowledged ? { acknowledged } : {}),
            artifact: {
              type: 'user_input_prompt',
              question: question.question,
              context: question.context,
              suggestedOptions: question.options,
              allowFreeText: question.allowsFreeText,
              pipeline: { id: spec.id, step: question.step, answers },
            },
            question: question.question,
            context: question.context,
            suggestedOptions: question.options,
            message:
              `Ask the owner this question and offer exactly these options (the chat renders them as buttons): ` +
              `${question.options.map((option) => `"${option}"`).join(', ') || 'no options — they type the answer'}. ` +
              'They may also type anything else; pass it back as justAnswered with lastStep ' +
              `"${question.step}", along with answers and pipeline "${spec.id}".`,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the pipeline could not continue' };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are wired. */
export const PIPELINE_TOOLS = ['start_pipeline'] as const;
