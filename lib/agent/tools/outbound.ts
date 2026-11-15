/**
 * Real outbound: a WhatsApp template message and an AI voice call.
 *
 * WHY THIS FILE EXISTS
 * Both agent tools answered with fiction. `nobogent_whatsapp_send_template` returned
 * `{ success: true, status: 'queued', message: "…queued for delivery to <phone>" }` and posted
 * nothing at all. `nobogent_voice_dispatch_call` inserted a `call_logs` row marked queued and
 * said "AI Voice agent call initiated", while no call was ever placed. An owner reads those
 * results and believes a customer was contacted. That is the worst possible launch defect: the
 * one feature whose whole purpose is reaching a person, reporting success while reaching nobody.
 *
 * Both now go through the code that actually sends:
 *   - WhatsApp: the same Graph API template call the drip engine uses, with the owner's own
 *     phone-number id and token.
 *   - Voice: `triggerOutboundCall`, the dispatcher the cron caller uses.
 *
 * EVERY RECIPIENT PASSES THROUGH outboundRecipient(), so with OUTBOUND_TEST_MODE on, a "send to
 * a customer" goes to the founder's number instead. That guard is the reason this is safe to
 * wire up at all.
 *
 * Nothing here decides whether it MAY send — the review gate does that, and both tools are in
 * REVIEW_POLICY. This module only does the sending and reports what actually happened.
 */
import { outboundRecipient } from '@/lib/automation/test-mode';

export interface WhatsAppSendResult {
  success: boolean;
  /** The number actually messaged, after the test-mode guard. */
  to?: string;
  messageId?: string;
  templateName?: string;
  error?: string;
  /** True when the guard redirected the message away from the requested number. */
  redirected?: boolean;
}

const GRAPH_VERSION = 'v20.0';

/**
 * Send one approved WhatsApp template.
 *
 * Returns the truth: a message id on success, Meta's own error text on failure. Never a
 * "queued" that means "nothing happened".
 */
export async function sendWhatsAppTemplate(params: {
  supabase: any;
  userId: string;
  phone: string;
  templateName: string;
  variables?: string[];
  languageCode?: string;
}): Promise<WhatsAppSendResult> {
  const { supabase, userId, templateName } = params;

  const requested = String(params.phone || '').replace(/\D/g, '');
  if (!requested) return { success: false, error: 'No phone number was given.' };

  const to = outboundRecipient(requested);
  if (!to) {
    return { success: false, error: 'Test mode is on but no test number is configured, so nothing was sent.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, business_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) return { success: false, error: `Could not read WhatsApp settings: ${profileError.message}` };
  if (!profile?.whatsapp_phone_number_id || !profile?.whatsapp_access_token) {
    return {
      success: false,
      error:
        'WhatsApp is not connected for this account: no phone number id / access token. ' +
        'Connect a WABA in dashboard settings, then try again.',
    };
  }

  const components =
    params.variables && params.variables.length
      ? [
          {
            type: 'body',
            parameters: params.variables.map((value) => ({ type: 'text', text: String(value) })),
          },
        ]
      : undefined;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: params.languageCode || 'en' },
      ...(components ? { components } : {}),
    },
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${profile.whatsapp_phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.whatsapp_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body: any = await res.json().catch(() => ({}));
    const redirected = to !== requested;

    if (body?.error) {
      return {
        success: false,
        to,
        templateName,
        redirected,
        error: `${body.error.message || 'Meta rejected the message'}${body.error.code ? ` (code ${body.error.code})` : ''}`,
      };
    }

    const messageId = body?.messages?.[0]?.id;
    if (!res.ok || !messageId) {
      return { success: false, to, templateName, redirected, error: `Meta returned ${res.status} without a message id.` };
    }

    // Log it the same way the rest of the product does, so the conversation shows up in the inbox.
    try {
      await supabase.from('whatsapp_messages').insert({
        message_text: `[template ${templateName}] ${(params.variables || []).join(' · ')}`.trim(),
        direction: 'outbound',
      });
    } catch {
      // Logging is best-effort; the message has already been accepted by Meta.
    }

    return { success: true, to, messageId, templateName, redirected };
  } catch (error: any) {
    return { success: false, to, templateName, error: String(error?.message || error) };
  }
}

export interface VoiceCallResult {
  success: boolean;
  callId?: string;
  callSid?: string;
  /** The number actually dialled, after the test-mode guard. */
  to?: string;
  scheduled?: boolean;
  error?: string;
}

/**
 * Place one AI voice call — the same dispatcher the cron caller uses.
 *
 * `triggerOutboundCall` works from a lead, because it needs the customer's context for the
 * script. If the number is not on a lead yet, one is created for it first, so "call this number"
 * works for a number the business has never spoken to.
 */
export async function dispatchVoiceCall(params: {
  supabase: any;
  userId: string;
  phone: string;
  objective: string;
  leadName?: string;
}): Promise<VoiceCallResult> {
  const { supabase, userId, objective } = params;
  const requested = String(params.phone || '').replace(/\D/g, '');
  if (!requested) return { success: false, error: 'No phone number was given.' };

  const to = outboundRecipient(requested);
  if (!to) return { success: false, error: 'Test mode is on but no test number is configured, so no call was placed.' };

  // Find the lead for this number, or make one so the dispatcher has a record to call.
  const digits = to.replace(/\D/g, '').slice(-10);
  const { data: existing } = await supabase
    .from('leads')
    .select('id, name, phone')
    .eq('user_id', userId)
    .like('phone', `%${digits}`)
    .limit(1)
    .maybeSingle();

  let leadId = existing?.id as string | undefined;
  if (!leadId) {
    const { data: created, error: createError } = await supabase
      .from('leads')
      .insert({
        user_id: userId,
        name: params.leadName || 'Owner test call',
        phone: to,
        source: 'agent_test',
        status: 'new',
      })
      .select('id')
      .single();
    if (createError || !created?.id) {
      return { success: false, to, error: `Could not create a lead for that number: ${createError?.message || 'unknown'}` };
    }
    leadId = created.id;
  }

  try {
    const { triggerOutboundCall } = await import('@/utils/voice-helper');
    const result = await triggerOutboundCall(supabase, leadId as string, userId, false, undefined, {
      allowAfterHours: true,
    });
    if (!result?.success) {
      return { success: false, to, error: result?.error || 'The voice provider refused the call.' };
    }
    return {
      success: true,
      callId: leadId,
      callSid: result.callSid,
      scheduled: result.scheduled,
      to,
    };
  } catch (error: any) {
    return { success: false, to, error: String(error?.message || error) };
  }
}
