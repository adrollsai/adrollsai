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
};

export function mediaPrice(key: string): MediaPrice {
  return MEDIA_PRICES[key] || { each: 0, source: 'unknown' };
}

/** Anything priced by us rather than a vendor (e.g. our own render compute). */
export const EXTRA_RATES = {
  /** Per 1k characters of a TTS script, when the vendor bills per character. */
  ttsPer1kChars: MEDIA_PRICES.tts.per || 0,
};
