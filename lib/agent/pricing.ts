/**
 * What the agent actually costs us, in INR, in one auditable place.
 *
 * Credits are charged from measured usage with a 2x margin (₹1 cost = 2 credits)
 * via `deductCreditsByCost`, so the numbers here are OUR cost, not the price.
 *
 * Every rate is overridable by env so a vendor price change needs no code
 * change. Items marked `estimated` are the ones I could not confirm from the
 * vendor's own pricing page — treat them as placeholders to be corrected
 * against the real invoice, not as facts.
 */

/** USD→INR used for vendors that quote in dollars. */
export const USD_TO_INR = Number(
  (process.env.AGENT_USD_INR || '').replace(/^["']|["']$/g, '').trim() || 88
);

const usd = (perThousandUsd: number) => perThousandUsd * USD_TO_INR;

export interface TextModelPrice {
  /** Cached input is ~50x cheaper on DeepSeek, so it must not be billed as fresh. */
  cacheHitPer1k: number;
  cacheMissPer1k: number;
  outputPer1k: number;
  source: string;
  estimated?: boolean;
}

/**
 * DeepSeek V4.1 Flash list prices (peak): $0.006 cache-hit input,
 * $0.30 cache-miss input, $1.20 output per 1M tokens.
 * The old table in utils/credits.ts had no cache tier at all and billed output
 * at ~4x below our real cost.
 */
export const TEXT_MODEL_PRICES: Record<string, TextModelPrice> = {
  'deepseek-flash': {
    cacheHitPer1k: usd(0.006 / 1000),
    cacheMissPer1k: usd(0.3 / 1000),
    outputPer1k: usd(1.2 / 1000),
    source: 'DeepSeek list price (peak)',
  },
  'deepseek-v4-pro': {
    cacheHitPer1k: usd(0.006 / 1000),
    cacheMissPer1k: usd(0.3 / 1000),
    outputPer1k: usd(1.2 / 1000),
    source: 'DeepSeek list price (peak)',
  },
  // Gemini Flash class. Used for video/image analysis, not the agent loop.
  gemini: {
    cacheHitPer1k: 0,
    cacheMissPer1k: usd(0.3 / 1000),
    outputPer1k: usd(2.5 / 1000),
    source: 'Gemini Flash list price (proxy)',
    estimated: true,
  },
};

export function priceForTextModel(modelId: string): TextModelPrice {
  const id = (modelId || '').toLowerCase();
  if (TEXT_MODEL_PRICES[id]) return TEXT_MODEL_PRICES[id];
  if (id.includes('gemini')) return TEXT_MODEL_PRICES.gemini;
  return TEXT_MODEL_PRICES['deepseek-flash'];
}

/** Compute once, at import: E2B prices are stable and measured. */
export const SANDBOX_INR_PER_SECOND = Number(
  (process.env.AGENT_E2B_INR_PER_SECOND || '').replace(/^["']|["']$/g, '').trim() ||
    // Measured: 2 vCPU ($0.000014/s) + 2 GiB ($0.0000045/GiB/s) = $0.000037/s
    (0.000037 * USD_TO_INR).toFixed(6)
);

export interface MediaPrice {
  /** INR per unit (second of video, 1k characters, or one image). */
  per?: number;
  each?: number;
  source: string;
  estimated?: boolean;
}

/**
 * Kie.ai media models. Video rates are from Kie's own Grok Imagine Video 1.5
 * page: 480p 2.4 credits/s (≈$0.012), 720p 4.5 (≈$0.0225), 1080p 8 (≈$0.04).
 * Image and TTS rates are estimates — verify against the Kie invoice.
 */
export const MEDIA_PRICES: Record<string, MediaPrice> = {
  'grok-video:480p': { per: 0.012 * USD_TO_INR, source: 'Kie Grok Imagine 1.5 pricing page' },
  'grok-video:720p': { per: 0.0225 * USD_TO_INR, source: 'Kie Grok Imagine 1.5 pricing page' },
  'grok-video:1080p': { per: 0.04 * USD_TO_INR, source: 'Kie Grok Imagine 1.5 pricing page' },
  'image': { each: 0.03 * USD_TO_INR, source: 'Kie image (estimate)', estimated: true },
  'tts': { per: 0.0006 * USD_TO_INR, source: 'Kie Gemini TTS (estimate, per 1k chars)', estimated: true },
  /**
   * Veo had no rate at all, so every Veo call was recorded unpriced — we knew we
   * spent money and valued it at zero. Default is a documented proxy (Grok 1080p)
   * until the Kie invoice confirms it; override via AGENT_VEO_INR_PER_SECOND.
   */
  'veo-video': {
    per: Number(
      (process.env.AGENT_VEO_INR_PER_SECOND || '').replace(/^["']|["']$/g, '').trim() ||
        (0.04 * USD_TO_INR).toFixed(4)
    ),
    source: 'Veo (proxy = Grok 1080p until invoiced)',
    estimated: true,
  },
  /** ElevenLabs by character, when the voice path bills that way. */
  'elevenlabs-tts': {
    per: Number(
      (process.env.AGENT_ELEVENLABS_INR_PER_1K_CHARS || '').replace(/^["']|["']$/g, '').trim() ||
        (0.3 * USD_TO_INR).toFixed(4)
    ),
    source: 'ElevenLabs (proxy until invoiced)',
    estimated: true,
  },
  /**
   * Live voice conversation, per second of audio in and out.
   *
   * Priced in rupees per second so it can be billed from measured audio duration rather
   * than a token count the client could never verify. Vendor audio rates are ~$0.0003/s
   * in and ~$0.0024/s out; the credits themselves carry the 2x margin downstream.
   */
  'live-voice-in': { per: 0.0003 * USD_TO_INR, source: 'Live voice input (estimate)', estimated: true },
  'live-voice-out': { per: 0.0024 * USD_TO_INR, source: 'Live voice output (estimate)', estimated: true },
};

export function mediaPrice(key: string): MediaPrice {
  return MEDIA_PRICES[key] || { each: 0, source: 'unknown' };
}

/**
 * What a Grok Imagine clip will cost the user, in credits.
 *
 * Shown on the pre-flight review so "Approve & generate" is an informed click rather
 * than a guess. Credits carry the 2x margin (see deductCreditsByCost), so the vendor
 * rate is doubled here rather than in the UI, where it would drift.
 */
export function estimateGrokVideoCredits(
  seconds: number,
  resolution: '480p' | '720p' | '1080p' = '720p'
): number {
  const rate = MEDIA_PRICES[`grok-video:${resolution}`]?.per ?? 0;
  return Math.round(seconds * rate * 2 * 10) / 10;
}

/**
 * Rupee cost of one live-voice conversation, before the credit margin.
 *
 * Takes measured audio seconds rather than an opaque token count: seconds are
 * something the server can verify and the user could in principle reproduce, and the
 * same number drives the on-screen meter.
 */
export function liveVoiceRupeeCost(secondsIn: number, secondsOut: number): number {
  const cin = Math.max(0, secondsIn) * (MEDIA_PRICES['live-voice-in'].per || 0);
  const cout = Math.max(0, secondsOut) * (MEDIA_PRICES['live-voice-out'].per || 0);
  return Math.round((cin + cout) * 10000) / 10000;
}

/** Anything priced by us rather than a vendor (e.g. our own render compute). */
export const EXTRA_RATES = {
  /** Per 1k characters of a TTS script, when the vendor bills per character. */
  ttsPer1kChars: MEDIA_PRICES.tts.per || 0,
};
