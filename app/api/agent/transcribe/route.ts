import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { transcribeAudio } from '@/lib/agent/stt';

export const maxDuration = 60;

/**
 * Speech → text for the chat composer.
 *
 * 1. Gemini `gemini-3.5-transcribe` — purpose-built transcription, detects the language
 *    and script itself, so the mic works the same for English, Hindi, Hinglish or Punjabi.
 * 2. Google Cloud Speech-to-Text v2 — `chirp_3` on the US regional host, then
 *    `latest_long` on global. Independent vendor path, used when (1) is unavailable.
 * 3. Gemini Flash — last resort.
 *
 * The ordering and the measurements behind it live in lib/agent/stt.ts.
 *
 * The browser's own SpeechRecognition is NOT used for dictation any more: it takes a
 * single hard-coded language, so it silently mangled anything that was not Indian
 * English. It survives in the component only as a last resort when this route fails.
 */

/** Gemini Flash — the working fallback, on the key the app already uses. */
async function geminiStt(base64: string, mime: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  if (!apiKey) return null;
  try {
    const res = await fetch(
      // gemini-2.0-flash is retired (HTTP 404: "no longer available"); this is
      // the current flash that answered on the same key.
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    'Transcribe this recording verbatim into the language actually spoken — English, Hindi, ' +
                    'Hinglish or another Indian language. Keep the speaker\'s language and script (Hindi in ' +
                    'Devanagari, Hinglish in Latin, Punjabi in Gurmukhi). Return ONLY the transcript: no quotes, ' +
                    'no speaker labels, no notes, no translation. If there is no speech, return an empty string.',

                },
                { inline_data: { mime_type: mime.split(';')[0], data: base64 } },
              ],
            },
          ],
          // 800 truncated a 100-second Punjabi clip after ten words in testing.
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) {
      console.warn('[transcribe] Gemini fallback refused:', res.status);
      return null;
    }
    const data = await res.json();
    return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
  } catch (e: any) {
    console.warn('[transcribe] Gemini fallback failed:', e?.message || e);
    return null;
  }
}

/**
 * Connection warm-up.
 *
 * The mic fires this on pointer-down. It does no work: it exists so DNS, TLS and
 * the edge handshake are settled before there is audio to upload, which removes
 * 150-400 ms of cold-start from the front of every dictation. Deliberately
 * unauthenticated — it returns nothing and touches nothing.
 */
export async function GET() {
  return NextResponse.json({ ok: true, engine: process.env.STT_MODEL || 'gemini-3.5-transcribe' });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let base64 = '';
  let mime = 'audio/webm';
  try {
    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No audio received' }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: 'That recording is too long — keep it under a minute.' }, { status: 413 });
    }
    base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    mime = file.type || mime;
  } catch {
    return NextResponse.json({ error: 'Could not read the recording' }, { status: 400 });
  }

  const started = Date.now();
  // Engine order lives in lib/agent/stt.ts (transcribe model, then Cloud STT).
  const primary = await transcribeAudio(base64, mime);
  let text = primary ? primary.text : null;
  let engine = primary ? primary.engine : 'gemini-flash';

  // Last resort: plain Gemini Flash. Slower and it truncates long clips, so it is
  // only reached when both real engines are down.
  if (text === null) {
    text = await geminiStt(base64, mime);
  }

  if (text === null) {
    return NextResponse.json({ error: 'Could not transcribe that. Try again.' }, { status: 502 });
  }
  if (!text) {
    return NextResponse.json({ text: '', warning: 'I did not catch any words there.', engine });
  }
  console.log(`[transcribe] ${engine} in ${Date.now() - started}ms, ${text.length} chars`);
  return NextResponse.json({ text, engine, ms: Date.now() - started });
}
