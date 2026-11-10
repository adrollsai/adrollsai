/**
 * Usage metering for the agent.
 *
 * The agent previously charged the user nothing at all — not model tokens, not
 * sandbox time, not a single Grok video — while an 8s 720p clip alone costs us
 * ~₹16. This module accumulates measured usage during a turn/slice and settles
 * it once, at cost x 2, through the existing `deductCreditsByCost` ledger.
 *
 * Design notes:
 *  - Accumulation is per-turn state set by the entry point (chat route or the
 *    durable runner), the same pattern as the turn deadline. Serverless
 *    instances handle one request at a time in practice.
 *  - Settling is best-effort: a billing failure must never break the user's task,
 *    so every settle path is wrapped and only logged.
 *  - Nothing is charged when the meter is empty, so read-only turns are free.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  priceForTextModel,
  SANDBOX_INR_PER_SECOND,
  mediaPrice,
} from './pricing';

export interface UsageLine {
  label: string;
  costInr: number;
  detail: string;
}

export class UsageMeter {
  readonly lines: UsageLine[] = [];

  add(line: UsageLine) {
    if (!Number.isFinite(line.costInr) || line.costInr <= 0) return;
    this.lines.push(line);
  }

  /**
   * Model tokens. Cache hits and misses are priced separately — DeepSeek's
   * cached input is ~50x cheaper, and nearly all of an agent turn's input is
   * cache hits, so lumping them together would overcharge by an order of
   * magnitude.
   */
  addModelUsage(modelId: string, usage: any) {
    if (!usage) return;
    const price = priceForTextModel(modelId);

    const cacheRead = Number(usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0);
    const noCache = Number(
      usage?.inputTokenDetails?.noCacheTokens ??
        (Number(usage?.inputTokens ?? usage?.promptTokens ?? 0) - cacheRead || 0)
    );
    const output = Number(usage?.outputTokens ?? usage?.completionTokens ?? 0);

    const cost =
      (Math.max(0, cacheRead) / 1000) * price.cacheHitPer1k +
      (Math.max(0, noCache) / 1000) * price.cacheMissPer1k +
      (Math.max(0, output) / 1000) * price.outputPer1k;

    this.add({
      label: 'model tokens',
      costInr: cost,
      detail: `${modelId}: in ${cacheRead} cached + ${noCache} fresh, out ${output}`,
    });
  }

  addSandboxSeconds(seconds: number, note = '') {
    this.add({
      label: 'sandbox compute',
      costInr: Math.max(0, seconds) * SANDBOX_INR_PER_SECOND,
      detail: `${seconds.toFixed(1)}s E2B${note ? ` (${note})` : ''}`,
    });
  }

  /** Media model call. `units` is seconds of video, 1k chars of speech, or 1 image. */
  addMedia(key: string, units: number, note = '') {
    const p = mediaPrice(key);
    const cost = p.per !== undefined ? p.per * units : (p.each || 0) * units;
    this.add({
      label: `media: ${key}`,
      costInr: cost,
      detail: `${units} unit(s)${p.estimated ? ' [estimated rate]' : ''}${note ? ` — ${note}` : ''}`,
    });
  }

  totalInr(): number {
    return this.lines.reduce((sum, l) => sum + l.costInr, 0);
  }

  isEmpty(): boolean {
    return this.lines.length === 0;
  }

  summary(): string {
    if (this.isEmpty()) return 'no billable usage';
    return this.lines.map((l) => `${l.label} ₹${l.costInr.toFixed(4)}`).join('; ');
  }
}

// ── per-turn meter ────────────────────────────────────────────────────────
let activeMeter: UsageMeter | null = null;

export function startUsageMeter(): UsageMeter {
  activeMeter = new UsageMeter();
  return activeMeter;
}

export function currentUsageMeter(): UsageMeter | null {
  return activeMeter;
}

export function clearUsageMeter(): void {
  activeMeter = null;
}

/** Attribute usage from a nested tool call to the turn in progress. */
export function meterOf(): UsageMeter | null {
  return activeMeter;
}

/**
 * Charge the meter's total at 2x margin. Never throws: a billing problem must
 * not take down a task the user is watching.
 */
export async function settleUsage(
  supabaseAdmin: SupabaseClient,
  userId: string,
  meter: UsageMeter | null,
  label: string
): Promise<{ charged: number; costInr: number } | null> {
  if (!meter || meter.isEmpty()) return null;
  const costInr = meter.totalInr();
  if (costInr <= 0) return null;

  // 2x margin, applied by the existing ledger helper.
  const credits = Math.round(costInr * 2 * 100) / 100;
  try {
    const { deductCreditsByCost } = await import('@/utils/credits');
    const ok = await deductCreditsByCost(supabaseAdmin, userId, costInr, 'ai_generation', `${label} — ${meter.summary()}`.slice(0, 500));
    console.log(
      `[Agent usage] ${label}: cost ₹${costInr.toFixed(4)} -> ${credits} credits (${ok ? 'charged' : 'FAILED'}) | ${meter.summary()}`
    );
    return { charged: ok ? credits : 0, costInr };
  } catch (err: any) {
    console.warn(`[Agent usage] settle failed for ${label}: ${err?.message || err}`);
    return { charged: 0, costInr };
  }
}
