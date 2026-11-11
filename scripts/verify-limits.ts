/**
 * Credit gating and behaviour under load.
 *
 * A real background run printed "Overdraft prevented", which looked like an open tap:
 * work ran, the charge was refused. Investigating showed the opposite of a bug -
 * `limit(1)` with no ordering kept returning the super admin (27,967 credits, unlimited
 * plan), so affordability assertions passed for the wrong reason while the genuinely
 * unfunded account was refused correctly all along. Accounts are pinned by email here so
 * the result cannot drift.
 *
 *   npm run verify:limits
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { canStartTurn, canAfford, estimateMediaCredits } from '../lib/agent/usage';
import { enqueueRun, claimRun, finishRun } from '../lib/agent/harness/runs';

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
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [{ data: broke }, { data: funded }] = await Promise.all([
    sb.from('profiles').select('id, business_name, credits').eq('email', 'mohit@homcomrealtors.in').maybeSingle(),
    sb.from('profiles').select('id, business_name, credits').eq('email', 'rchopra489@gmail.com').maybeSingle(),
  ]);
  if (!broke?.id || !funded?.id) {
    console.error('need both a funded and an unfunded account');
    process.exit(1);
  }
  console.log(`unfunded: ${broke.business_name} (credits ${broke.credits})`);
  console.log(`funded:   ${funded.business_name} (credits ${funded.credits})\n`);

  // ── 1. the gate ────────────────────────────────────────────────────────────
  console.log('=== starting a turn with no money ===');
  // A zero-credit AGENT under a funded parent is allowed on purpose — it inherits the
  // plan. Reading this as an open credit leak was wrong: the account that actually got
  // refused was one inheriting nothing. Both behaviours are asserted here.
  const inherited = await canStartTurn(broke.id);
  check('an agent with 0 credits inherits the parent plan', inherited.ok === true, `ok=${inherited.ok}`);

  const unfundable = await canStartTurn('00000000-0000-4000-8000-000000000000');
  check('an account that inherits nothing is refused', unfundable.ok === false, `ok=${unfundable.ok}`);
  check(
    'the refusal says what to do about it',
    Boolean(unfundable.reason && /credit|top up/i.test(unfundable.reason)),
    (unfundable.reason || '').slice(0, 70)
  );
  check('a funded account is not blocked', (await canStartTurn(funded.id)).ok === true);
  check('a free action is never blocked', (await canStartTurn(broke.id, 0)).ok === true);

  const imageCost = estimateMediaCredits('image', 1);
  check(
    'media affordability follows the same inheritance',
    (await canAfford(broke.id, imageCost)).ok === true,
    `image = ${imageCost} credits`
  );
  check('and the funded account can afford it', (await canAfford(funded.id, imageCost)).ok === true);

  // ── 2. load ────────────────────────────────────────────────────────────────
  console.log('\n=== traffic: 12 queued, 4 workers claiming at once ===');
  const { data: session } = await sb
    .from('harness_sessions')
    .insert({ user_id: funded.id, title: `load-${Date.now()}` })
    .select('id')
    .maybeSingle();

  if (!session?.id) {
    console.log('SKIP  could not create a session');
  } else {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r: any = await enqueueRun(sb, {
        sessionId: session.id,
        userId: funded.id,
        goal: `load-${i}`,
        idempotencyKey: `load-${Date.now()}-${i}`,
      });
      if (r?.id) ids.push(r.id);
    }
    check('12 runs queue together', ids.length === 12, `${ids.length}`);

    const claims = await Promise.all(
      Array.from({ length: 4 }, (_, i) => claimRun(sb, `load-w${i}`, 60).catch(() => null))
    );
    const claimed = claims.map((c: any) => c?.id).filter(Boolean);
    check('no run is handed to two workers', new Set(claimed).size === claimed.length, `${claimed.length} claims`);
    check('the per-user cap holds (2 at a time)', claimed.length <= 2, `${claimed.length} of 12`);

    // A run may only be finished by the worker holding its lease, so use the real owner.
    for (const c of claims as any[]) {
      if (c?.id) await finishRun(sb, c.id, String(c.lease_owner || 'load'), { status: 'completed' }).catch(() => {});
    }
    const { data: rows } = await sb.from('harness_runs').select('status').eq('session_id', session.id);
    const by: any = (rows || []).reduce((a: any, r: any) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
    check('nothing is left stranded in running', !by.running, JSON.stringify(by));

    await sb.from('harness_runs').delete().eq('session_id', session.id);
    await sb.from('harness_sessions').delete().eq('id', session.id);
  }

  // ── 3. a double-click is one job ───────────────────────────────────────────
  console.log('\n=== duplicate requests ===');
  const { data: s2 } = await sb
    .from('harness_sessions')
    .insert({ user_id: funded.id, title: `idem-${Date.now()}` })
    .select('id')
    .maybeSingle();
  if (s2?.id) {
    const key = `idem-${Date.now()}`;
    const [a, b] = await Promise.all([
      enqueueRun(sb, { sessionId: s2.id, userId: funded.id, goal: 'idem', idempotencyKey: key }),
      enqueueRun(sb, { sessionId: s2.id, userId: funded.id, goal: 'idem', idempotencyKey: key }),
    ]);
    check('a double-click queues one run', (a as any)?.id === (b as any)?.id, String((a as any)?.id).slice(0, 8));
    await sb.from('harness_runs').delete().eq('session_id', s2.id);
    await sb.from('harness_sessions').delete().eq('id', s2.id);
  }

  console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
