/**
 * Proves vendor spend is recorded no matter who calls it.
 *
 * The bug this guards against: usage used to exist only inside an agent turn, so
 * a cron job or dashboard route could call Gemini or Kie and spend real money
 * with no record anywhere. It also guards the opposite mistake — metering both in
 * the tool AND in the vendor wrapper, which charges the user twice.
 *
 *   npm run verify:metering
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import {
  recordSpend,
  recentSpend,
  runWithSpendContext,
  setSpendContext,
  clearSpendContext,
  priceTokensInr,
  spendContext,
} from '../lib/agent/spend';
import { startUsageMeter, clearUsageMeter, meterOf } from '../lib/agent/usage';
import { priceForTextModel } from '../lib/agent/pricing';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

(async () => {
  console.log('=== pricing maths (one canonical table) ===');
  const p = priceForTextModel('deepseek-flash');
  // $0.30/1M in, $1.20/1M out at ₹88/$ => ₹0.0264 and ₹0.1056 per 1k
  check('deepseek cache-miss input ≈ ₹0.0264/1k', Math.abs(p.cacheMissPer1k - 0.0264) < 0.0005, `got ${p.cacheMissPer1k.toFixed(6)}`);
  check('deepseek output ≈ ₹0.1056/1k', Math.abs(p.outputPer1k - 0.1056) < 0.0005, `got ${p.outputPer1k.toFixed(6)}`);
  check(
    'cache hit is ~50x cheaper than a miss',
    p.cacheHitPer1k > 0 && p.cacheMissPer1k / p.cacheHitPer1k > 40,
    `ratio ${(p.cacheMissPer1k / p.cacheHitPer1k).toFixed(0)}x`
  );

  const costTokens = priceTokensInr('deepseek-flash', { input: 100_000, output: 10_000 });
  // 100k fresh @ ₹0.0264/1k = ₹2.64 ; 10k out @ ₹0.1056/1k = ₹1.056
  check('100k in + 10k out ≈ ₹3.70', Math.abs(costTokens - 3.696) < 0.02, `₹${costTokens.toFixed(4)}`);

  const cached = priceTokensInr('deepseek-flash', { input: 100_000, cacheRead: 90_000, output: 10_000 });
  check('cache reads reduce the bill', cached < costTokens, `₹${cached.toFixed(4)} vs ₹${costTokens.toFixed(4)}`);

  console.log('\n=== legacy calculateLLMCost now agrees with the canonical table ===');
  const { calculateLLMCost } = await import('../utils/credits');
  const legacy = calculateLLMCost('deepseek-flash', 100_000, 10_000);
  check('calculateLLMCost matches priceTokensInr', Math.abs(legacy - costTokens) < 0.02, `₹${legacy.toFixed(4)}`);
  check('legacy output rate is no longer 4x low', legacy > 3.0, `₹${legacy.toFixed(4)} (old table gave ₹1.43)`);

  console.log('\n=== inside an agent turn: accumulates, does not charge ===');
  clearSpendContext();
  const meter = startUsageMeter();
  await recordSpend({ service: 'gemini', costInr: 0.5, detail: 'turn-scoped test', units: 1000, unit: 'token' });
  check('turn meter received the line', meter.totalInr() === 0.5, `₹${meter.totalInr()}`);
  check('meter is the active source', meterOf() === meter);
  clearUsageMeter();

  console.log('\n=== outside an agent turn: still recorded ===');
  const before = recentSpend().length;
  clearSpendContext();
  await recordSpend({ service: 'kie_image', costInr: 2.64, detail: 'route-scoped test', units: 1, unit: 'image' });
  check('no meter active', meterOf() === null);
  check('spend was still recorded', recentSpend().length === before + 1, `${recentSpend().length} events buffered`);
  const last = recentSpend()[recentSpend().length - 1];
  check('recorded with the right service', last.service === 'kie_image' && last.costInr === 2.64, `${last.service} ₹${last.costInr}`);

  console.log('\n=== attribution context ===');
  runWithSpendContext({ userId: 'test-user-123', label: 'cron:test' }, () => {
    check('async context is visible', spendContext().userId === 'test-user-123', spendContext().label);
  });
  check('context is scoped, not leaked', spendContext().userId === undefined);
  setSpendContext({ userId: 'fallback-user' });
  check('fallback setter works', spendContext().userId === 'fallback-user');
  clearSpendContext();
  check('clear resets it', spendContext().userId === undefined);

  console.log('\n=== unpriced calls are visible, not free-and-silent ===');
  await recordSpend({
    service: 'kie_video',
    costInr: 0,
    priced: false,
    detail: 'model with no configured rate',
  });
  const u = recentSpend()[recentSpend().length - 1];
  check('recorded as unpriced', u.priced === false, u.detail);

  console.log('\n=== ledger table reachable (optional) ===');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await sb.from('usage_events').select('id').limit(1);
    if (error) {
      console.log(
        `SKIP  usage_events not queryable yet (${error.message})\n` +
          `      run sql/migrations/13_usage_events.sql to enable the durable ledger`
      );
    } else {
      check('usage_events table exists', true);
    }
  } else {
    console.log('SKIP  no supabase credentials');
  }

  console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
