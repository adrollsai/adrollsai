import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * WhatsApp templates: the real Meta calls, in one place.
 *
 * The agent's `create_whatsapp_template` was fiction — it built an HTML mock-up, returned
 * `status: 'PENDING_APPROVAL'`, and submitted nothing. An owner read "created and prepared for Meta
 * approval" about a template that did not exist, then wondered why the broadcast could not find it.
 *
 * The genuine implementations were three copies inside HTTP routes and seeders. This module is the
 * one the agent uses, and it reports what Meta actually said: a real template id and Meta's status
 * (`PENDING` until Meta reviews it), or Meta's own error text.
 *
 * TWO THINGS META WILL REJECT, REFUSED HERE FIRST
 *   - a name that is not lowercase/underscores (Meta's rule, not ours);
 *   - more than 3 buttons, or a URL/phone button with no value.
 * A body with `{{1}}`-style variables also needs sample values, which Meta requires at creation
 * time; they are generated from the variable numbers so the template is submittable, not refused.
 */

export const GRAPH_VERSION = 'v20.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Meta's limit on buttons in one template component. */
export const MAX_TEMPLATE_BUTTONS = 3;
/** Meta truncates longer names rather than complaining. */
export const MAX_TEMPLATE_NAME = 512;

export type TemplateCategory = 'MARKETING' | 'UTILITY';
export type TemplateHeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  /** The URL, or the phone number, for the two call-to-action kinds. */
  value?: string;
}

export interface TemplateInput {
  name: string;
  category?: TemplateCategory;
  language?: string;
  headerType?: TemplateHeaderType;
  headerText?: string;
  /** Public https URL of the sample picture/clip/file, for IMAGE/VIDEO/DOCUMENT headers. */
  headerSampleUrl?: string;
  /** Set internally after the sample is uploaded — never by a caller. */
  headerHandle?: string;
  bodyText: string;
  footerText?: string;
  buttons?: TemplateButton[];
}

export interface TemplatePayload {
  name: string;
  category: TemplateCategory;
  language: string;
  components: Record<string, unknown>[];
}

export interface TemplateProblems {
  problems: string[];
}

/** Meta's naming rule, applied to whatever the caller typed. */
export function cleanTemplateName(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, MAX_TEMPLATE_NAME);
}

/**
 * Build the creation payload, or explain why it cannot be built.
 *
 * Pure: the gate can prove the rules without touching Meta, and the route and the tool submit
 * byte-identical payloads.
 */
export function buildTemplatePayload(input: TemplateInput): TemplatePayload | TemplateProblems {
  const problems: string[] = [];
  const name = cleanTemplateName(input.name);
  const bodyText = String(input.bodyText ?? '').trim();

  if (!name) problems.push('a template needs a name (lowercase letters, numbers and underscores)');
  if (!bodyText) problems.push('a template needs body text — it is the message the customer reads');
  if (bodyText.length > 1024) problems.push(`the body is ${bodyText.length} characters; Meta allows 1024`);

  const headerType = input.headerType ?? 'NONE';
  if (headerType === 'TEXT' && !String(input.headerText ?? '').trim()) {
    problems.push('a TEXT header needs its header text, or drop the header');
  }
  if (headerType === 'TEXT' && String(input.headerText ?? '').length > 60) {
    problems.push('a TEXT header is limited to 60 characters');
  }
  if ((headerType === 'IMAGE' || headerType === 'VIDEO' || headerType === 'DOCUMENT') && !String(input.headerHandle ?? '').trim()) {
    // Reached only if the upload step was skipped: a media header with no handle is refused by Meta with
    // a message nobody can act on, so it is named here instead.
    problems.push(`a ${headerType} header needs a sample file uploaded first (headerSampleUrl)`);
  }

  const rawButtons = Array.isArray(input.buttons) ? input.buttons : [];
  if (rawButtons.length > MAX_TEMPLATE_BUTTONS) {
    problems.push(`Meta allows at most ${MAX_TEMPLATE_BUTTONS} buttons; ${rawButtons.length} were given`);
  }
  const buttons = rawButtons.slice(0, MAX_TEMPLATE_BUTTONS).map((button) => {
    const text = String(button?.text ?? '').trim();
    if (!text) problems.push('every button needs text');
    if (text.length > 25) problems.push(`button text "${text.slice(0, 25)}…" is longer than Meta's 25 characters`);
    if (button?.type === 'URL') {
      const value = String(button.value ?? '').trim();
      if (!value) problems.push(`the URL button "${text}" has no url`);
      return { type: 'URL', text, url: value.startsWith('http') ? value : `https://${value}` };
    }
    if (button?.type === 'PHONE_NUMBER') {
      const digits = String(button.value ?? '').replace(/[^\d+]/g, '');
      if (!digits) problems.push(`the phone button "${text}" has no phone number`);
      return { type: 'PHONE_NUMBER', text, phone_number: digits.startsWith('+') ? digits : `+${digits}` };
    }
    return { type: 'QUICK_REPLY', text };
  });

  if (problems.length) return { problems };

  const components: Record<string, unknown>[] = [];
  if (headerType === 'TEXT') {
    components.push({ type: 'HEADER', format: 'TEXT', text: String(input.headerText).trim() });
  } else if (headerType === 'IMAGE' || headerType === 'VIDEO' || headerType === 'DOCUMENT') {
    /**
     * Meta wants the sample as a handle from the Resumable Upload API, not a URL. The handle was obtained
     * before this function ran; it goes in `example.header_handle`, which is what Meta reads to know what
     * kind of media the template expects.
     */
    components.push({
      type: 'HEADER',
      format: headerType,
      example: { header_handle: [String(input.headerHandle).trim()] },
    });
  }

  const bodyComponent: Record<string, unknown> = { type: 'BODY', text: bodyText };
  const variables = bodyText.match(/\{\{(\d+)\}\}/g);
  if (variables?.length) {
    const indices = Array.from(new Set(variables.map((m) => Number(m.replace(/\D/g, ''))))).sort((a, b) => a - b);
    // Meta requires a sample value per variable at creation time; without them it refuses the
    // whole template. The samples are placeholders in the review, not in the sent message.
    bodyComponent.example = { body_text: [indices.map((i) => `Sample ${i}`)] };
  }
  components.push(bodyComponent);

  if (input.footerText?.trim()) {
    components.push({ type: 'FOOTER', text: String(input.footerText).trim().slice(0, 60) });
  }
  if (buttons.length) components.push({ type: 'BUTTONS', buttons });

  return {
    name,
    category: (input.category ?? 'MARKETING') === 'UTILITY' ? 'UTILITY' : 'MARKETING',
    language: String(input.language ?? 'en_US'),
    components,
  };
}

export interface WaCredentials {
  token: string;
  wabaId: string;
  phoneNumberId: string | null;
}

/** The account's WhatsApp credentials, with the master-account fallback the other routes use. */
export async function whatsAppCredentials(supabase: SupabaseClient, userId: string): Promise<WaCredentials | null> {
  const { data } = await supabase
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_waba_id, whatsapp_phone_number_id, facebook_token, email')
    .eq('id', userId)
    .maybeSingle();

  const isMaster = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com'].includes(String((data as any)?.email ?? ''));
  const token =
    String((data as any)?.whatsapp_access_token || (data as any)?.facebook_token || (isMaster ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : '') || '').trim();
  const wabaId = String((data as any)?.whatsapp_waba_id || (isMaster ? process.env.DEV_WHATSAPP_WABA_ID : '') || '').trim();
  const phoneNumberId = String((data as any)?.whatsapp_phone_number_id ?? '').trim() || null;

  if (!token || !wabaId) return null;
  return { token, wabaId, phoneNumberId };
}

export interface LiveTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  id?: string;
  rejectedReason?: string | null;
}

/** What Meta has on file for this WABA — the truth behind "do we have a template for that?". */
export async function listWhatsAppTemplates(supabase: SupabaseClient, userId: string): Promise<LiveTemplate[]> {
  const credentials = await whatsAppCredentials(supabase, userId);
  if (!credentials) return [];

  const res = await fetch(
    `${GRAPH}/${credentials.wabaId}/message_templates?fields=id,name,status,category,language,rejected_reason&limit=250`,
    { headers: { Authorization: `Bearer ${credentials.token}` } }
  );
  const body: any = await res.json().catch(() => ({}));
  if (body?.error) throw new Error(`Meta: ${body.error.message}`);
  return (body?.data ?? []).map((t: any) => ({
    id: t.id ? String(t.id) : undefined,
    name: String(t.name ?? ''),
    language: String(t.language ?? ''),
    status: String(t.status ?? 'UNKNOWN').toUpperCase(),
    category: String(t.category ?? ''),
    rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null,
  }));
}

/** Is this template approved and therefore sendable? Answers with the status either way. */
export async function templateStatus(
  supabase: SupabaseClient,
  userId: string,
  templateName: string
): Promise<{ known: boolean; approved: boolean; status: string; language: string | null }> {
  const wanted = String(templateName ?? '').trim();
  const templates = await listWhatsAppTemplates(supabase, userId).catch(() => []);
  const match = templates.find((t) => t.name === wanted);
  if (!match) return { known: false, approved: false, status: 'NOT_FOUND', language: null };
  return { known: true, approved: match.status === 'APPROVED', status: match.status, language: match.language || null };
}

export interface CreateTemplateResult {
  ok: boolean;
  name?: string;
  templateId?: string;
  /** Meta's own verdict: PENDING until it reviews the template. */
  status?: string;
  category?: string;
  language?: string;
  problems?: string[];
  error?: string;
}

/**
 * Submit a template to Meta.
 *
 * Honest in both directions: a success reports Meta's template id and status (which is normally
/**
 * Upload a template's sample media to Meta and return the handle it gives back.
 *
 * THE TWO-STEP DANCE
 * Creating a template with an IMAGE/VIDEO/DOCUMENT header is not a single POST: Meta first opens an
 * upload session (`POST /{app-id}/uploads`), then takes the bytes (`POST /{session}` with
 * `file_offset: 0`), and only then returns the `header_handle` the template payload can carry. Skipping
 * it is why media templates could be sent but never created from this product.
 */
async function uploadTemplateHeaderSample(
  credentials: { token: string; wabaId: string },
  sampleUrl: string,
  headerType: 'IMAGE' | 'VIDEO' | 'DOCUMENT'
): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  if (!sampleUrl) {
    return { ok: false, error: `A ${headerType} header needs a sample file: give a public https URL.` };
  }
  if (!/^https:\/\//i.test(sampleUrl)) {
    return { ok: false, error: `The sample must be a public https URL; got "${sampleUrl.slice(0, 60)}".` };
  }

  // Meta's limits, stated up front rather than discovered by rejection.
  const LIMIT_MB = headerType === 'VIDEO' ? 16 : headerType === 'IMAGE' ? 5 : 100;
  const defaultType = headerType === 'IMAGE' ? 'image/jpeg' : headerType === 'VIDEO' ? 'video/mp4' : 'application/pdf';

  let bytes: ArrayBuffer;
  let contentType = defaultType;
  try {
    const fileRes = await fetch(sampleUrl);
    if (!fileRes.ok) {
      return { ok: false, error: `Could not fetch the sample (${fileRes.status}) from ${sampleUrl}.` };
    }
    const declared = fileRes.headers.get('content-type');
    if (declared) contentType = declared.split(';')[0];
    bytes = await fileRes.arrayBuffer();
  } catch (e: any) {
    return { ok: false, error: `Could not download the sample: ${e?.message || e}` };
  }

  if (!bytes.byteLength) return { ok: false, error: 'The sample file is empty.' };
  if (bytes.byteLength > LIMIT_MB * 1024 * 1024) {
    return {
      ok: false,
      error: `The sample is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB; Meta allows ${LIMIT_MB}MB for a ${headerType} header.`,
    };
  }

  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '';
  if (!appId) return { ok: false, error: 'META_APP_ID is not configured, so Meta cannot open an upload session.' };

  let sessionId = '';
  try {
    const startRes = await fetch(
      `${GRAPH}/${appId}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(contentType)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${credentials.token}` } }
    );
    const startBody: any = await startRes.json().catch(() => ({}));
    if (startBody?.error || !startBody?.id) {
      return {
        ok: false,
        error: `Meta refused the upload session: ${startBody?.error?.message || `HTTP ${startRes.status}`}`,
      };
    }
    sessionId = String(startBody.id);
  } catch (e: any) {
    return { ok: false, error: `Could not open the upload session: ${e?.message || e}` };
  }

  try {
    const pushRes = await fetch(`${GRAPH}/${sessionId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/octet-stream',
        file_offset: '0',
      },
      body: Buffer.from(bytes),
    });
    const pushBody: any = await pushRes.json().catch(() => ({}));
    const handle = pushBody?.h;
    if (pushBody?.error || !handle) {
      return {
        ok: false,
        error: `Meta refused the sample upload: ${pushBody?.error?.message || `HTTP ${pushRes.status}`}`,
      };
    }
    return { ok: true, handle: String(handle) };
  } catch (e: any) {
    return { ok: false, error: `Could not upload the sample: ${e?.message || e}` };
  }
}

/**
 * Create a template at Meta — text or media header.
 *
 * PENDING, not approved — approval is Meta's decision and can take minutes to a day), and a refusal
 * carries Meta's own words.
 */
export async function createWhatsAppTemplate(
  supabase: SupabaseClient,
  userId: string,
  input: TemplateInput
): Promise<CreateTemplateResult> {
  const credentials = await whatsAppCredentials(supabase, userId);
  if (!credentials) {
    return {
      ok: false,
      error:
        'WhatsApp is not connected for this account (no access token / WABA id), so there is nothing to ' +
        'create the template on. Connect the WABA in settings first.',
    };
  }

  /**
   * MEDIA HEADERS NEED A UPLOADED SAMPLE, NOT A URL.
   *
   * Meta will not accept `example: { header_image_url }` when creating a template; a media header needs a
   * `header_handle` minted by the Resumable Upload API. That is the whole reason image and video templates
   * could be sent but never created from here: the payload builder only knew TEXT.
   *
   * So the sample is resolved BEFORE the payload is built: fetch the public URL the owner gave us, push
   * the bytes to Meta, and put the returned handle into the example. If that fails, creation fails with
   * Meta's own words rather than silently producing a text template.
   */
  let resolvedInput: TemplateInput = input;
  if (input.headerType && input.headerType !== 'NONE' && input.headerType !== 'TEXT') {
    const sampleUrl = String(input.headerSampleUrl || '').trim();
    const upload = await uploadTemplateHeaderSample(credentials, sampleUrl, input.headerType);
    if (!upload.ok) return { ok: false, name: cleanTemplateName(input.name), error: upload.error };
    resolvedInput = { ...input, headerHandle: upload.handle };
  }

  const built = buildTemplatePayload(resolvedInput);
  if ('problems' in built) return { ok: false, problems: built.problems };

  try {
    const res = await fetch(`${GRAPH}/${credentials.wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(built),
    });
    const body: any = await res.json().catch(() => ({}));
    if (body?.error) {
      return {
        ok: false,
        name: built.name,
        error: `${body.error.message || 'Meta refused the template'}${body.error.code ? ` (code ${body.error.code})` : ''}`,
      };
    }
    if (!res.ok) {
      return { ok: false, name: built.name, error: `Meta returned ${res.status} without a template id.` };
    }
    return {
      ok: true,
      name: built.name,
      templateId: body?.id ? String(body.id) : undefined,
      status: String(body?.status ?? 'PENDING').toUpperCase(),
      category: String(body?.category ?? built.category),
      language: String(body?.language ?? built.language),
    };
  } catch (error: any) {
    return { ok: false, name: built.name, error: String(error?.message || error) };
  }
}
