/**
 * The one place vendor spend gets recorded.
 *
 * Before this module, cost only existed inside an agent turn: the chat route and
 * the durable runner opened a `UsageMeter` and charged its total at the end. Any
 * other caller — cron jobs, webhooks, dashboard routes, standalone scripts — hit
 * Gemini, Kie or E2B and left no record at all. A rough audit found 35 files
 * calling vendors directly and only 2 of them metered.
 *
 * So every vendor wrapper calls `recordSpend()`:
 *
 *   inside a turn  -> accumulate on the turn's meter; the turn charges once at 2x
 *   outside a turn -> write a `usage_events` row, and charge the attributed user
 *                     directly (2x), so nothing is both invisible and free
 *
 * Design rules, learned the hard way:
 *  - Never throw. Billing must not break a user's task.
 *  - Record even when we cannot price it (`priced: false`). An unpriced row is a
 *    countable gap; a missing row is a silent leak.
 *  - One metering point per vendor call, at the wrapper. Metering again in the
 *    tool that calls it double-charges the user.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { meterOf } from './usage';

export type SpendService =
  | 'deepseek'
  | 'gemini'
  | 'kie_video'
  | 'kie_image'
  | 'kie_tts'
  | 'kie_chat'
  | 'e2b'
  | 'elevenlabs'
  | 'other';

export interface SpendContext {
  /** Who to bill when this happens outside an agent turn. */
  userId?: string | null;
  /** Human label for the entry point, e.g. 'cron:auto-blog'. */
  label?: string;
  /**
   * Charge attributed spend outside a turn. Defaults to true; set
   * AGENT_SPEND_CHARGE=0 to record without charging while validating the
   * attribution on a new route.
   */
  charge?: boolean;
}

export interface SpendEvent {
  service: SpendService;
  costInr: number;
  detail: string;
  model?: string | null;
  units?: number | null;
  unit?: string | null;
  userId?: string | null;
  /** false when we know the call happened but have no rate for it. */
  priced?: boolean;
  meta?: Record<string, unknown>;
}

const als = new AsyncLocalStorage<SpendContext>();
let ambient: SpendContext = {};

/** Scope attribution around a unit of work (preferred). */
export function runWithSpendContext<T>(ctx: SpendContext, fn: () => T): T {
  return als.run({ ...ambient, ...ctx }, fn);
}

/** Fallback for callers that cannot wrap their work in a callback. */
export function setSpendContext(ctx: SpendContext) {
  ambient = { ...ambient, ...ctx };
}

export function clearSpendContext() {
  ambient = {};
}

export function spendContext(): SpendContext {
  return als.getStore() || ambient;
}

/** Charge attributed spend that happens outside an agent turn. */
function chargeEnabled(ctx: SpendContext): boolean {
  if (ctx.charge === false) return false;
  const v = (process.env.AGENT_SPEND_CHARGE || '').trim().toLowerCase();
  if (v === '0' || v === 'false') return false;
  return true;
}

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

/** Small in-process ring buffer: lets a route log or a test assert what it spent. */
const recent: SpendEvent[] = [];
export function recentSpend(): readonly SpendEvent[] {
  return recent;
}
export function totalRecentSpendInr(): number {
  return recent.reduce((s, e) => s + (Number.isFinite(e.costInr) ? e.costInr : 0), 0);
}

let missingTableWarned = false;

async function persist(ev: SpendEvent, userId: string | null, settledBy: 'turn' | 'route') {
  const admin = adminClient();
  if (!admin) return;
  try {
    const { error } = await admin.from('usage_events').insert({
      user_id: userId,
      service: ev.service,
      model: ev.model || null,
      units: ev.units ?? null,
      unit: ev.unit || null,
      cost_inr: Number.isFinite(ev.costInr) ? Math.round(ev.costInr * 1e6) / 1e6 : 0,
      priced: ev.priced !== false,
      settled_by: settledBy,
      detail: (ev.detail || '').slice(0, 500),
      meta: ev.meta || null,
    });
    if (error && !missingTableWarned) {
      missingTableWarned = true;
      console.warn(
        `[spend] could not write usage_events (${error.message}). ` +
          `Run sql/migrations/13_usage_events.sql — spend is still logged, just not stored.`
      );
    }
  } catch {
    /* recording is best effort */
  }
}

/**
 * Record one billable vendor call. Safe to call from anywhere; never throws.
 */
export async function recordSpend(ev: SpendEvent): Promise<void> {
  try {
    const costInr = Number.isFinite(ev.costInr) && ev.costInr > 0 ? ev.costInr : 0;
    const normalised: SpendEvent = { ...ev, costInr };
    if (normalised.priced === undefined) normalised.priced = true;

    const ctx = spendContext();
    const userId = ev.userId ?? ctx.userId ?? null;

    recent.push(normalised);
    if (recent.length > 200) recent.shift();

    const meter = meterOf();
    if (meter) {
      // Inside an agent turn: the turn settles the aggregate at 2x.
      if (costInr > 0) {
        meter.add({ label: ev.service, costInr, detail: ev.detail });
      }
      await persist(normalised, userId, 'turn');
      return;
    }

    await persist(normalised, userId, 'route');

    if (costInr > 0 && userId && chargeEnabled(ctx)) {
      const admin = adminClient();
      if (!admin) return;
      const { deductCreditsByCost } = await import('@/utils/credits');
      await deductCreditsByCost(
        admin,
        userId,
        costInr,
        'ai_generation',
        `${ctx.label || ev.service} — ${ev.detail}`.slice(0, 480)
      );
    } else if (costInr > 0 && !userId) {
      // Visible, but unattributed: exactly the case that used to be invisible.
      console.warn(
        `[spend] unattributed ₹${costInr.toFixed(4)} on ${ev.service} — ` +
          `call setSpendContext({ userId }) or runWithSpendContext() at this entry point`
      );
    }
  } catch (err: any) {
    console.warn(`[spend] record failed: ${err?.message || err}`);
  }
}

/** Synchronous variant for places that cannot await (fire-and-forget). */
export function recordSpendSoon(ev: SpendEvent): void {
  void recordSpend(ev);
}

/**
 * Price model tokens with the canonical table in pricing.ts (cache-aware).
 * Returns cost in INR.
 */
export function priceTokensInr(
  modelId: string,
  usage: { input?: number; output?: number; cacheRead?: number } | null | undefined
): number {
  if (!usage) return 0;
  // Lazy require keeps this module importable from scripts that only need the maths.
  const { priceForTextModel } = require('./pricing') as typeof import('./pricing');
  const p = priceForTextModel(modelId);
  const cached = Math.max(0, Number(usage.cacheRead || 0));
  const input = Math.max(0, Number(usage.input || 0));
  const fresh = Math.max(0, input - cached);
  const output = Math.max(0, Number(usage.output || 0));
  return (cached / 1000) * p.cacheHitPer1k + (fresh / 1000) * p.cacheMissPer1k + (output / 1000) * p.outputPer1k;
}
