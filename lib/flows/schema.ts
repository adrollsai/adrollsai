/**
 * Single source of truth for what a flow node is and whether anything runs it.
 *
 * The builder UI can emit ~75 node type strings; `utils/whatsapp/flow-runner.ts`
 * executes a much smaller set. Anything in between is a node the user can add,
 * wire up, save, publish — and that silently does nothing when the trigger
 * fires. That is the core robustness bug: the canvas is not validated against
 * the engine, so an unexecutable flow looks perfectly healthy.
 *
 * This module declares the contract in one place so the UI, the executor and
 * (later) the agent-facing tools can agree. Keep it in step with flow-runner.
 */

export type NodeSupport =
  /** flow-runner has a real handler. */
  | 'executed'
  /** Recognised as a trigger; matched by shouldTriggerFlow. */
  | 'trigger'
  /** Accepted by the canvas but has NO handler — it will be skipped silently. */
  | 'unsupported';

export interface NodeSpec {
  /** Primary type string written by the canvas. */
  type: string;
  /** Further type strings the executor accepts for the same node. */
  aliases?: string[];
  label: string;
  category: 'trigger' | 'message' | 'logic' | 'crm' | 'notify' | 'integration' | 'delay';
  support: NodeSupport;
  /** Config keys that actually affect execution. */
  config?: string[];
  note?: string;
}

/**
 * Derived from the `nodeType === '...'` branches in
 * utils/whatsapp/flow-runner.ts. If you add a handler there, add it here.
 */
export const NODE_SPECS: NodeSpec[] = [
  // ── triggers (matched by shouldTriggerFlow) ──────────────────────────────
  { type: 'trigger_meta_ad', label: 'Meta ad / click-to-WhatsApp', category: 'trigger', support: 'trigger', config: ['campaignId'] },
  { type: 'trigger_whatsapp_ctwa', label: 'WhatsApp CTWA', category: 'trigger', support: 'trigger', config: ['campaignId'] },
  { type: 'trigger_whatsapp_inbound', label: 'Inbound WhatsApp message', category: 'trigger', support: 'trigger', config: ['keywords', 'keyword'] },
  { type: 'trigger_ig_comment', label: 'Instagram comment', category: 'trigger', support: 'trigger' },
  { type: 'trigger_fb_comment', label: 'Facebook comment', category: 'trigger', support: 'trigger' },
  { type: 'trigger_ig_dm', label: 'Instagram DM', category: 'trigger', support: 'trigger' },
  { type: 'trigger_fb_messenger', label: 'Messenger DM', category: 'trigger', support: 'trigger' },
  { type: 'trigger_crm_lead', label: 'New CRM lead', category: 'trigger', support: 'trigger' },
  { type: 'trigger_whatsapp_template_button', label: 'Template / quick-reply button', category: 'trigger', support: 'trigger', config: ['templateName', 'buttons', 'button_text', 'button_id'] },
  { type: 'triggerNode', label: 'Trigger (node wrapper)', category: 'trigger', support: 'trigger', note: 'Wrapper used by the canvas; the real trigger type lives in data.triggerType.' },

  // ── messages ────────────────────────────────────────────────────────────
  { type: 'whatsappMessageNode', label: 'Send WhatsApp message', category: 'message', support: 'executed', config: ['message'] },
  { type: 'action_whatsapp_msg', aliases: ['action_send_whatsapp'], label: 'Send WhatsApp message (with CTA)', category: 'message', support: 'executed', config: ['message', 'body', 'buttonText', 'buttonUrl'] },
  { type: 'inventoryDeliveryNode', label: 'Deliver inventory / catalogue', category: 'message', support: 'executed', config: ['message'] },
  { type: 'emailNode', aliases: ['action_send_email', 'action_email'], label: 'Send email', category: 'message', support: 'executed', config: ['subject', 'recipient', 'customEmail'] },
  { type: 'aiAgentNode', label: 'AI agent reply (DeepSeek)', category: 'message', support: 'executed', config: ['instructions', 'prompt', 'message'], note: 'Drafts a reply with DeepSeek and sends it on WhatsApp.' },

  // ── logic ───────────────────────────────────────────────────────────────
  { type: 'action_condition', aliases: ['conditionNode', 'action_if_else'], label: 'Condition / branch', category: 'logic', support: 'executed', config: ['field', 'operator', 'value', 'trueHandle', 'falseHandle'], note: 'Evaluated during planning; only the matching branch runs.' },
  { type: 'action_split_traffic', aliases: ['splitNode', 'action_ab_split'], label: 'A/B split', category: 'logic', support: 'executed', config: ['percentA'], note: 'Deterministic per lead id, so a prospect never sees both variants.' },
  { type: 'action_qualify', aliases: ['qualifyNode', 'action_qualification'], label: 'Qualify / score', category: 'logic', support: 'executed', config: ['questions', 'passScore'], note: 'Scores answers, persists qualification_score, and can route passed/failed.' },

  // ── CRM ─────────────────────────────────────────────────────────────────
  { type: 'crmStageNode', aliases: ['action_crm_stage'], label: 'Move CRM stage', category: 'crm', support: 'executed', config: ['stage', 'assignAgent'] },
  { type: 'tagNode', aliases: ['action_add_tag'], label: 'Add tag', category: 'crm', support: 'executed', config: ['tag', 'tags'] },
  { type: 'action_remove_tag', label: 'Remove tag', category: 'crm', support: 'executed', config: ['tag', 'tags'] },
  { type: 'action_update_field', label: 'Update lead field', category: 'crm', support: 'executed', config: ['field', 'value'] },
  { type: 'action_assign_agent', aliases: ['assign_agent'], label: 'Assign to agent', category: 'crm', support: 'executed', config: ['agent'] },

  // ── notify ──────────────────────────────────────────────────────────────
  { type: 'notifyNode', aliases: ['action_notify_team', 'action_notify_admin'], label: 'Notify the team', category: 'notify', support: 'executed', config: ['title', 'body', 'message'] },
  { type: 'actionNode', label: 'Multi-action', category: 'notify', support: 'executed', note: 'Handles notify_admin, crm_stage and add_tag sub-actions.', config: ['actions'] },

  // ── calls ───────────────────────────────────────────────────────────────
  { type: 'aiCallNode', aliases: ['action_ai_call'], label: 'AI phone call', category: 'integration', support: 'executed', note: 'Calls triggerOutboundCall immediately when the flow runs.' },
  {
    type: 'action_ai_call_transfer',
    label: 'Transfer to human',
    category: 'integration',
    support: 'executed',
    config: ['agent', 'assignAgent', 'note'],
    note:
      'Records the handoff in the CRM — assigns the lead to an agent (or writes a note that a human must take over). ' +
      'It dials nobody and messages nobody, so it needs no approval and cannot reach a customer.',
  },
  {
    type: 'action_follow_up',
    label: 'Schedule follow-up',
    category: 'integration',
    support: 'executed',
    config: ['after_hours', 'after_minutes', 'next_followup', 'note'],
    note:
      'Writes the lead follow-up schedule (next_action_due_at / next_followup) so the follow-up engine ' +
      'picks it up. Do NOT put the wait in a delay node - the executor caps those at 10 seconds.',
  },

  // ── integrations ────────────────────────────────────────────────────────
  { type: 'customApiNode', aliases: ['action_webhook'], label: 'Webhook / custom API', category: 'integration', support: 'executed', config: ['url', 'method', 'headers'] },
  { type: 'custom_webhook', label: 'Webhook (legacy type)', category: 'integration', support: 'executed', config: ['url', 'method'], note: 'Legacy spelling, handled like customApiNode.' },
  {
    type: 'ai_deepseek',
    label: 'AI (DeepSeek) step',
    category: 'integration',
    support: 'executed',
    config: ['prompt', 'description'],
    note:
      'Writes the copy for the step that follows it. The text is generated at approval time, not before, ' +
      'so no model is paid for a message nobody approved and the reviewer sees the exact words that will send.',
  },

  // ── channel replies ─────────────────────────────────────────────────────
  { type: 'action_ig_comment_reply', label: 'Reply to IG comment', category: 'message', support: 'unsupported', note: 'This deployment has no Instagram messaging credentials (no IG account id and page token wired into a sender), so a send would fail at runtime. It is blocked at validation instead of failing silently later.' },
  { type: 'action_ig_send_dm', label: 'Send IG DM', category: 'message', support: 'unsupported', note: 'This deployment has no Instagram messaging credentials, so a DM would fail at runtime. Blocked at validation instead.' },
  { type: 'action_ig_card', label: 'IG card', category: 'message', support: 'unsupported', note: 'An IG card is a DM with structured content; with no Instagram messaging credentials wired there is nothing to send it through.' },
  { type: 'action_fb_comment_reply', label: 'Reply to FB comment', category: 'message', support: 'unsupported', note: 'Comment replies need pages_manage_engagement plus a wired sender; this deployment has neither, so the step is blocked rather than silently skipped.' },
  { type: 'action_fb_send_messenger', label: 'Send Messenger message', category: 'message', support: 'unsupported', note: 'Messenger sends need pages_messaging plus a wired sender; this deployment has neither, so the step is blocked rather than silently skipped.' },
  {
    type: 'action_whatsapp_interactive',
    label: 'WhatsApp interactive message',
    category: 'message',
    support: 'executed',
    config: ['message', 'body', 'buttons'],
    note:
      'Sends a body with up to three quick-reply buttons. Like all free-form WhatsApp text it only works inside the ' +
      '24-hour service window, so an approval outside that window is refused with the reason rather than attempted.',
  },
  {
    type: 'action_whatsapp_questions',
    label: 'WhatsApp question flow',
    category: 'message',
    support: 'executed',
    config: ['question_flow_id', 'questions'],
    note:
      'Attaches a qualification question set (built in Settings > Qualifying) to the lead so the ' +
      'WhatsApp conversation asks them. Set question_flow_id to pick a specific set; leave it empty to ' +
      'use the business active set. Answers land in the lead custom_fields as qualification_answers.',
  },
  { type: 'action_add_note', label: 'Add internal note', category: 'crm', support: 'executed', config: ['note', 'message'] },

  // ── delay ───────────────────────────────────────────────────────────────
  { type: 'action_delay', aliases: ['delayNode'], label: 'Delay', category: 'delay', support: 'executed', note: 'Hard-capped at 10 SECONDS by the executor. Long waits must use the lead follow-up schedule.' },
];

const BY_TYPE = new Map<string, NodeSpec>();
for (const spec of NODE_SPECS) {
  BY_TYPE.set(spec.type, spec);
  for (const a of spec.aliases || []) BY_TYPE.set(a, spec);
}

export function specFor(nodeType: string): NodeSpec | undefined {
  return BY_TYPE.get(nodeType);
}

export interface FlowValidationIssue {
  severity: 'error' | 'warning';
  nodeId?: string;
  nodeType?: string;
  message: string;
}

/**
 * Validate a stored flow against the engine.
 *
 * `error` means the flow cannot do what the user thinks it does — an
 * unsupported node, no trigger, or a delay longer than the engine allows.
 */
export function validateFlow(graph: {
  nodes?: any[];
  xyNodes?: any[];
  edges?: any[];
}): { ok: boolean; issues: FlowValidationIssue[]; unexecutable: string[] } {
  const nodes: any[] = graph.xyNodes || graph.nodes || [];
  const issues: FlowValidationIssue[] = [];
  const unexecutable: string[] = [];

  if (nodes.length === 0) {
    issues.push({ severity: 'error', message: 'Flow has no nodes.' });
    return { ok: false, issues, unexecutable };
  }

  let hasTrigger = false;
  let hasAction = false;

  for (const n of nodes) {
    const type = String(n?.type || '');
    if (!type) continue;
    const spec = specFor(type);

    if (!spec) {
      issues.push({ severity: 'error', nodeId: n?.id, nodeType: type, message: `Unknown node type "${type}" — the engine has no handler, so this step never runs.` });
      unexecutable.push(type);
      continue;
    }

    if (spec.support === 'trigger') hasTrigger = true;
    if (spec.support === 'executed') hasAction = true;

    if (spec.support === 'unsupported') {
      issues.push({
        severity: 'error',
        nodeId: n?.id,
        nodeType: type,
        message: `"${spec.label}" is not implemented by the engine — it will be skipped silently.${spec.note ? ` ${spec.note}` : ''}`,
      });
      unexecutable.push(type);
    }

    if (spec.category === 'delay') {
      const cfg = n?.data || n?.config || {};
      const secs = cfg.seconds || (cfg.minutes ? cfg.minutes * 60 : 0) || (cfg.hours ? cfg.hours * 3600 : 0);
      if (secs > 10) {
        issues.push({
          severity: 'warning',
          nodeId: n?.id,
          nodeType: type,
          message: `Delay of ${secs}s is capped to 10s by the engine. Use the lead follow-up schedule for anything longer.`,
        });
      }
    }
  }

  if (!hasTrigger) {
    issues.push({ severity: 'error', message: 'No trigger node — this flow can never fire.' });
  }
  if (!hasAction) {
    issues.push({ severity: 'error', message: 'No executable action node — this flow fires but does nothing.' });
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues, unexecutable };
}
