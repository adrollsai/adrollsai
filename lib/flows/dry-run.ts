import { DEFAULT_QUIET_HOURS, nextAllowedTime, scheduleFor, type PlannedAction, type QuietHours } from './scheduling';

/**
 * A dry run: what would actually happen, for this person, at these times.
 *
 * This is the answer to "would it work?" without sending anything. It exists because some conflicts
 * are not data conflicts — a flow that calls at 9pm and another that messages at 9pm are both
 * individually valid, and only a human looking at the timeline can say whether that is what they
 * wanted. So before anything is saved, the plan is played out against one lead and any missing
 * capability is named.
 */

export interface CapabilityFacts {
  /** Templates Meta has actually approved for this business. */
  approvedTemplates: string[];
  /** Does this lead have a usable phone number? Comment and DM triggers usually do not. */
  hasPhone: boolean;
  /** Has the platform permission this trigger needs actually been granted? */
  permissionGranted: boolean;
  quietHours?: QuietHours;
}

export interface DryRunAction extends PlannedAction {
  text?: string;
  templateName?: string | null;
}

export interface Effect {
  step: number;
  kind: 'message' | 'call' | 'handoff';
  at: string;
  note?: string;
}

export interface Blocker {
  step: number;
  code: 'no_approved_template' | 'no_phone_number' | 'permission_missing' | 'empty_message';
  message: string;
}

export interface DryRunResult {
  ok: boolean;
  effects: Effect[];
  blockers: Blocker[];
}

export function dryRun(actions: DryRunAction[], facts: CapabilityFacts, startAt: Date): DryRunResult {
  const quiet = facts.quietHours ?? DEFAULT_QUIET_HOURS;
  const blockers: Blocker[] = [];
  const effects: Effect[] = [];

  if (!facts.permissionGranted) {
    blockers.push({
      step: 0,
      code: 'permission_missing',
      message:
        'The platform permission this trigger needs has not been granted, so the flow would never fire. ' +
        'It has to be granted in the Meta app before this flow can work.',
    });
  }

  const scheduled = scheduleFor('dry-run', 'dry-run-lead', actions, startAt, quiet);

  for (const row of scheduled) {
    const action = actions.filter((a) => a.kind !== 'wait')[row.stepIndex];
    if (!action) continue;
    const deferred = row.runAt.getTime() !== startAt.getTime();
    const note = deferred ? `deferred to ${row.runAt.toISOString()} to stay inside the messaging hours` : undefined;

    if (action.kind === 'message') {
      const text = String(action.text ?? '').trim();
      if (!text) {
        blockers.push({ step: row.stepIndex + 1, code: 'empty_message', message: 'This message has no text.' });
        continue;
      }
      // A WhatsApp message needs a number exactly as much as a call does — this is the check that
      // stops a comment-triggered flow from pretending it can message someone.
      if (!facts.hasPhone) {
        blockers.push({
          step: row.stepIndex + 1,
          code: 'no_phone_number',
          message:
            'There is no phone number for this person, so a WhatsApp message cannot be sent. Triggers from a ' +
            'comment, a DM or an ad click carry no number — reply on that platform, or ask for a number first.',
        });
        continue;
      }
      const template = String(action.templateName ?? '').trim();
      const approved = facts.approvedTemplates.map((t) => t.toLowerCase());
      if (!approved.length) {
        blockers.push({
          step: row.stepIndex + 1,
          code: 'no_approved_template',
          message:
            'This business has no approved WhatsApp templates, so a message sent outside the 24-hour reply window ' +
            'would be rejected by Meta. A template has to be created and approved first.',
        });
        continue;
      }
      if (template && !approved.includes(template.toLowerCase())) {
        blockers.push({
          step: row.stepIndex + 1,
          code: 'no_approved_template',
          message: `"${template}" is not an approved template. Approved: ${facts.approvedTemplates.join(', ')}.`,
        });
        continue;
      }
      effects.push({ step: row.stepIndex + 1, kind: 'message', at: row.runAt.toISOString(), note });
      continue;
    }

    // A handoff touches the CRM, not a person: it needs no phone number, no template and no
    // approval, so it is an effect purely so the timeline shows it happened in order.
    if (action.kind === 'handoff') {
      effects.push({ step: row.stepIndex + 1, kind: 'handoff', at: row.runAt.toISOString(), note: 'a CRM handoff — no message, no call' });
      continue;
    }

    if (action.kind === 'call' && !facts.hasPhone) {
      blockers.push({
        step: row.stepIndex + 1,
        code: 'no_phone_number',
        message:
          'There is no phone number for this lead, so a call cannot be placed. Triggers that come from a comment ' +
          'or a DM do not carry a number — ask for one in the first message, or use a form or ad trigger instead.',
      });
      continue;
    }
    effects.push({ step: row.stepIndex + 1, kind: 'call', at: row.runAt.toISOString(), note });
  }

  return { ok: blockers.length === 0, effects, blockers };
}

/** A one-paragraph answer the agent can hand to a person, instead of a wall of JSON. */
export function describeDryRun(result: DryRunResult): string {
  if (!result.ok) {
    return [
      `This flow cannot work as written (${result.blockers.length} problem${result.blockers.length === 1 ? '' : 's'}):`,
      ...result.blockers.map((b) => `- Step ${b.step}: ${b.message}`),
      ...(result.effects.length ? [`Steps that would work: ${result.effects.map((e) => `${e.step} ${e.kind} at ${e.at}`).join('; ')}.`] : []),
    ].join('\n');
  }
  return `This flow works. For one lead it would: ${result.effects
    .map((e) => `${e.kind} at ${e.at}${e.note ? ` (${e.note})` : ''}`)
    .join(', then ')}.`;
}

/** Quiet-hours helper re-exported so callers do not need to import two modules. */
export { nextAllowedTime };
