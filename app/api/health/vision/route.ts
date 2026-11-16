import { NextResponse } from 'next/server';
import { analyzeImageWithGemini } from '@/utils/image-analysis';

/**
 * Is image analysis actually working in THIS deployment?
 *
 * Every piece of output QA depends on it: the ad-creative review, the page-image relevance check, and the agent's own
 * "look at your output before delivering" step. Until now nothing could answer that question, and a broken key degraded
 * to a fabricated description that read like a pass — so the health of this capability has to be checkable from
 * outside.
 *
 * It reports only whether the capability works: the verdict, and the length of the key that produced it. Never the key.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROBE_IMAGE =
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794846476722_hero-hero-1794846476722.png';

export async function GET() {
  const primary = String(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '');
  const fallback = String(process.env.GEMINI_API_KEY ?? '');
  const keyLength = (primary || fallback).trim().replace(/^"|"$/g, '').length;

  let answer = '';
  let ok = false;
  try {
    answer = await analyzeImageWithGemini(PROBE_IMAGE, 'In five words, what is in this image?');
    ok = Boolean(answer) && !/VISION UNAVAILABLE/i.test(answer);
  } catch (err: any) {
    answer = `error: ${err?.message ?? err}`;
  }

  return NextResponse.json(
    {
      ok,
      // Presence, not the secret: enough to tell "not configured" from "configured but failing".
      keyConfigured: keyLength > 0,
      keyLength,
      usedFallbackVar: !primary.trim() && Boolean(fallback.trim()),
      sawTheImage: ok,
      answer: String(answer).slice(0, 160),
      hint: ok
        ? 'Image analysis works in this deployment.'
        : keyLength === 0
          ? 'No Gemini key is configured for this environment, so every image and video-frame check fails. Set GOOGLE_GENERATIVE_AI_API_KEY.'
          : 'A key is configured but the call failed. The answer above is the provider error.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
