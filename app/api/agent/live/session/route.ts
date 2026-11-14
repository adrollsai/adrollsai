import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canStartTurn } from '@/lib/agent/usage';
import { LIVE_MODEL, pickVoice, liveSocketUrl } from '@/lib/agent/live/protocol';

export const maxDuration = 60;

/**
 * Opens a voice dialogue session.
 *
 * The browser must never hold the account API key, so this mints a short-lived
 * ephemeral token scoped to one session and hands back only that plus the endpoint.
 * Same gate as a chat turn: no credits, no session.
 *
 * The persona prompt is built here, not in the browser, so the instructions cannot be
 * rewritten by whoever is holding the tab.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const affordable = await canStartTurn(user.id, 1);
  if (!affordable.ok) {
    return NextResponse.json(
      { error: affordable.reason || 'You need credits to start a voice session.', code: 'insufficient_credits' },
      { status: 402 }
    );
  }

  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json({ error: 'Voice is not configured on this environment.' }, { status: 503 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, industry, full_name, voice_name')
    .eq('id', user.id)
    .single();

  const business = profile?.business_name || 'the business';
  const systemInstruction = [
    `You are the marketing chief of staff for ${business}.`,
    'You are talking to the owner out loud, so keep answers short — one or two sentences at most unless asked for detail.',
    'Answer in the language the owner used. If they speak Hindi or Hinglish, answer in the same Hindi or Hinglish — never switch to English because the instructions here are in English.',
    'Never read out markdown, bullet points, URLs or code. Never say "as an AI".',
    'If the owner asks you to do something that takes time (writing a script, generating an image or a video, calling someone),',
    'say in one short sentence that you are starting it, mention the label you were given for the work, then stop talking.',
    'Ask before spending money on anything expensive, in one sentence, and say the approximate cost.',
    'If you do not know a number, say you will check — never guess a price, a lead count or a performance figure.',
  ].join(' ');

  // Ephemeral tokens keep the long-lived key on the server. The provisioning service is
  // v1beta (v1alpha does not issue tokens); the client then uses the token exactly like
  // an API key via `access_token`.
  const expireTime = new Date(Date.now() + 30 * 60_000).toISOString();
  let token: string | null = null;
  for (const version of ['v1beta', 'v1alpha']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${version}/auth_tokens`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            uses: 1,
            expireTime,
            newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        token = data?.name || null;
        if (token) break;
      } else {
        console.warn(`[live] token mint via ${version} refused:`, res.status, (await res.text()).slice(0, 160));
      }
    } catch (e: any) {
      console.warn(`[live] token mint via ${version} error:`, e?.message || e);
    }
  }

  if (!token) {
    if (process.env.LIVE_VOICE_ALLOW_DIRECT_KEY !== '1') {
      return NextResponse.json(
        { error: 'Voice could not be opened right now. Please use text for a moment.' },
        { status: 503 }
      );
    }
    token = apiKey;
  }

  // Ephemeral token → the constrained RPC (this is what the SDKs use for short-lived
  // credentials; the plain RPC refuses them). Raw API key → the plain RPC.
  const mode: 'ephemeral' | 'apiKey' = token === apiKey ? 'apiKey' : 'ephemeral';
  const wsUrl = liveSocketUrl({ credential: token, mode });

  return NextResponse.json({
    wsUrl,
    // Same model as the AI calling product (LIVE_MODEL resolves GEMINI_LIVE_MODEL first,
    // so setting that once keeps voice calls and in-app voice in step).
    model: LIVE_MODEL,
    expiresAt: expireTime,
    conversationId: `lv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    systemInstruction,
    speech: {
      voiceName: pickVoice((profile as any)?.voice_name || null, true),
      languageCode: 'en-IN',
    },
  });
}
