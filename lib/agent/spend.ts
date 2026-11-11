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
 * Open a spend record without committing money yet.
 *
 * Metering at submission was wrong in one direction: a Kie job can be created and
 * then fail (a TTS task that dies with "generate task timeout" produces nothing),
 * and billing it would charge for output that never existed. Metering only in the
 * tool was wrong in the other: anything outside an agent turn vanished.
 *
 * So the row is born `pending` with cost 0, and only becomes `settled` when the
 * result is in hand, or `void` when the job fails. A row left `pending` means we
 * never learned the outcome, which is worth seeing rather than hiding.
 */
export async function beginSpend(ev: SpendEvent & { ref?: string }): Promise<string | null> {
  try {
    const ctx = spendContext();
    const userId = ev.userId ?? ctx.userId ?? null;
    const admin = adminClient();
    if (!admin) return null;
    const { data, error } = await admin
      .from('usage_events')
      .insert({
        user_id: userId,
        service: ev.service,
        model: ev.model || null,
        units: ev.units ?? null,
        unit: ev.unit || null,
        cost_inr: 0,
        priced: ev.priced !== false,
        state: 'pending',
        settled_by: meterOf() ? 'turn' : 'route',
        detail: (ev.detail || '').slice(0, 500),
        meta: ev.meta || null,
        ref: ev.ref || null,
      })
      .select('id')
      .maybeSingle();
    if (error) {
      if (!missingTableWarned) {
        missingTableWarned = true;
        console.warn(`[spend] beginSpend failed (${error.message}) — continuing unmetered`);
      }
      return null;
    }
    return data?.id != null ? String(data.id) : null;
  } catch {
    return null;
  }
}

/**
 * Commit a pending record — this is where money is actually charged, at the point
 * the vendor has delivered. The amount may be refined from the submission estimate.
 */
export async function finalizeSpend(
  id: string | null,
  patch: { costInr?: number; units?: number; detail?: string } = {}
): Promise<void> {
  if (!id) return;
  try {
    const meter = meterOf();
    const costInr =
      Number.isFinite(patch.costInr) && (patch.costInr as number) > 0 ? (patch.costInr as number) : 0;
    const admin = adminClient();

    let row: any = null;
    if (admin) {
      const { data } = await admin
        .from('usage_events')
        .select('id, service, detail, units, unit, priced, model')
        .eq('id', id)
        .maybeSingle();
      row = data || null;
      await admin
        .from('usage_events')
        .update({
          cost_inr: costInr,
          state: 'settled',
          settled_at: new Date().toISOString(),
          ...(patch.units != null ? { units: patch.units } : {}),
          ...(patch.detail ? { detail: patch.detail.slice(0, 500) } : {}),
        })
        .eq('id', id);
    }

    if (costInr <= 0) return;

    const label = row?.service || 'vendor';
    const detail = patch.detail || row?.detail || '';
    recent.push({ service: label as SpendService, costInr, detail });
    if (recent.length > 200) recent.shift();

    if (meter) {
      meter.add({ label, costInr, detail });
      return;
    }
    const ctx = spendContext();
    if (ctx.userId && chargeEnabled(ctx) && admin) {
      const { deductCreditsByCost } = await import('@/utils/credits');
      await deductCreditsByCost(
        admin as any,
        ctx.userId,
        costInr,
        'ai_generation',
        `${ctx.label || label} — ${detail}`.slice(0, 480)
      );
    }
  } catch (err: any) {
    console.warn(`[spend] finalize failed: ${err?.message || err}`);
  }
}

/** Close a pending record that produced nothing. Charges nothing. */
export async function voidSpend(id: string | null, reason: string): Promise<void> {
  if (!id) return;
  try {
    const admin = adminClient();
    if (!admin) return;
    await admin
      .from('usage_events')
      .update({
        state: 'void',
        cost_inr: 0,
        settled_at: new Date().toISOString(),
        detail: `voided: ${reason}`.slice(0, 500),
      })
      .eq('id', id);
  } catch {
    /* best effort */
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
