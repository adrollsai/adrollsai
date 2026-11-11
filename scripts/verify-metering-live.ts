/**
 * Live proof: a real vendor call made entirely outside an agent turn must land
 * on the ledger. Charging is suppressed (charge:false) so this never bills a
 * real customer.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { callGeminiWithUsage } from '../utils/external-apis';
import { runWithSpendContext } from '../lib/agent/spend';

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profile } = await sb.from('profiles').select('id, business_name').limit(1).maybeSingle();
  console.log(`attributing to: ${profile?.business_name} (${profile?.id})`);

  const before = await sb.from('usage_events').select('id', { count: 'exact', head: true });

  await runWithSpendContext(
    { userId: profile?.id ?? null, label: 'verify:metering-live', charge: false },
    async () => {
      const res = await callGeminiWithUsage('Reply with the single word: ok', undefined);
      console.log(`model replied: "${res.text.slice(0, 40)}" (${res.promptTokens} in / ${res.completionTokens} out)`);
    }
  );

  const { data: rows, error, count } = await sb
    .from('usage_events')
    .select('id, created_at, user_id, service, model, units, unit, cost_inr, priced, settled_by, detail')
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }

  console.log(`\nrows before: ${before.count ?? 0}  after: ${count ?? '?'}\n`);
  for (const r of rows || []) {
    console.log(
      `  ${r.created_at} | ${r.service.padEnd(10)} | ${String(r.model).padEnd(22)} | ` +
        `${r.units} ${r.unit} | ₹${Number(r.cost_inr).toFixed(6)} | priced=${r.priced} | ${r.settled_by}`
    );
    console.log(`     ${r.detail}`);
  }

  // The LLM router may send a text call to DeepSeek rather than Gemini; either
  // way it must have been recorded.
  const fresh = (rows || []).find(
    (r) => String(r.detail || '').includes('in ') && ['gemini', 'deepseek'].includes(String(r.service))
  );
  console.log(
    fresh
      ? '\nPASS — the call was recorded on the ledger without any agent turn being involved.'
      : '\nFAIL — no matching ledger row appeared.'
  );
  process.exit(fresh ? 0 : 1);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
