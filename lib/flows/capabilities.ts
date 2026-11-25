/**
 * The foundation: what each trigger actually hands you, and what each action actually needs.
 *
 * Every impossible flow we hit came from the same blind spot — a trigger was treated as "an event"
 * when what matters is the IDENTITY it yields. A Meta ad *click* gives you nothing (no number, no
 * name); a Meta lead *form* gives you a phone number; an Instagram comment gives you a platform user
 * id and no phone at all. A WhatsApp message needs a phone number. So comment → WhatsApp is not
 * "discouraged", it is unrepresentable — and saying so here means every layer above (the flow
 * builder, the dry run, the MCP read tools) inherits the same truth instead of guessing.
 *
 * This lives in code because it is domain knowledge about Meta and WhatsApp, not a preference.
 */

/** What an event or an action needs in order to work. */
export type Identity = 'phone' | 'instagram_user' | 'facebook_user' | 'email';

export interface TriggerCapability {
  /** The trigger the runner fires on. */
  trigger: string;
  /** Said plainly, because the names are ambiguous: a lead form is not an ad click. */
  label: string;
  /** Identities this event actually carries. Empty means you learn nothing about the person. */
  yields: Identity[];
  /** Permission the Meta app must have granted for this event to fire at all. */
  requiresPermission: string | null;
  /** The honest caveat, shown to whoever is building the flow. */
  note: string;
}

const PHONE_FROM_FORM = 'leads:read';
const WHATSAPP_PERMISSION = 'whatsapp_business_messaging';

export const TRIGGER_CAPABILITIES: Record<string, TriggerCapability> = {
  trigger_meta_ad: {
    trigger: 'trigger_meta_ad',
    label: 'Meta lead form submitted (not an ad click)',
    yields: ['phone', 'email'],
    requiresPermission: PHONE_FROM_FORM,
    note:
      'This is a submitted lead form, which does carry a phone number. An ad CLICK carries nothing — if ' +
      'someone only clicked, the first thing you can do is send them to a page that asks for a number.',
  },
  trigger_whatsapp_ctwa: {
    trigger: 'trigger_whatsapp_ctwa',
    label: 'Click-to-WhatsApp conversation started',
    yields: ['phone'],
    requiresPermission: WHATSAPP_PERMISSION,
    note: 'They messaged first, so the number is known and the 24-hour reply window is open.',
  },
  trigger_whatsapp_inbound: {
    trigger: 'trigger_whatsapp_inbound',
    label: 'Inbound WhatsApp message',
    yields: ['phone'],
    requiresPermission: WHATSAPP_PERMISSION,
    note: 'Inbound messages open a 24-hour window; outside it only an approved template may be sent.',
  },
  trigger_crm_lead: {
    trigger: 'trigger_crm_lead',
    label: 'Lead added to the CRM',
    yields: ['phone', 'email'],
    requiresPermission: null,
    note: 'A phone number is only here if it was captured with the lead. Check before promising a call.',
  },
  trigger_ig_comment: {
    trigger: 'trigger_ig_comment',
    label: 'Instagram comment',
    yields: ['instagram_user'],
    requiresPermission: 'instagram_manage_comments',
    note:
      'A comment gives you an Instagram user id and no phone number. You can reply publicly or send a DM ' +
      'if that permission is granted — you cannot send a WhatsApp or place a call.',
  },
  trigger_fb_comment: {
    trigger: 'trigger_fb_comment',
    label: 'Facebook page comment',
    yields: ['facebook_user'],
    requiresPermission: 'pages_manage_engagement',
    note: 'A comment gives no phone number. Reply on the platform; a WhatsApp or a call is impossible from here.',
  },
  trigger_ig_dm: {
    trigger: 'trigger_ig_dm',
    label: 'Instagram direct message',
    yields: ['instagram_user'],
    requiresPermission: 'instagram_manage_messages',
    note: 'No phone number. Reply in the DM, and ask for a number if you need to call later.',
  },
  trigger_fb_messenger: {
    trigger: 'trigger_fb_messenger',
    label: 'Facebook Messenger message',
    yields: ['facebook_user'],
    requiresPermission: 'pages_messaging',
    note: 'No phone number. Reply in Messenger, and ask for a number if you need to call later.',
  },
  trigger_whatsapp_template_button: {
    trigger: 'trigger_whatsapp_template_button',
    label: 'Approved template button tapped',
    yields: ['phone'],
    requiresPermission: WHATSAPP_PERMISSION,
    note: 'Fires from a template you already had approved, so the number is known.',
  },
  trigger_booking_created: {
    trigger: 'trigger_booking_created',
    label: 'Appointment booked',
    yields: ['phone', 'email'],
    requiresPermission: null,
    note:
      'Fires when a booking is created in the CRM, and carries the appointment time — which is what ' +
      'makes "24 hours before the meeting" and "30 minutes before" possible. Steps timed against the ' +
      'appointment are skipped, never sent late, if their moment has already passed when the booking ' +
      'is made (a meeting booked for tomorrow morning has no 24-hour reminder left to send).',
  },
};

/** The identity each action must have to be possible at all. */
export const ACTION_REQUIRES: Record<string, Identity[]> = {
  message: ['phone'],
  call: ['phone'],
  email: ['email'],
  dm_reply: [], // platform replies need the platform user, which the trigger already provides
};

export interface CapabilityBlocker {
  action: string;
  code: 'action_needs_identity_trigger_lacks' | 'unknown_trigger' | 'unknown_action';
  message: string;
}

/** What can this trigger actually drive? Used for menus and for prompting the agent. */
export function actionsAvailableFor(trigger: string): string[] {
  const cap = TRIGGER_CAPABILITIES[trigger];
  if (!cap) return [];
  return Object.entries(ACTION_REQUIRES)
    .filter(([, needs]) => needs.every((id) => cap.yields.includes(id)))
    .map(([action]) => action);
}

/**
 * Static feasibility: can this trigger ever drive these actions? No lead needed, so it belongs
 * at creation time — long before a customer is involved.
 */
export function validateAgainstTrigger(trigger: string, actions: string[]): CapabilityBlocker[] {
  const cap = TRIGGER_CAPABILITIES[trigger];
  if (!cap) {
    return [
      {
        action: '',
        code: 'unknown_trigger',
        message: `"${trigger}" is not an event this system fires on. Known events: ${Object.keys(TRIGGER_CAPABILITIES).join(', ')}.`,
      },
    ];
  }

  const blockers: CapabilityBlocker[] = [];
  for (const action of actions) {
    if (!(action in ACTION_REQUIRES)) {
      blockers.push({ action, code: 'unknown_action', message: `"${action}" is not an action this system can take.` });
      continue;
    }
    const needs = ACTION_REQUIRES[action];
    const missing = needs.filter((id) => !cap.yields.includes(id));
    if (missing.length) {
      const alternative = actionsAvailableFor(trigger);
      blockers.push({
        action,
        code: 'action_needs_identity_trigger_lacks',
        message:
          `${cap.label} gives you ${cap.yields.join(' and ') || 'no contact details'}, so "${action}" needs ` +
          `${missing.join(' and ')} and cannot work. ${cap.note}` +
          (alternative.length ? ` Actions that DO work from this event: ${alternative.join(', ')}.` : ''),
      });
    }
  }
  return blockers;
}

/**
 * The facts a dry run needs, derived from the trigger rather than supplied by the caller — the
 * caller used to have to guess, which put the wrong answer back in the agent's hands.
 */
export function factsForTrigger(
  trigger: string,
  known: { hasPhone: boolean; approvedTemplates: string[]; permissionGranted?: boolean }
) {
  const cap = TRIGGER_CAPABILITIES[trigger];
  const canYieldPhone = !!cap?.yields.includes('phone');
  return {
    approvedTemplates: known.approvedTemplates,
    hasPhone: canYieldPhone && known.hasPhone,
    permissionGranted: known.permissionGranted ?? true,
  };
}
