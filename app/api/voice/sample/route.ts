import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { languageCodeFor, synthesizeSpeech } from '@/lib/media/gemini-tts-direct';

export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * A voice sample that always exists.
 *
 * The previews were pointing at /voices/<name>.wav — five hand-made files. That works until someone
 * adds a sixth voice (the media registry already lists thirty), or until a deploy quietly excludes
 * the files again, and then the player sits at 0:00 with no error. Two of the previews were worse
 * than that: the calling view only showed a toast.
 *
 * So samples are produced on demand and cached in R2 for ever after:
 *
 *   1. a voice we already ship as a static file → redirect to it (instant, no generation)
 *   2. a sample already generated → redirect to the cached copy (instant)
 *   3. otherwise → synthesise one line with Gemini TTS, store it, redirect
 *
 * Every voice in the product therefore has a preview, including ones added later, and the cost is
 * one short generation per voice per language for the whole platform.
 */

/** The voices that ship as static files (all read in English). */
const STATIC_SAMPLES = new Set(['aoede', 'kore', 'charon', 'fenrir', 'puck']);

/** What the sample says. Short on purpose: it is a first impression, not a demo. */
const SAMPLE_LINE = 'Hi, this is my voice. I will answer your customers and book their appointments.';

/** Only letters and digits, so a caller cannot walk the bucket with `../`. */
function safeVoice(value: string | null): string {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(0, 32) || 'Aoede';
}

function languageSlug(language: string | null, accent: string | null): string {
  const raw = String(language || accent || 'english').toLowerCase().replace(/[^a-z_]/g, '');
  return raw.slice(0, 24) || 'english';
}

async function r2Targets() {
  const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');
  return { r2, R2_BUCKET, R2_PUBLIC_URL };
}

/** True when a public R2 object is already there. */
async function cachedAt(publicUrl: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${publicUrl}/${key}`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const voice = safeVoice(params.get('voice'));
  const language = params.get('lang');
  const accent = params.get('accent');
  const slug = languageSlug(language, accent);

  // 1. A static sample already covers the shipped voices in English. It is a public file and costs
  //    nothing, so it needs no session — and answering before any auth lookup means the player starts
  //    without waiting on one.
  //
  //    The check is on the LANGUAGE, not the accent: the shipped clips are English speech, and an
  //    accent on its own (the creation workspace sends `accent=indian` and no language) is a hint for
  //    generation, not a reason to sit through one before playing anything.
  const explicitLanguage = String(language || '').toLowerCase().trim();
  const englishish = !explicitLanguage || /^(english|english_in|indian_english)$/.test(explicitLanguage);
  if (STATIC_SAMPLES.has(voice.toLowerCase()) && englishish) {
    return NextResponse.redirect(new URL(`/voices/${voice.toLowerCase()}.wav`, request.nextUrl.origin), 307);
  }

  /**
   * Everything below costs a real generation, so it is signed-in only: an open endpoint that
   * synthesises audio is somebody else's free TTS API.
   */
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '').trim() : null;
  const cookieClient = await (await import('@/utils/supabase/server')).createClient();
  const { data: cookieUser } = await cookieClient.auth.getUser();
  const bearerUser = bearer ? (await supabaseAdmin.auth.getUser(bearer)).data?.user : null;
  if (!cookieUser?.user && !bearerUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2 & 3. Cache, or make one.
  const key = `voice-samples/${voice.toLowerCase()}-${slug}.mp3`;
  try {
    const { R2_PUBLIC_URL } = await r2Targets();
    if (await cachedAt(R2_PUBLIC_URL, key)) {
      return NextResponse.redirect(`${R2_PUBLIC_URL}/${key}`, 307);
    }

    const result = await synthesizeSpeech({
      text: SAMPLE_LINE,
      voiceName: voice,
      languageCode: languageCodeFor({ language: language ?? undefined, accent: accent ?? undefined }),
    });
    if (!result.ok) {
      // Say what went wrong rather than handing the player an empty file.
      return NextResponse.json(
        { error: `Could not make a sample for ${voice}: ${result.error}` },
        { status: result.retryable ? 503 : 502 }
      );
    }

    const { r2, R2_BUCKET } = await r2Targets();
    const { ensureMp3AudioBuffer } = await import('@/utils/audio-converter');
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const mp3 = await ensureMp3AudioBuffer(result.wav);
    await r2.send(
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: mp3, ContentType: 'audio/mpeg' })
    );
    console.log(`[voice-sample] generated ${voice}/${slug} (${mp3.length} bytes) with ${result.model}`);
    return NextResponse.redirect(`${R2_PUBLIC_URL}/${key}`, 307);
  } catch (error: any) {
    console.error('[voice-sample] failed:', error);
    return NextResponse.json({ error: `Could not make a sample: ${error?.message || error}` }, { status: 500 });
  }
}
