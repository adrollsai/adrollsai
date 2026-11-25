/**
 * Translating what the canvas draws into what the runner can execute.
 *
 * THE GAP THIS CLOSES
 * The Flow Studio canvas and the flow runner speak different languages. The canvas saves
 * `trigger: { type: 'meta_ad' }` and nodes like `action_whatsapp_questions`; the scheduler only starts
 * on `trigger_meta_ad` and only executes a handful of node types. Nothing translated between them, so
 * a flow built in the editor saved happily, appeared in the list, and could never fire — the "dummy"
 * editor. Meta's `startFlowRun` answers "unknown trigger" and stops.
 *
 * Two honest halves:
 *   - map what maps cleanly (trigger names, the node types that mean the same thing);
 *   - REPORT what cannot run, by name, instead of saving a flow that looks right and does nothing.
 *
 * Pure: the translation is data in, data out, so the gate can prove every canvas trigger ends in a real
 * runner trigger and every runnable node survives the trip.
 */

/** Canvas trigger type → the trigger the runner actually fires on. */
const TRIGGER_MAP: Record<string, string> = {
  meta_ad: 'trigger_meta_ad',
  fb_lead_ad: 'trigger_meta_ad',
  facebook_lead_ad: 'trigger_meta_ad',
  lead_form: 'trigger_meta_ad',
  whatsapp_inbound: 'trigger_whatsapp_inbound',
  whatsapp_message: 'trigger_whatsapp_inbound',
  whatsapp_ctwa: 'trigger_whatsapp_ctwa',
  ctwa: 'trigger_whatsapp_ctwa',
  template_button: 'trigger_whatsapp_template_button',
  whatsapp_template_button: 'trigger_whatsapp_template_button',
  ig_comment: 'trigger_ig_comment',
  instagram_comment: 'trigger_ig_comment',
  fb_comment: 'trigger_fb_comment',
  facebook_comment: 'trigger_fb_comment',
  ig_dm: 'trigger_ig_dm',
  instagram_dm: 'trigger_ig_dm',
  messenger: 'trigger_fb_messenger',
  fb_messenger: 'trigger_fb_messenger',
  // Anything that is "a lead arrived from somewhere we can name" is a CRM lead event to the runner.
  crm_lead: 'trigger_crm_lead',
  campaign_audience: 'trigger_crm_lead',
  csv_list: 'trigger_crm_lead',
  csv_audience: 'trigger_crm_lead',
  portal_webhook: 'trigger_crm_lead',
  housing: 'trigger_crm_lead',
  landing_page: 'trigger_crm_lead',
  group_distribution: 'trigger_crm_lead',
  whatsapp_broadcast: 'trigger_crm_lead',
  booking: 'trigger_booking_created',
  appointment: 'trigger_booking_created',
};

/** The fallback: a lead event, which carries a phone number and can drive a message or a call. */
export const DEFAULT_RUNNER_TRIGGER = 'trigger_crm_lead';

/** Canvas node type → a node type `planFromFlowDescription` executes. */
const NODE_MAP: Record<string, string> = {
  action_whatsapp_msg: 'whatsappMessageNode',
  whatsapp_message: 'whatsappMessageNode',
  send_whatsapp: 'whatsappMessageNode',
  action_whatsapp_interactive: 'whatsappMessageNode',
  action_template: 'whatsappTemplateNode',
  whatsapp_template: 'whatsappTemplateNode',
  action_delay: 'delayNode',
  delay: 'delayNode',
  action_ai_call: 'aiCallNode',
  ai_call: 'aiCallNode',
  action_ai_call_transfer: 'action_ai_call_transfer',
  handoff: 'action_ai_call_transfer',
  // These are CRM changes, which the runner already performs as INTERNAL handoff actions: they touch
  // the record and never message anybody.
  action_crm_stage: 'action_ai_call_transfer',
  action_add_tag: 'action_ai_call_transfer',
  action_assign_agent: 'action_ai_call_transfer',
  action_add_note: 'action_ai_call_transfer',
  action_notify_team: 'action_ai_call_transfer',
};

/** Node types the canvas offers that the runner genuinely cannot execute yet. Named, never silent. */
const UNSUPPORTED_NODES: Record<string, string> = {
  action_condition: 'branching ("if this, then that") is not executed by the scheduler yet — the flow runs as a straight line',
  action_qualify: 'AI qualification is not a scheduler step yet — use an AI call step and record the answer in the CRM',
  action_ig_comment_reply: 'replying on Instagram is not a delivery channel yet — only WhatsApp and calls are',
  action_ig_send_dm: 'sending an Instagram DM is not a delivery channel yet — only WhatsApp and calls are',
};

export interface CanvasTrigger {
  type?: string;
  label?: string;
  keywords?: string[];
  campaignId?: string;
  [key: string]: any;
}

export interface CanvasNode {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  config?: Record<string, any>;
  data?: Record<string, any>;
  [key: string]: any;
}

export interface TranslationProblem {
  nodeId: string;
  nodeType: string;
  message: string;
}

export interface TranslatedFlow {
  trigger: CanvasTrigger;
  nodes: CanvasNode[];
  /** Problems that make the flow unable to run. Activation must be refused while any exist. */
  problems: TranslationProblem[];
  /** Notes worth showing that do not block activation. */
  notes: string[];
}

/** The internal action a CRM node performs, so it runs as a handoff rather than being dropped. */
function internalFor(node: CanvasNode): Record<string, any> | null {
  const config = node.config ?? node.data ?? {};
  const value = String(config.value ?? config.stage ?? config.tag ?? config.agent ?? config.text ?? config.message ?? '').trim();
  switch (node.type) {
    case 'action_crm_stage':
      return value ? { kind: 'stage', value } : null;
    case 'action_add_tag':
      return value ? { kind: 'tag', value } : null;
    case 'action_assign_agent':
      return value ? { kind: 'assign', value } : null;
    case 'action_add_note':
    case 'action_notify_team':
      return { kind: 'note', value: value || node.description || node.title || 'Noted by the automation' };
    default:
      return null;
  }
}

/** A question bot is a message with quick replies, which is exactly what the runner can send. */
function questionsToMessage(node: CanvasNode): CanvasNode {
  const config = node.config ?? node.data ?? {};
  const questions: string[] = Array.isArray(config.questions) ? config.questions.map(String) : [];
  const replies: string[] = Array.isArray(config.quickReplies) ? config.quickReplies.map(String) : [];
  const body = questions.length
    ? questions.map((question, index) => `${index + 1}. ${question}`).join('\n')
    : String(config.message || node.description || 'A few quick questions:');
  return {
    id: node.id,
    type: 'whatsappMessageNode',
    data: {
      ...(node.data ?? {}),
      message: body,
      ...(replies.length ? { buttons: replies.slice(0, 3).map((title, index) => ({ id: `qr_${index + 1}`, title })) } : {}),
    },
  };
}

/**
 * Translate one canvas flow into a runner flow.
 *
 * The output is deliberately the SAME shape `planFromFlowDescription` already reads
 * (`{ trigger: { type }, nodes: [{ type, data }] }`), so there is one execution path and the editor
 * cannot drift away from the scheduler again.
 */
export function translateCanvasFlow(input: { trigger?: CanvasTrigger; nodes?: CanvasNode[] }): TranslatedFlow {
  const rawTrigger = input.trigger ?? {};
  const mappedTrigger = TRIGGER_MAP[String(rawTrigger.type ?? '').trim().toLowerCase()];
  const notes: string[] = [];
  if (!mappedTrigger) {
    notes.push(
      `trigger "${rawTrigger.type ?? 'none'}" has no runner equivalent, so this flow listens on a new CRM lead`
    );
  }

  const trigger: CanvasTrigger = {
    ...rawTrigger,
    type: mappedTrigger ?? DEFAULT_RUNNER_TRIGGER,
    // Keep what the owner wrote; the runner uses keywords to narrow a message-shaped trigger.
    ...(rawTrigger.type && !mappedTrigger ? { builderTrigger: rawTrigger.type } : {}),
  };

  const problems: TranslationProblem[] = [];
  const nodes: CanvasNode[] = [];

  for (const node of input.nodes ?? []) {
    const type = String(node.type ?? '').trim();

    if (type === 'triggerNode' || type === 'trigger' || type.startsWith('trigger_')) {
      // Trigger nodes describe the same thing as the trigger block; the runner takes it from there.
      continue;
    }

    if (UNSUPPORTED_NODES[type]) {
      problems.push({ nodeId: String(node.id ?? '?'), nodeType: type, message: `"${node.title ?? type}": ${UNSUPPORTED_NODES[type]}` });
      continue;
    }

    if (type === 'action_whatsapp_questions') {
      nodes.push(questionsToMessage(node));
      continue;
    }

    const mapped = NODE_MAP[type];
    if (!mapped) {
      problems.push({ nodeId: String(node.id ?? '?'), nodeType: type, message: `"${node.title ?? type}" is a step the scheduler cannot run` });
      continue;
    }

    const config = node.config ?? node.data ?? {};
    if (mapped === 'action_ai_call_transfer') {
      const internal = internalFor(node);
      nodes.push({
        id: node.id,
        type: 'action_ai_call_transfer',
        data: { ...(node.data ?? {}), ...(internal ?? { note: node.description || node.title || 'A human should take this over.' }) },
      });
      continue;
    }

    if (mapped === 'whatsappMessageNode') {
      const message = String(config.message ?? config.body ?? node.description ?? '').trim();
      if (!message) {
        problems.push({ nodeId: String(node.id ?? '?'), nodeType: type, message: `"${node.title ?? type}" has no message text` });
        continue;
      }
      nodes.push({
        id: node.id,
        type: 'whatsappMessageNode',
        data: {
          ...(node.data ?? {}),
          message,
          ...(config.templateName ? { templateName: String(config.templateName) } : {}),
        },
      });
      continue;
    }

    if (mapped === 'delayNode') {
      const seconds = Number(config.seconds ?? NaN);
      const minutes = Number(config.minutes ?? config.delayMinutes ?? NaN);
      const hours = Number(config.hours ?? NaN);
      const days = Number(config.days ?? NaN);
      const beforeEventMinutes = Number(config.beforeEventMinutes ?? NaN);
      const data: Record<string, any> = { ...(node.data ?? {}) };
      if (Number.isFinite(beforeEventMinutes)) data.beforeEventMinutes = beforeEventMinutes;
      else if (Number.isFinite(minutes)) data.minutes = minutes;
      else if (Number.isFinite(hours)) data.hours = hours;
      else if (Number.isFinite(days)) data.days = days;
      else if (Number.isFinite(seconds)) data.seconds = seconds;
      else {
        problems.push({ nodeId: String(node.id ?? '?'), nodeType: type, message: `"${node.title ?? type}" is a wait with no length` });
        continue;
      }
      nodes.push({ id: node.id, type: 'delayNode', data });
      continue;
    }

    if (mapped === 'aiCallNode') {
      nodes.push({
        id: node.id,
        type: 'aiCallNode',
        data: { ...(node.data ?? {}), description: String(config.description ?? config.objective ?? node.description ?? 'Follow up with this lead.') },
      });
      continue;
    }

    if (mapped === 'whatsappTemplateNode') {
      const templateName = String(config.templateName ?? config.template ?? '').trim();
      if (!templateName) {
        problems.push({ nodeId: String(node.id ?? '?'), nodeType: type, message: `"${node.title ?? type}" sends a template but names none` });
        continue;
      }
      nodes.push({ id: node.id, type: 'whatsappTemplateNode', data: { ...(node.data ?? {}), templateName } });
      continue;
    }
  }

  if (!nodes.length && !problems.length) {
    problems.push({ nodeId: '-', nodeType: '-', message: 'the flow has no steps the scheduler can run' });
  }

  return { trigger, nodes, problems, notes };
}
