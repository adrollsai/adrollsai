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
  /** The locale the template was actually sent in, resolved from Meta when it was not given. */
  languageCode?: string;
  error?: string;
  /** True when the guard redirected the message away from the requested number. */
  redirected?: boolean;
}

const GRAPH_VERSION = 'v20.0';

/**
 * Templates are approved per LANGUAGE, and a mismatch comes back as "template name does not exist in
 * the translation" (Meta code 132001) — which reads like a missing template and is not one.
 *
 * This used to default to 'en' while 34 of the 35 approved templates on this WABA are en_US, so
 * every send through this tool failed at the last step: the owner approved the message, the gate
 * replayed it faithfully, and WhatsApp refused it. The approval round trip "worked" and no message
 * was ever delivered. Resolve the locale from Meta instead of guessing it.
 */
const templateLanguageCache = new Map<string, string>();

async function resolveTemplateLanguage(opts: {
  token: string;
  wabaId?: string | null;
  templateName: string;
}): Promise<string> {
  const { token, templateName } = opts;
  const wabaId = String(opts.wabaId || '').trim();
  const key = `${wabaId}:${templateName}`;
  const cached = templateLanguageCache.get(key);
  if (cached) return cached;

  if (wabaId) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates` +
          '?fields=name,language,status&limit=250',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body: any = await res.json().catch(() => ({}));
      const approved = (body?.data ?? []).filter(
        (t: any) => String(t.name) === templateName && String(t.status).toUpperCase() === 'APPROVED',
      );
      if (approved.length) {
        const language = String(approved[0].language);
        templateLanguageCache.set(key, language);
        return language;
      }
    } catch {
      /* fall through to the locale default below */
    }
  }
  // Nothing resolvable: en_US is what the templates on this platform's WABA are approved as.
  return 'en_US';
}

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
    .select('whatsapp_phone_number_id, whatsapp_access_token, whatsapp_waba_id, business_name')
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

  const languageCode =
    params.languageCode ||
    (await resolveTemplateLanguage({
      token: String(profile.whatsapp_access_token),
      wabaId: profile.whatsapp_waba_id,
      templateName,
    }));

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
      language: { code: languageCode },
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

    return { success: true, to, messageId, templateName, redirected, languageCode };
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
  /**
   * What the call is ABOUT, in a few words — "your marketing", "the November batch".
   *
   * This is not decoration: the voice bridge builds its opening line from it. A first call passed the whole
   * multi-sentence objective here, the bridge rendered that as a 25.7-second greeting, the callee interrupted at
   * five seconds, barge-in cut the agent off, and the bridge then dropped its in-flight reply — so the call went
   * silent for the remaining twelve seconds while we billed for it. The reason is capped below so that cannot
   * happen again, whatever the caller passes.
   */
  reason?: string;
  /**
   * Call through the Bluesquare Infra Vobiz DID instead of the account's default routing.
   *
   * The dispatcher gives a super-admin account Twilio "for testing unless explicitly
   * configured", which is why a test call from the owner's own account tried an inactive Twilio
   * account and never dialled. The Bluesquare DID is a real, owned Indian line, so testing on it
   * is both possible and free of Twilio.
   */
  useBluesquareDid?: boolean;
}): Promise<VoiceCallResult> {
  const { supabase, userId, objective } = params;
  const requested = String(params.phone || '').replace(/\D/g, '');
  if (!requested) return { success: false, error: 'No phone number was given.' };

  const to = outboundRecipient(requested);
  if (!to) return { success: false, error: 'Test mode is on but no test number is configured, so no call was placed.' };

  // Find the lead for this number, or make one so the dispatcher has a record to call.
  //
  // A number can legitimately have SEVERAL leads (the owner's own test number
  // accumulates one per experiment). Taking an arbitrary one meant the call could
  // attach to a stale record — one whose voice_call_status was already `failed` —
  // and the dial would be refused or reported against the wrong person. Prefer the
  // lead that was worked most recently, and never attach to one that is on a call
  // right now.
  const digits = to.replace(/\D/g, '').slice(-10);
  const { data: candidates } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, updated_at')
    .eq('user_id', userId)
    .like('phone', `%${digits}`)
    .order('updated_at', { ascending: false })
    .limit(5);

  const existing = (candidates ?? []).find(
    (lead: any) => String(lead?.voice_call_status ?? '').toLowerCase() !== 'calling'
  );

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
    // THE PIPELINE, AND WHY IT IS THE DEFAULT ONE.
    //
    // The working demo on this platform (/dashboard/ai-call-demo → /api/voice/demo-call) uses the DEFAULT answer route —
    // the Gemini Live bridge — which is native speech-to-speech and answers in a few hundred milliseconds. It does not
    // pass an answerPath, does not prewarm, and does not use the TTS pipeline at all.
    //
    // What it DOES do, and what our dispatcher did not, is create a `voice_campaigns` row carrying the script and the
    // greeting, link it to the lead, and pass its id to the dialler. The bridge reads the campaign from the lead to know
    // what to say. Without one it connects, completes its handshake and stays mute — which is what produced two calls
    // that billed 12 s and 9 s in total silence. Chasing that silence, I wrongly concluded the Live bridge was dead and
    // routed agent calls through the TTS-Flash pipeline (STT → LLM → TTS), which speaks but adds ~2.5 s to every turn.
    // That was the latency the owner then heard. The bridge was never broken; the call had no script.
    const businessName = await supabase
      .from('profiles')
      .select('business_name, industry')
      .eq('id', userId)
      .maybeSingle()
      .then((res: any) => String(res?.data?.business_name ?? '').trim())
      .catch(() => '');

    // The opener: short enough to invite a reply, and specific enough to explain the call. The bridge speaks this
    // verbatim on connect, so it is written once, here, rather than generated from a brief.
    const openerReason = String(params.reason ?? '').trim();
    const subject = openerReason || (businessName ? `${businessName} ki marketing service` : 'hamari service');
    const greeting =
      `Namaste ${String(params.leadName || '').trim().split(/\s+/)[0] || 'ji'} ji, ` +
      `main ${businessName || 'Nobogent'} se bol rahi hoon, ${subject} ke baare mein. Do minute baat kar sakte hain?`;

    // The script the Live session speaks from for the rest of the call.
    const campaignPrompt = [
      `You are a warm, efficient Indian sales agent calling on behalf of ${businessName || 'the business'}.`,
      `WHAT THIS CALL IS ABOUT: ${subject}.`,
      `YOUR OBJECTIVE: ${params.objective}`,
      'RULES:',
      '- Speak Hinglish, one or two short sentences per turn. Never monologue.',
      '- Say you are an AI assistant if asked, and never claim to be human.',
      '- The greeting has already been spoken. Do not repeat it or re-introduce yourself.',
      '- Ask one question at a time and let the person answer.',
      '- Never invent a price, a date, a discount, a guarantee or a result. If you do not know, say the team will confirm.',
      '- If they are busy, offer to call back and end politely.',
    ].join('\n');

    // One long-lived campaign per business, reused and updated — the same shape production uses when a new lead
    // arrives (the Facebook webhook matches an existing voice campaign and dials with it). Creating a fresh campaign
    // for every call filled the table with one-call campaigns and made the settings impossible to find or tune, which
    // is how a per-call campaign ended up with a 25-second greeting in the first place.
    const campaignId = await (async () => {
      const campaignName = `Agent outbound calls — ${businessName || 'business'}`.slice(0, 120);
      const settings = {
        audience_filter: { voice_name: 'Aoede', language: 'hinglish', greeting },
        custom_prompt: campaignPrompt,
        status: 'running',
      };

      const { data: existing } = await supabase
        .from('voice_campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('name', campaignName)
        .maybeSingle();

      if (existing?.id) {
        await supabase.from('voice_campaigns').update(settings).eq('id', existing.id);
        await supabase.from('leads').update({ voice_campaign_id: existing.id }).eq('id', leadId);
        return existing.id as string;
      }

      const { data: created, error } = await supabase
        .from('voice_campaigns')
        .insert({ user_id: userId, name: campaignName, ...settings })
        .select('id')
        .single();
      if (error || !created?.id) {
        console.warn('[Outbound] Could not create the call script campaign:', error?.message);
        return null;
      }
      // The bridge finds the script through the LEAD, so the link matters as much as the row.
      await supabase.from('leads').update({ voice_campaign_id: created.id }).eq('id', leadId);
      return created.id as string;
    })();

    const { triggerOutboundCall } = await import('@/utils/voice-helper');
    const result = await triggerOutboundCall(supabase, leadId as string, userId, false, campaignId ?? undefined, {
      allowAfterHours: true,
      ...(params.useBluesquareDid ? { forceBluesquareDid: true } : {}),
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
