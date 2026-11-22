/* eslint-disable @typescript-eslint/no-explicit-any -- business_info is an untyped JSON blob, matching the rest of the voice settings. */
/**
 * The INBOUND receptionist: a Nobogent DID that answers instead of dials.
 *
 * WHY THIS EXISTS
 * Every AI-voice path on this platform was outbound. An inbound call (a personal phone forwarding
 * to a Nobogent number) reached /api/voice/vobiz/xml with no leadId and no campaign, so the route
 * guessed a tenant from the dialled number, fell back to whichever super-admin it found first, and
 * created a lead with no script behind it. There was no way to say "this DID is mine, answer it like
 * this business" - which is the whole product for a receptionist.
 *
 * WHERE THE CONFIG LIVES
 * `profiles.business_info.inbound_receptionist`, the same JSON blob that already holds
 * `default_calling_language`, the claimed Vobiz number and the KYC data. Deliberately NOT a new
 * table: this had to work without a migration being applied by hand, and the blob is where every
 * other per-tenant voice setting already lives. When inbound volume justifies an indexed lookup,
 * this module is the only thing that has to change.
 *
 * The dialled number -> tenant lookup is therefore a LIKE scan over that blob, parsed and compared
 * exactly. With one line per business that is a cheap query; the comment above says when to upgrade.
 */

import { resolveVoiceBridgeHttpUrl } from '@/utils/app-url';
import { industryVocabulary } from '@/lib/automation/industry';

export const INBOUND_VOICES = ['Aoede', 'Kore', 'Charon', 'Fenrir', 'Puck'] as const;
export const INBOUND_LANGUAGES = [
  'hinglish',
  'english',
  'hindi',
  'punjabi',
  'kannada',
  'telugu',
  'tamil',
  'marathi',
  'gujarati',
  'bengali',
] as const;

/** The line the platform hands out when a business has not chosen one. */
export const DEFAULT_INBOUND_DID = process.env.INBOUND_TEST_DID || '+917965480539';

export interface InboundReceptionistConfig {
  /** The Nobogent DID the owner forwards their own phone to. */
  did: string;
  enabled: boolean;
  voiceName: string;
  language: string;
  /** Spoken verbatim first, then the receptionist stops and listens. */
  greeting: string;
  /** Extra instructions in the owner's own words. */
  script: string;
  /** Read the business's catalogue back when the caller asks about a product. */
  includeCatalogue: boolean;
  /** `voice_campaigns` row the media bridge reads for the greeting, language and prompt. */
  campaignId?: string | null;
  updatedAt?: string | null;
}

/** Keep a DID in one shape, so `+91 79654 0539` and `+917965480539` are the same line. */
export function normaliseDid(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

export function parseBusinessInfo(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...(raw as Record<string, any>) };
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { _raw_text: String(raw) };
  }
}

/**
 * The default receptionist for a business that has not configured one.
 *
 * Short on purpose: the greeting is one sentence ending in an offer to help, because a long
 * monologue on an inbound call is the fastest way to be hung up on. The script carries the rules
 * that keep a receptionist honest - no invented facts, no pretending to be human, hand over to a
 * person when asked.
 */
export function defaultReceptionist(input: {
  businessName?: string | null;
  industry?: string | null;
  voiceName?: string | null;
  language?: string | null;
}): InboundReceptionistConfig {
  const business = String(input.businessName || 'the business').trim();
  const vocab = industryVocabulary(input.industry || null);
  const hinglish = String(input.language || 'hinglish').toLowerCase() !== 'english';

  return {
    did: DEFAULT_INBOUND_DID,
    enabled: true,
    voiceName: INBOUND_VOICES.includes(String(input.voiceName) as any) ? String(input.voiceName) : 'Aoede',
    language: INBOUND_LANGUAGES.includes(String(input.language) as any) ? String(input.language) : 'hinglish',
    greeting: hinglish
      ? `Namaste, ${business} mein aapka swagat hai. Main aapki kaise madad kar sakti hoon?`
      : `Hello, thank you for calling ${business}. How can I help you today?`,
    script: [
      `You are the front desk for ${business}. People are calling the business's own number and it has been forwarded to you.`,
      `Find out what they need about our ${vocab.productNounPlural}, answer it from the facts below, and offer one clear next step: a site visit, a callback, or a WhatsApp with details.`,
      'Never invent prices, availability, approvals or guarantees. If you do not know something, say so and offer a callback.',
      'Never claim to be a human being. If they ask for a person, take their name and number and confirm a colleague will call back.',
    ].join(' '),
    includeCatalogue: true,
    campaignId: null,
    updatedAt: null,
  };
}

/** Compare and clamp whatever arrived from a form into a safe config. */
export function sanitiseConfig(
  raw: any,
  base: InboundReceptionistConfig
): { ok: boolean; error?: string; config: InboundReceptionistConfig } {
  const next: InboundReceptionistConfig = { ...base };

  if (raw?.did !== undefined) {
    const did = normaliseDid(raw.did);
    if (!/^\+91\d{10}$/.test(did)) {
      return { ok: false, error: 'The DID must be an Indian number in E.164 form, e.g. +917965480539.', config: next };
    }
    next.did = did;
  }

  if (raw?.voiceName !== undefined) {
    const voice = INBOUND_VOICES.find((v) => v.toLowerCase() === String(raw.voiceName).trim().toLowerCase());
    if (!voice) {
      return { ok: false, error: `Unknown voice "${raw.voiceName}". Choose one of: ${INBOUND_VOICES.join(', ')}.`, config: next };
    }
    next.voiceName = voice;
  }

  if (raw?.language !== undefined) {
    const language = INBOUND_LANGUAGES.find((l) => l === String(raw.language).trim().toLowerCase());
    if (!language) {
      return { ok: false, error: `Unknown language "${raw.language}". Choose one of: ${INBOUND_LANGUAGES.join(', ')}.`, config: next };
    }
    next.language = language;
  }

  if (raw?.greeting !== undefined) {
    const greeting = String(raw.greeting || '').trim();
    if (greeting.length > 300) {
      return { ok: false, error: 'Keep the greeting under 300 characters: it is spoken first, in full, before the caller can reply.', config: next };
    }
    next.greeting = greeting;
  }

  if (raw?.script !== undefined) {
    const script = String(raw.script || '').trim();
    if (script.length > 4000) {
      return { ok: false, error: 'The script is over 4,000 characters. Keep the goal and the rules; the catalogue is appended automatically.', config: next };
    }
    next.script = script;
  }

  if (raw?.includeCatalogue !== undefined) next.includeCatalogue = raw.includeCatalogue === true || raw.includeCatalogue === 'true';
  if (raw?.enabled !== undefined) next.enabled = raw.enabled === true || raw.enabled === 'true';

  return { ok: true, config: next };
}

/**
 * Read the receptionist config for one business, falling back to a sensible default.
 * Pure-ish: only reads, and never writes, so the page can render before anything is saved.
 */
export async function loadReceptionist(
  db: any,
  userId: string
): Promise<{ config: InboundReceptionistConfig; profile: any; stored: boolean }> {
  const { data: profile } = await db
    .from('profiles')
    .select('id, business_name, industry, voice_name, business_info')
    .eq('id', userId)
    .maybeSingle();

  const bi = parseBusinessInfo(profile?.business_info);
  const stored = bi.inbound_receptionist;

  if (stored && typeof stored === 'object') {
    const base = defaultReceptionist({
      businessName: profile?.business_name,
      industry: profile?.industry,
      voiceName: profile?.voice_name,
      language: bi.default_calling_language,
    });
    return {
      config: {
        ...base,
        ...stored,
        did: normaliseDid(stored.did) || base.did,
      },
      profile,
      stored: true,
    };
  }

  return {
    config: defaultReceptionist({
      businessName: profile?.business_name,
      industry: profile?.industry,
      voiceName: profile?.voice_name,
      language: bi.default_calling_language,
    }),
    profile,
    stored: false,
  };
}

/** Persist the config into business_info without disturbing anything else in the blob. */
export async function saveReceptionist(db: any, userId: string, config: InboundReceptionistConfig) {
  const { data: profile } = await db.from('profiles').select('business_info').eq('id', userId).maybeSingle();
  const bi = parseBusinessInfo(profile?.business_info);
  bi.inbound_receptionist = { ...config, updatedAt: new Date().toISOString() };
  const { error } = await db
    .from('profiles')
    .update({ business_info: JSON.stringify(bi) })
    .eq('id', userId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

/**
 * Which business owns this dialled number?
 *
 * The table-less lookup described at the top of the file: find the profiles whose blob mentions
 * inbound config, then compare the DID exactly after parsing. Returns null when nobody claims it,
 * which the answer webhook treats as "use the previous behaviour".
 */
export async function resolveDidOwner(
  db: any,
  did: string
): Promise<{ userId: string; config: InboundReceptionistConfig } | null> {
  const wanted = normaliseDid(did);
  if (!wanted) return null;

  const { data, error } = await db
    .from('profiles')
    .select('id, business_name, industry, voice_name, business_info')
    .like('business_info', '%inbound_receptionist%')
    .limit(50);

  if (error || !data) return null;

  for (const row of data as any[]) {
    const bi = parseBusinessInfo(row.business_info);
    const stored = bi.inbound_receptionist;
    if (!stored || typeof stored !== 'object') continue;
    if (normaliseDid(stored.did) !== wanted) continue;
    if (stored.enabled === false) continue;

    const base = defaultReceptionist({
      businessName: row.business_name,
      industry: row.industry,
      voiceName: row.voice_name,
      language: bi.default_calling_language,
    });
    return { userId: row.id, config: { ...base, ...stored, did: wanted } };
  }
  return null;
}

/** A compact, truthful digest of the catalogue for the prompt. Nothing is invented. */
export async function catalogueDigest(db: any, userId: string, limit = 12): Promise<string> {
  try {
    const { data } = await db
      .from('properties')
      .select('title, price, location, category, description')
      .eq('user_id', userId)
      .limit(limit);
    if (!data?.length) return '';
    return (data as any[])
      .map((p) => {
        const bits = [p.title || 'untitled'];
        if (p.category) bits.push(String(p.category));
        if (p.location) bits.push(String(p.location));
        if (p.price) bits.push(`${p.price}`);
        const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
        if (desc) bits.push(desc.slice(0, 140));
        return `- ${bits.join(' | ')}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * The full script the receptionist speaks from.
 *
 * This is what makes it a receptionist for THIS business rather than a generic bot: the greeting is
 * spoken verbatim, the owner's own rules ride along, and the catalogue is attached as facts.
 */
export function buildReceptionistPrompt(input: {
  config: InboundReceptionistConfig;
  businessName?: string | null;
  industry?: string | null;
  catalogue?: string;
}): string {
  const { config } = input;
  const business = String(input.businessName || 'the business').trim();
  const vocab = industryVocabulary(input.industry || null);

  const lines = [
    `--- INBOUND RECEPTIONIST FOR ${business.toUpperCase()} ---`,
    `BUSINESS NAME: "${business}"`,
    `INDUSTRY: "${input.industry || 'general'}"`,
    `CALL TYPE: inbound. The caller rang the business's own number and it was forwarded here. They are already interested - do not ask how they found us.`,
    '',
    `GREETING (say this first, word for word, then stop and listen): "${config.greeting}"`,
    '',
    'YOUR JOB',
    `1. Find out who is calling and what they need about our ${vocab.productNounPlural}.`,
    '2. Answer from the facts below only. If the answer is not below, say you will have a colleague confirm it.',
    '3. Offer ONE next step: a site visit, a callback from the team, or details on WhatsApp.',
    '4. If they want a person, take their name and a good time, and confirm a colleague will call back.',
    '',
    'RULES',
    '- Keep every reply under 40 spoken words. Never read out a list.',
    '- Never invent prices, availability, approvals, offers or timelines.',
    '- Never claim to be a human being.',
    '- If the caller says they do not want to be contacted again, acknowledge once and end politely.',
    `- Speak in ${config.language === 'english' ? 'Indian English' : config.language}. If the caller switches language, switch with them immediately.`,
  ];

  if (config.script?.trim()) {
    lines.push('', 'OWNER INSTRUCTIONS (follow these above your own instincts):', config.script.trim());
  }

  if (config.includeCatalogue && input.catalogue) {
    lines.push('', 'CATALOGUE (the only products you may talk about):', input.catalogue);
  } else if (config.includeCatalogue) {
    lines.push('', 'CATALOGUE: none on file. Do not describe products - offer a callback.');
  }

  return lines.join('\n');
}

/**
 * The `voice_campaigns` row the media bridge reads.
 *
 * The bridge builds its call from the campaign linked to the lead (that is how the outbound demo
 * works), so an inbound line needs one too - otherwise the receptionist connects with no greeting
 * and says nothing. One row per business, updated in place, so this never accumulates campaigns.
 */
export async function ensureInboundCampaign(
  db: any,
  userId: string,
  config: InboundReceptionistConfig,
  context: { businessName?: string | null; industry?: string | null }
): Promise<{ campaignId: string | null; error?: string }> {
  try {
    const catalogue = config.includeCatalogue ? await catalogueDigest(db, userId) : '';
    const prompt = buildReceptionistPrompt({
      config,
      businessName: context.businessName,
      industry: context.industry,
      catalogue,
    });

    const name = `Inbound receptionist - ${context.businessName || 'business'}`;
    const settings = {
      audience_filter: {
        voice_name: config.voiceName,
        is_inbound: true,
        is_receptionist: true,
        language: config.language,
        greeting: config.greeting,
        business_name: context.businessName || null,
        inbound_did: config.did,
      },
      custom_prompt: prompt,
      status: 'running',
    };

    // Reuse the existing row when we already made one.
    let existingId = config.campaignId || null;
    if (existingId) {
      const { data } = await db.from('voice_campaigns').select('id').eq('id', existingId).maybeSingle();
      if (!data?.id) existingId = null;
    }
    if (!existingId) {
      const { data } = await db
        .from('voice_campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('name', name)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      existingId = data?.id || null;
    }

    if (existingId) {
      const { error } = await db.from('voice_campaigns').update(settings).eq('id', existingId);
      if (error) return { campaignId: existingId, error: error.message };
      return { campaignId: existingId };
    }

    const { data: created, error } = await db
      .from('voice_campaigns')
      .insert({ user_id: userId, name, ...settings })
      .select('id')
      .single();
    if (error) return { campaignId: null, error: error.message };
    return { campaignId: created?.id ?? null };
  } catch (e: any) {
    return { campaignId: null, error: e?.message || 'could not prepare the receptionist campaign' };
  }
}

export interface ReadinessReport {
  bridge: { ok: boolean; url: string; detail: string };
  did: { number: string; owned: boolean | null; detail: string };
  config: { stored: boolean; enabled: boolean; campaignId: string | null };
  canAnswer: boolean;
  blockers: string[];
}

/**
 * Can this line actually answer a call right now?
 *
 * Deliberately blunt. A "ready" badge that ignores the voice engine being unreachable is how we
 * shipped calls that connected and said nothing: the carrier, the DID and the webhook can all be
 * fine while the model behind the media stream is out of credit.
 */
export async function checkReadiness(
  db: any,
  userId: string,
  config: InboundReceptionistConfig,
  stored: boolean,
  opts: { probeModel?: boolean } = {}
): Promise<ReadinessReport> {
  const blockers: string[] = [];

  const bridgeUrl = resolveVoiceBridgeHttpUrl();
  let bridgeOk = false;
  let bridgeDetail = '';
  try {
    const res = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(15_000) });
    const body: any = await res.json().catch(() => ({}));
    bridgeOk = res.ok && String(body?.status || '').toLowerCase() === 'ok';
    bridgeDetail = res.ok ? `HTTP ${res.status} ${body?.status ?? ''}`.trim() : `HTTP ${res.status}`;
  } catch (e: any) {
    bridgeDetail = e?.message || 'unreachable';
  }
  if (!bridgeOk) blockers.push(`The voice engine at ${bridgeUrl} is not answering (${bridgeDetail}). No call can be spoken.`);

  if (!stored) blockers.push('Nothing is saved yet: the line is running on the built-in defaults. Save it before forwarding your phone.');
  if (!config.enabled) blockers.push('The line is switched off.');
  if (!config.campaignId) blockers.push('No receptionist script has been prepared yet (press Save).');

  // The model behind the stream is the thing that actually fails silently.
  if (opts.probeModel) {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) {
      blockers.push('No Gemini API key is configured, so the receptionist cannot speak.');
    } else {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 4 } }),
            signal: AbortSignal.timeout(20_000),
          }
        );
        if (!res.ok) {
          const body: any = await res.json().catch(() => ({}));
          const message = body?.error?.message || `HTTP ${res.status}`;
          blockers.push(`The speech model refuses to run: ${message}`);
        }
      } catch (e: any) {
        blockers.push(`Could not reach the speech model: ${e?.message || e}`);
      }
    }
  }

  return {
    bridge: { ok: bridgeOk, url: bridgeUrl, detail: bridgeDetail },
    did: {
      number: config.did,
      owned: null,
      detail: 'The DID must belong to this Vobiz account and be routed to our answer URL once, in the Vobiz console.',
    },
    config: { stored, enabled: config.enabled, campaignId: config.campaignId || null },
    canAnswer: blockers.length === 0,
    blockers,
  };
}
