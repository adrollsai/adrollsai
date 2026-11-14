import crypto from 'crypto';

/**
 * Speech-to-text for the composer.
 *
 * ENGINE ORDER, AND WHY
 *   1. "gemini-3.5-transcribe" — Gemini's purpose-built transcription model. There
 *      is no language list to get wrong: it detects what is spoken and writes it in
 *      that language's own script.
 *   2. Google Cloud Speech-to-Text ("chirp_3", see cloudTranscribe below) — kept as
 *      the fallback because it is a different vendor path, and two independent
 *      paths rarely fail together.
 *   3. Gemini Flash — last resort, in the route.
 *
 * MEASURED on this account's own recordings, same files and machine:
 *
 *   clip                 chirp_3          gemini-3.5-transcribe   gemini-2.5-flash
 *   English 12s          2441ms, 28w      1410ms, 26w             4072ms, 28w
 *   Punjabi ~100s        7217ms, 136w     3216ms, 135w            81695ms, 140w
 *   Hinglish call        2980ms, 59w      2254ms, 54w             3658ms, 56w
 *
 * On the Punjabi clip chirp_3 also wrote DEVANAGARI and misheard "Infra" as
 * "इंसान", while the transcribe model returned correct Gurmukhi. So it is both the
 * fastest on long audio and the only one that got a non-Hindi Indian language
 * right. It also removes the dependency on the Cloud Speech API being enabled,
 * which is a whole class of "the mic does nothing" incidents.
 *
 * THE FIELD THAT BITES: "gemini-3.5-transcribe" returns its transcript in
 * `parts[].audioTranscription.text`, NOT `parts[].text`. Reading the usual field
 * yields an empty string from a perfectly good response — which looks exactly like
 * "the model cannot hear you". Both are read below, audioTranscription first.
 *
 * A NOTE ON AN EARLIER CLAIM IN THIS FILE: Gemini Flash was written off here as
 * "hallucinating" and "truncating". The truncation was our own maxOutputTokens of
 * 800. The hallucination on gemini-3.8-flash was real; the 2.5 truncation was not.
 */

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * Languages handed to the CLOUD recogniser (fallback path only).
 *
 * With only en-IN and hi-IN declared, chirp_3 still transcribed a 100-second
 * Punjabi call, so the list is a hint rather than a constraint. The primary
 * engine needs no list at all. Override with STT_LANGUAGES ("en-IN,hi-IN,pa-IN")
 * if the fallback quality matters for a particular tenant base — keep it short,
 * because a long list costs accuracy on short clips.
 */
const LANGUAGES = (process.env.STT_LANGUAGES || 'en-IN,hi-IN')
  .split(',')
  .map((l) => l.trim())
  .filter(Boolean);

type Attempt = { location: string; host: string; model: string };

/** Tried in order; first success wins. */
const ATTEMPTS: Attempt[] = [
  { location: 'us', host: 'us-speech.googleapis.com', model: 'chirp_3' },
  { location: 'global', host: 'speech.googleapis.com', model: 'latest_long' },
];

const TRANSCRIBE_MODEL = process.env.STT_MODEL || 'gemini-3.5-transcribe';

let cachedToken: { value: string; expires: number } | null = null;
/** Set when the whole cloud path is known-bad (no API, no permission) so a mic press costs one try, not three. */
let disabledUntil = 0;

function serviceAccount(): any | null {
  const line = (process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!line) return null;
  const q = String.fromCharCode(34);
  let raw = line;
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith(q) && raw.endsWith(q))) {
    raw = raw.slice(1, -1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function b64u(input: string): string {
  return Buffer.from(input).toString('base64url');
}

/** Service-account JWT → access token, cached for 50 minutes. */
export async function accessToken(sa: any): Promise<string | null> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  try {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(
      JSON.stringify({
        iss: sa.client_email,
        scope: SCOPE,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )}`;
    const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${Buffer.from(sig).toString('base64url')}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn('[stt] token refused:', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const body = await res.json();
    cachedToken = { value: body.access_token, expires: Date.now() + 50 * 60_000 };
    return cachedToken.value;
  } catch (e: any) {
    console.warn('[stt] token error:', e?.message || e);
    return null;
  }
}

export type SttResult = { text: string; engine: string; ms: number };

function geminiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim();
}

/**
 * Transcribe with Gemini's transcription model — the primary engine.
 *
 * Language is deliberately not a parameter. That is the point: the mic should work
 * identically whether the owner speaks English, Hindi, Hinglish or Punjabi.
 */
export async function geminiTranscribe(base64: string, mime = 'audio/webm'): Promise<SttResult | null> {
  const key = geminiKey();
  if (!key) return null;

  const started = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIBE_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    // The API wants the plain container: strip "audio/webm;codecs=opus".
                    mime_type: String(mime || 'audio/webm').split(';')[0] || 'audio/webm',
                    data: base64,
                  },
                },
              ],
            },
          ],
          // 4000, not 800: a two-minute Hinglish clip needs well over 800 tokens, and
          // a truncated transcript is worse than none — it reads as a bad ear.
          generationConfig: { temperature: 0, maxOutputTokens: 4000 },
        }),
        signal: AbortSignal.timeout(45_000),
      }
    );

    if (!res.ok) {
      console.warn(`[stt] ${TRANSCRIBE_MODEL} refused ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }

    const data = await res.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
    // audioTranscription first — see the note at the top of this file.
    const text = parts
      .map((part) => part?.audioTranscription?.text ?? part?.text ?? '')
      .join('')
      .trim();

    return { text, engine: `gemini:${TRANSCRIBE_MODEL}`, ms: Date.now() - started };
  } catch (e: any) {
    console.warn(`[stt] ${TRANSCRIBE_MODEL} failed:`, e?.message || e);
    return null;
  }
}

/**
 * Transcribe a base64 audio blob (webm/opus, mp3, wav — both engines sniff the
 * container). Returns null when the cloud path is unavailable so the caller can
 * fall back further.
 */
export async function cloudTranscribe(base64: string): Promise<SttResult | null> {
  if (Date.now() < disabledUntil) return null;
  const sa = serviceAccount();
  if (!sa?.private_key) return null;
  const token = await accessToken(sa);
  if (!token) return null;

  const started = Date.now();
  for (const attempt of ATTEMPTS) {
    try {
      const t = Date.now();
      const res = await fetch(
        `https://${attempt.host}/v2/projects/${sa.project_id}/locations/${attempt.location}/recognizers/_:recognize`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              autoDecodingConfig: {},
              languageCodes: LANGUAGES,
              model: attempt.model,
              features: { enableAutomaticPunctuation: true },
            },
            content: base64,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!res.ok) {
        const detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
        console.warn(`[stt] ${attempt.model}@${attempt.location} refused ${res.status}: ${detail}`);
        continue;
      }

      const data = await res.json();
      const text = (data?.results || [])
        .map((r: any) => r?.alternatives?.[0]?.transcript || '')
        .join(' ')
        .trim();
      return { text, engine: `cloud-stt:${attempt.model}@${attempt.location}`, ms: Date.now() - t };
    } catch (e: any) {
      console.warn(`[stt] ${attempt.model}@${attempt.location} failed:`, e?.message || e);
    }
  }

  // Nothing answered. Almost always "API not enabled" or "role missing" — remember it for a
  // few minutes so the mic does not pay three failed round-trips on every press.
  disabledUntil = Date.now() + 10 * 60_000;
  console.warn(`[stt] cloud path unavailable after ${Date.now() - started}ms; using fallback for 10 min`);
  return null;
}

/**
 * Transcribe with the best available engine.
 *
 * Returns null only when every engine failed. An empty string is a valid result —
 * it means the audio held no speech, and re-asking a second vendor for the same
 * file is just latency.
 */
export async function transcribeAudio(base64: string, mime = 'audio/webm'): Promise<SttResult | null> {
  const gemini = await geminiTranscribe(base64, mime);
  if (gemini) return gemini;

  console.warn('[stt] transcribe model unavailable — falling back to Cloud STT');
  return cloudTranscribe(base64);
}
