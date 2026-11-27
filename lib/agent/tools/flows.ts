/**
 * Authoring an automation flow, which the agent could not do at all.
 *
 * THE GAP THIS CLOSES
 * `tools/automation.ts` gave the agent `list_automation_flows` and
 * `check_flow_conflicts` â€” it could SEE flows and never make one. So "create a
 * WhatsApp flow: when a lead comes in, send the brochure, then call them" resolved to
 * a truthful "I cannot do that", which is a worse product than one that can.
 *
 * WHAT A FLOW IS (read out of the 15 real rows in `automations`)
 *   title        `Flow: <name>`
 *   description  a JSON STRING: { name, isActive, trigger, nodes[] }
 *   nodes        { id, type, position:{x,y}, data:{â€¦} }
 * and `utils/whatsapp/flow-runner.ts` is the only thing that executes them, so this
 * file's vocabulary is copied FROM that runner rather than invented:
 *
 *   triggers  trigger_meta_ad, trigger_whatsapp_ctwa, trigger_whatsapp_inbound,
 *             trigger_crm_lead, trigger_ig_comment, trigger_fb_comment,
 *             trigger_ig_dm, trigger_fb_messenger, trigger_whatsapp_template_button
 *   nodes     triggerNode, whatsappMessageNode, aiCallNode, delayNode
 *
 * THE DELAY TRAP, stated by the runner itself: `action_delay` is capped at TEN
 * SECONDS ("a real 'call them in 2 hours' cannot be a delayed step"). So this tool
 * refuses a wait longer than that instead of writing a flow that looks right and
 * fires at the wrong time. A real wait belongs on a schedule, and the refusal says so.
 *
 * The agent supplies structure; the model supplies the words. Asking a model to emit
 * a flow graph as free prose is how you get a flow that validates and does not run.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { describeConflict, findTriggerConflict, identityKey, type FlowIdentity } from '@/lib/flows/conflicts';
import { actionsAvailableFor, validateAgainstTrigger } from '@/lib/flows/capabilities';
import { describeDelivery, listDeliveries } from '@/lib/flows/delivery';
import type { SupabaseClient } from '@supabase/supabase-js';

/** The trigger vocabulary `flow-runner.ts` actually matches on. */
export const FLOW_TRIGGERS = [
  'trigger_meta_ad',
  'trigger_whatsapp_ctwa',
  'trigger_whatsapp_inbound',
  'trigger_crm_lead',
  'trigger_ig_comment',
  'trigger_fb_comment',
  'trigger_ig_dm',
  'trigger_fb_messenger',
  'trigger_whatsapp_template_button',
  'trigger_booking_created',
] as const;

export type FlowTrigger = (typeof FLOW_TRIGGERS)[number];

/** The node types `flow-runner.ts` actually executes. */
export const FLOW_NODE_TYPES = ['triggerNode', 'whatsappMessageNode', 'aiCallNode', 'delayNode', 'whatsappTemplateNode'] as const;

/** `flow-runner.ts` caps an INLINE delay node at 10 seconds. Longer waits are scheduled instead. */
export const MAX_FLOW_DELAY_SECONDS = 10;

/** The longest a scheduled wait may be. A sequence is a ledger row, so this is a sanity ceiling. */
export const MAX_SCHEDULED_DELAY_MINUTES = 90 * 24 * 60;

export interface FlowStep {
  kind: 'message' | 'call' | 'wait' | 'handoff' | 'template';
  /** `message`: what to send. `call`: optional note for the caller. `handoff`: why a human takes over. */
  text?: string;
  /** `wait`: seconds, at most MAX_FLOW_DELAY_SECONDS (an inline delay). */
  seconds?: number;
  /**
   * Wait this many minutes BEFORE this step, on the durable schedule.
   *
   * This is the "then after two days" half of a sequence. It is deliberately not a `wait` step:
   * an inline wait cannot sleep for two days, but a scheduled ledger row simply states the time.
   */
  delayMinutes?: number;
  /**
   * Time this step relative to the APPOINTMENT instead of to the trigger: 1440 = 24 hours before it,
   * 30 = half an hour before it. Requires the booking trigger.
   */
  beforeEventMinutes?: number;
  /** `template`: the approved Meta template to send. */
  templateName?: string;
}

export interface BuildFlowInput {
  name: string;
  trigger: FlowTrigger;
  /** Optional template whose button click starts the flow. */
  templateName?: string;
  /**
   * Only fire for leads that came from this campaign.
   *
   * "When a lead comes from the campaign I just launched" is a different instruction from "when a
   * lead comes in", and an account running several campaigns needs the difference.
   */
  campaignId?: string;
  /**
   * Words that must appear in the inbound message for the flow to fire.
   *
   * Only meaningful on message-ish triggers. Without them an active inbound flow answers EVERY
   * message the business receives, which is almost never what an owner means by "when someone asks
   * about the brochure" — so the tool says so rather than pretending the flow is narrow.
   */
  keywords?: string[];
  steps: FlowStep[];
  isActive?: boolean;
}

/** How many keywords are honoured, and how long each may be. */
export const MAX_FLOW_KEYWORDS = 10;
const MAX_KEYWORD_CHARS = 40;

/** "1440" is unreadable in a node title; "1 day" is what the owner actually said. */
function formatDelay(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function normaliseKeywords(raw: unknown): string[] {  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const keyword = String(entry ?? '').trim().slice(0, MAX_KEYWORD_CHARS);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= MAX_FLOW_KEYWORDS) break;
  }
  return out;
}

export interface BuiltFlow {
  title: string;
  /** The JSON string that goes in `automations.description`. */
  description: string;
  isActive: boolean;
  nodeCount: number;
  /** Anything the caller should know before trusting the flow. */
  notes: string[];
}

export class FlowError extends Error {
  readonly reason:
    | 'unknown_trigger'
    | 'no_steps'
    | 'delay_too_long'
    | 'empty_message'
    | 'unknown_step'
    | 'keywords_not_supported'
    | 'needs_booking_trigger'
    | 'no_template';
  constructor(reason: FlowError['reason'], message: string) {
    super(message);
    this.name = 'FlowError';
    this.reason = reason;
  }
}

const SPACING_X = 300;
const ORIGIN_X = 50;
const ORIGIN_Y = 150;

/**
 * Turn a description of a flow into the row the runner expects.
 *
 * Pure: no I/O, so the whole vocabulary check runs in a gate.
 */
export function buildFlow(input: BuildFlowInput): BuiltFlow {
  const notes: string[] = [];
  const name = String(input.name ?? '').trim();
  if (!name) throw new FlowError('no_steps', 'a flow needs a name');

  if (!FLOW_TRIGGERS.includes(input.trigger)) {
    throw new FlowError(
      'unknown_trigger',
      `"${input.trigger}" is not a trigger the runner fires on. Use one of: ${FLOW_TRIGGERS.join(', ')}`,
    );
  }

  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (!steps.length) {
    throw new FlowError('no_steps', 'a flow needs at least one step after the trigger');
  }

  const keywords = normaliseKeywords(input.keywords);
  if (keywords.length) {
    // Keywords only narrow an event that carries text. A template button does not, so silently
    // storing them there would make the flow look filtered while it fired on every tap.
    const textTriggers = ['trigger_whatsapp_inbound', 'trigger_whatsapp_ctwa', 'trigger_crm_lead', 'trigger_meta_ad'];
    if (!textTriggers.includes(input.trigger)) {
      throw new FlowError(
        'keywords_not_supported',
        `keywords only apply to a message-shaped trigger (${textTriggers.join(', ')}), not ${input.trigger}`,
      );
    }
    notes.push(`this flow only fires when the message contains: ${keywords.join(', ')}`);
  } else if (input.trigger === 'trigger_whatsapp_inbound' || input.trigger === 'trigger_whatsapp_ctwa') {
    notes.push(
      'no keywords were given, so this flow fires on EVERY inbound WhatsApp message for the account once it is active',
    );
  }

  const nodes: Record<string, unknown>[] = [
    {
      id: 'node_trigger',
      type: 'triggerNode',
      position: { x: ORIGIN_X, y: ORIGIN_Y },
      data: {
        title: `${name} — trigger`,
        subtitle: 'Starting step',
        triggerType: input.trigger,
        ...(input.templateName ? { templateName: input.templateName } : {}),
        ...(keywords.length ? { keywords } : {}),
        description: keywords.length ? `Fires on ${input.trigger} matching ${keywords.join(', ')}` : `Fires on ${input.trigger}`,
      },
    },
  ];

  steps.forEach((step, index) => {
    const x = ORIGIN_X + SPACING_X * (index + 1);
    const id = `node_${index + 1}_${step.kind}`;

    /**
     * Timing in front of a step.
     *
     * Two different clocks, and the difference is the whole point of a sequence:
     *   delayMinutes       — after the trigger, or after the step before it.
     *   beforeEventMinutes — before the appointment itself (only meaningful on the booking trigger).
     * Both are written as their own delay node because that is the shape the planner already reads,
     * and `minutes` survives the round trip through storage without being converted to seconds.
     */
    const delay = Number(step.delayMinutes ?? 0);
    if (Number.isFinite(delay) && delay > 0) {
      if (delay > MAX_SCHEDULED_DELAY_MINUTES) {
        throw new FlowError(
          'delay_too_long',
          `step ${index + 1} waits ${Math.round(delay / 1440)} days, which is longer than this system schedules ` +
            `(${Math.round(MAX_SCHEDULED_DELAY_MINUTES / 1440)} days). Nothing that far out survives a relaunch intact.`,
        );
      }
      nodes.push({
        id: `delay_before_${index + 1}`,
        type: 'delayNode',
        position: { x: ORIGIN_X + SPACING_X * (index + 0.5), y: ORIGIN_Y },
        data: { title: `Wait ${formatDelay(delay)}`, minutes: delay },
      });
    }

    const beforeEvent = Number(step.beforeEventMinutes ?? NaN);
    if (Number.isFinite(beforeEvent)) {
      if (input.trigger !== 'trigger_booking_created') {
        throw new FlowError(
          'needs_booking_trigger',
          `step ${index + 1} is timed against the appointment, which only the "appointment booked" trigger ` +
            `provides. Either use that trigger, or give this step a delayMinutes instead.`,
        );
      }
      nodes.push({
        id: `before_event_${index + 1}`,
        type: 'delayNode',
        position: { x: ORIGIN_X + SPACING_X * (index + 0.5), y: ORIGIN_Y },
        data: { title: `${formatDelay(Math.abs(beforeEvent))} before the appointment`, beforeEventMinutes: beforeEvent },
      });
    }

    if (step.kind === 'template') {
      const tpl = String(step.templateName ?? '').trim();
      if (!tpl) {
        throw new FlowError('no_template', `step ${index + 1} sends a template but names none`);
      }
      nodes.push({
        id,
        type: 'whatsappTemplateNode',
        position: { x, y: ORIGIN_Y },
        data: { title: `Template ${index + 1}`, templateName: tpl, ...(step.text ? { message: String(step.text) } : {}) },
      });
      return;
    }

    if (step.kind === 'message') {
      const message = String(step.text ?? '').trim();
      if (!message) throw new FlowError('empty_message', `step ${index + 1} is a message with no text`);
      nodes.push({
        id,
        type: 'whatsappMessageNode',
        position: { x, y: ORIGIN_Y },
        data: { title: `Message ${index + 1}`, message },
      });
      return;
    }

    if (step.kind === 'call') {
      nodes.push({
        id,
        type: 'aiCallNode',
        position: { x, y: ORIGIN_Y },
        data: {
          title: `AI call ${index + 1}`,
          // `description` is the key the runner reads (planFromFlowDescription in
          // lib/flows/start.ts). It used to be written as `script`, which nothing
          // read, so the instructions the owner gave for the call were silently
          // dropped and the call was queued with a null script. Keep both keys:
          // `description` is the one that works, `script` is what the stored
          // shape has always looked like from outside.
          ...(step.text ? { description: String(step.text), script: String(step.text) } : {}),
        },
      });
      return;
    }

    if (step.kind === 'handoff') {
      // "Transfer to a human" used to be a node type nothing executed. It is a CRM handoff now:
      // no dial, no message, no approval needed — so a flow can end by handing over instead of
      // pretending to.
      const note = String(step.text ?? '').trim() || 'A human needs to take this conversation over.';
      nodes.push({
        id,
        type: 'action_ai_call_transfer',
        position: { x, y: ORIGIN_Y },
        data: { title: 'Transfer to a human', note },
      });
      return;
    }

    if (step.kind === 'wait') {
      const seconds = Math.floor(Number(step.seconds ?? 0));
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new FlowError('delay_too_long', `step ${index + 1} is a wait with no length`);
      }
      if (seconds > MAX_FLOW_DELAY_SECONDS) {
        // The runner caps this at 10 s, so a longer value would be silently clamped and
        // the flow would fire far earlier than the owner asked. Refuse and say why.
        throw new FlowError(
          'delay_too_long',
          `a "wait ${seconds}s" cannot be a delay step: the flow runner caps a delay at ` +
            `${MAX_FLOW_DELAY_SECONDS} seconds, so it would fire almost immediately instead of when you meant. ` +
            'A longer wait belongs on a schedule (a follow-up due at a real time), not inside the flow.',
        );
      }
      nodes.push({
        id,
        type: 'delayNode',
        position: { x, y: ORIGIN_Y },
        data: { title: `Wait ${seconds}s`, seconds },
      });
      return;
    }

    throw new FlowError('unknown_step', `step ${index + 1} is a "${(step as FlowStep).kind}", which is not a step`);
  });

  if (!nodes.some((node) => node.type !== 'triggerNode')) {
    throw new FlowError('no_steps', 'a flow needs at least one action, not only a trigger');
  }

  notes.push(
    `a wait longer than ${MAX_FLOW_DELAY_SECONDS}s inside the flow is not an inline delay — use delayMinutes on ` +
      'the step, which is written to the schedule and fires at the real time you asked for',
  );

  return {
    title: `Flow: ${name}`,
    description: JSON.stringify({
      name,
      isActive: input.isActive !== false,
      ...(input.templateName ? { templateName: input.templateName } : {}),
      trigger: {
        type: input.trigger,
        ...(input.templateName ? { templateName: input.templateName } : {}),
        // Stored on the trigger, not on the steps: "only this campaign" is a property of the event.
        ...(input.campaignId ? { campaignId: String(input.campaignId) } : {}),
        ...(keywords.length ? { keywords } : {}),
        config: keywords.length ? { keywords } : {},
      },
      nodes,
    }),
    isActive: input.isActive !== false,
    nodeCount: nodes.length,
    notes,
  };
}

/** The agent-facing tools. Creating is the point; listing already existed. */
export function createFlowAuthoringTools(supabase: SupabaseClient, userId: string) {
  return {
    create_flow: tool({
      description:
        'Create a WhatsApp or calling automation flow that the flow runner will actually execute. ' +
        'Give it a name, one trigger from the supported list, and an ordered list of steps ' +
        '(message / call / wait / handoff). ' +
        'TIMING: a step may carry delayMinutes (this step fires that long AFTER the one before — "then the brochure ' +
        'in 2 days" is delayMinutes: 2880), or beforeEventMinutes when the trigger is trigger_booking_created ' +
        '(1440 = 24 hours before the appointment, 30 = half an hour before). Long waits are safe: each wait becomes ' +
        'a scheduled row with its own real time, not a held connection, and a step whose appointment-relative ' +
        'moment has already passed is skipped rather than sent late. Prefer kind "template" with an approved ' +
        'templateName for anything more than a day out: outside the 24-hour reply window a template is the only ' +
        'thing Meta will deliver. Pass campaignId when the owner means "only leads from the campaign I just ' +
        'launched". Name only templates that really exist and are approved: check them first with ' +
        'nobogent_whatsapp_list_templates (or whatsapp_template_status). A template that is not approved on the ' +
        'account is refused by Meta at send time — a day later, and in front of a real customer. ' +
        'For an inbound-message trigger, pass keywords so the flow only answers the messages it is for; ' +
        'without them an active flow replies to EVERY inbound message. End with a handoff step when a person ' +
        'should take over — it records the handoff in the CRM and messages nobody. ' +
        'Check list_automation_flows first — a duplicate flow and an existing one both firing is worse ' +
        'than no flow.',
      inputSchema: z.object({
        name: z.string().describe('Short human name, e.g. "Course enquiry follow-up"'),
        trigger: z
          .enum(FLOW_TRIGGERS as unknown as [string, ...string[]])
          .describe('What starts the flow. Must be a trigger the runner matches on.'),
        templateName: z.string().optional().describe('For a button/template trigger, the template name'),
        keywords: z
          .array(z.string())
          .optional()
          .describe(
            'Words that must appear in the message for the flow to fire (inbound/CTWA/CRM/ad triggers). ' +
              'Leave empty only if the flow really should answer every message.'
          ),
        steps: z
          .array(
            z.object({
              kind: z
                .enum(['template', 'message', 'call', 'wait', 'handoff'])
                .describe('template | message | call | wait | handoff'),
              templateName: z
                .string()
                .optional()
                .describe('For kind "template": the approved Meta template to send'),
              text: z
                .string()
                .optional()
                .describe('message text, a note for the AI caller, or why a human takes over (handoff)'),
              seconds: z.number().optional().describe('for kind "wait": seconds, at most 10'),
              delayMinutes: z
                .number()
                .optional()
                .describe('wait this long BEFORE this step: 120 = 2 hours, 2880 = 2 days, 10080 = a week'),
              beforeEventMinutes: z
                .number()
                .optional()
                .describe(
                  'time this step against the appointment (booking trigger only): 1440 = 24h before, 30 = 30min before'
                ),
            }),
          )
          .min(1)
          .describe('Ordered steps after the trigger'),
        isActive: z.boolean().optional().describe('Whether the flow starts firing immediately'),
      }),
      execute: async (input: any) => {
        try {
          const built = buildFlow({
            name: input.name,
            trigger: input.trigger as FlowTrigger,
            ...(input.templateName ? { templateName: input.templateName } : {}),
            ...(input.campaignId ? { campaignId: String(input.campaignId) } : {}),
            ...(input.keywords ? { keywords: input.keywords } : {}),
            steps: (input.steps ?? []) as FlowStep[],
            // Flows start PAUSED. Writing one is authoring; making it live is a decision that reaches
            // customers, and it belongs to the owner in the UI — not to a model mid-conversation.
            isActive: input.isActive === true,
          });

          // Static feasibility BEFORE anything is written: an event that cannot yield a phone number
          // cannot drive a WhatsApp message or a call, however the flow is worded. This is the check
          // that refuses "send a WhatsApp when someone comments" instead of saving it to fail later.
          const wantedActions = Array.from(
            new Set(
              (input.steps ?? [])
                .map((s: any) => (s?.kind === 'message' ? 'message' : s?.kind === 'call' ? 'call' : ''))
                .filter(Boolean)
            )
          ) as string[];
          const impossible = validateAgainstTrigger(String(input.trigger), wantedActions);
          if (impossible.length) {
            return {
              success: false,
              reason: 'impossible_action',
              trigger: String(input.trigger),
              availableActions: actionsAvailableFor(String(input.trigger)),
              error: impossible.map((b) => b.message).join('\n\n'),
            };
          }

          // Two flows firing on the same trigger is worse than no flow: every matching person gets
          // both messages. The verdict comes from the trigger's IDENTITY â€” exact, repeatable â€” not
          // from matching the trigger's name inside description prose, which both missed real
          // duplicates and flagged unrelated flows.
          try {
            const { data: existing } = await supabase
              .from('automations')
              .select('id, title, is_active, description')
              .eq('user_id', userId);

            const candidate: FlowIdentity = {
              name: input.name,
              title: built.title,
              triggerType: String(input.trigger),
              triggerKey: input.templateName ? String(input.templateName) : null,
            };

            const described: FlowIdentity[] = (existing ?? []).map((row: any) => {
              const raw = String(row.description || '');
              let triggerType = '';
              let triggerKey: string | null = null;
              const brace = raw.indexOf('{');
              if (brace >= 0) {
                try {
                  const parsed = JSON.parse(raw.slice(brace));
                  if (parsed?.trigger?.type) triggerType = String(parsed.trigger.type);
                  if (parsed?.trigger?.templateName) triggerKey = String(parsed.trigger.templateName);
                } catch {}
              }
              return {
                id: row.id,
                name: String(row.title || ''),
                title: row.title,
                triggerType,
                triggerKey,
                isActive: row.is_active === true,
              };
            });

            // A row whose description we cannot parse still counts by title, so renaming and
            // recreating cannot slip a second flow past the check.
            const byTitle = described.find(
              (f) => String(f.title || '').toLowerCase() === String(built.title || '').toLowerCase()
            );
            const { conflict } = findTriggerConflict(described.filter((f) => f.triggerType), candidate);
            const clash = conflict ?? byTitle ?? null;

            if (clash) {
              return {
                success: false,
                reason: 'duplicate_flow',
                existingFlowId: clash.id,
                active: clash.isActive === true,
                trigger: identityKey(candidate),
                error: describeConflict(candidate, clash),
              };
            }
          } catch {
            // A failed duplicate check must not block authoring; the flow is paused regardless.
          }

          const { data, error } = await supabase
            .from('automations')
            .insert({
              user_id: userId,
              title: built.title,
              description: built.description,
              is_active: built.isActive,
              stats: JSON.stringify({ runs: 0, completed: 0 }),
            })
            .select('id, title, is_active')
            .single();

          if (error) {
            return {
              success: false,
              error: `the flow was built but the database refused it: ${error.message}`,
              built: { title: built.title, nodeCount: built.nodeCount },
            };
          }

          return {
            success: true,
            flowId: data?.id ?? null,
            title: built.title,
            active: built.isActive,
            nodeCount: built.nodeCount,
            notes: built.notes,
            message:
              `Created "${built.title}" with ${built.nodeCount} node(s)` +
              (built.isActive
                ? ', active now.'
                : ', currently PAUSED â€” the owner turns it on in dashboard/flows when they are ready.'),
          };
        } catch (error: any) {
          if (error instanceof FlowError) {
            return { success: false, reason: error.reason, error: error.message };
          }
          return { success: false, error: String(error?.message ?? error) };
        }
      },
    }),

    /**
     * Legacy flows were saved without a trigger. Nothing can start them: `startFlowRun` refuses with
     * "the flow does not record which event starts it", which is the honest answer but not a fix.
     * Guessing a trigger from the flow's name would be worse than refusing — the wrong event means a
     * customer gets a sequence that was written for somebody else — so the owner picks one, here.
     */
    repair_flow_trigger: tool({
      description:
        'Give a flow the trigger it is missing so it can actually fire. Flows saved before triggers were ' +
        'recorded have no trigger and can never start; this sets one and adds the trigger node the editor ' +
        'needs. It cannot invent a trigger: you must choose one from the supported list, and if the flow ' +
        'already has a different trigger this refuses unless force is true. Read the flow name and steps ' +
        'first and only choose a trigger that genuinely describes when it should run.',
      inputSchema: z.object({
        flowId: z.string().describe('The automation id from list_automation_flows'),
        trigger: z
          .enum(FLOW_TRIGGERS as unknown as [string, ...string[]])
          .describe('The event that should start this flow'),
        templateName: z.string().optional().describe('For a template-button trigger, which template starts it'),
        force: z.boolean().optional().describe('Replace a trigger the flow already records'),
      }),
      execute: async (input: any) => {
        const { data: row, error } = await supabase
          .from('automations')
          .select('id, title, description, is_active')
          .eq('id', input.flowId)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) return { success: false, error: `could not read that flow: ${error.message}` };
        if (!row) return { success: false, error: 'No such flow on this account.' };

        const raw = String((row as any).description ?? '');
        const brace = raw.indexOf('{');
        if (brace < 0) {
          return {
            success: false,
            error:
              'This flow stores no readable step data, so setting a trigger would make it fire with nothing to run. ' +
              'Recreate it with create_flow instead.',
          };
        }

        let parsed: any;
        try {
          parsed = JSON.parse(raw.slice(brace));
        } catch (parseError: any) {
          return { success: false, error: `the stored flow is not readable JSON: ${parseError?.message || parseError}` };
        }

        const existingTrigger = parsed?.trigger?.type ? String(parsed.trigger.type) : null;
        if (existingTrigger && !input.force) {
          return {
            success: false,
            reason: 'already_has_trigger',
            trigger: existingTrigger,
            message: `This flow already starts on ${existingTrigger}, so nothing was changed. Pass force to replace it.`,
          };
        }

        const nodes: any[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];
        if (!nodes.some((n) => String(n?.type) === 'triggerNode')) {
          // The editor's validate-on-publish requires a trigger node; without one the flow would be
          // given a trigger and still fail to publish, which is the confusing half-fix.
          nodes.unshift({ id: 'trigger', type: 'triggerNode', data: { triggerType: String(input.trigger) } });
        }

        const next = {
          ...parsed,
          trigger: {
            ...(parsed.trigger ?? {}),
            type: String(input.trigger),
            ...(input.templateName ? { templateName: String(input.templateName) } : {}),
            config: parsed?.trigger?.config ?? {},
          },
          nodes,
        };

        const { error: updateError } = await supabase
          .from('automations')
          .update({ description: JSON.stringify(next) })
          .eq('id', (row as any).id)
          .eq('user_id', userId);
        if (updateError) return { success: false, error: `could not save the trigger: ${updateError.message}` };

        return {
          success: true,
          flowId: (row as any).id,
          title: (row as any).title,
          trigger: String(input.trigger),
          replaced: existingTrigger,
          active: (row as any).is_active === true,
          message:
            `"${(row as any).title}" now starts on ${input.trigger}` +
            ((row as any).is_active === true
              ? '. It is active, so the next matching event will queue its steps for your approval.'
              : '. It is still paused — turn it on when you are ready.'),
        };
      },
    }),

    /**
     * The approvals queue, readable from chat. Every flow step waits for a human, so a flow whose
     * steps are queued looks exactly like a flow that did nothing unless the owner can see the queue.
     */
    list_flow_approvals: tool({
      description:
        'List the flow steps waiting for the owner to approve them, and say what each one would do. ' +
        'Use this when asked whether a flow fired, what is pending, or why nothing was sent — a flow that ' +
        'queued steps has not messaged anybody yet.',
      inputSchema: z.object({
        includeSent: z.boolean().optional().describe('Also show steps that were already sent or blocked'),
        limit: z.number().optional().describe('How many to return, default 20'),
      }),
      execute: async (input: any) => {
        const statuses: any = input?.includeSent ? ['pending_approval', 'approved', 'sending', 'delivered', 'blocked', 'failed'] : ['pending_approval'];
        const rows = await listDeliveries(supabase, userId, { status: statuses, limit: Math.min(Number(input?.limit ?? 20) || 20, 50) });
        if (!rows.length) {
          return {
            success: true,
            waiting: 0,
            message:
              'Nothing is waiting for approval. A flow step only appears here when a flow is due to message or call somebody.',
          };
        }
        return {
          success: true,
          waiting: rows.filter((d) => d.status === 'pending_approval').length,
          steps: rows.map((d) => ({
            id: d.id,
            status: d.status,
            summary: describeDelivery(d),
            channel: d.channel,
            template: d.templateName ?? undefined,
            text: d.body ?? undefined,
            trigger: d.trigger ?? undefined,
            queuedAt: d.createdAt,
            refusal: d.errorMessage ?? undefined,
          })),
          message:
            `${rows.filter((d) => d.status === 'pending_approval').length} step(s) are waiting for you. ` +
            'They are sent only after you approve them, on dashboard/flows/approvals.',
        };
      },
    }),
  };
}
