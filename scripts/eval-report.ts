/* eslint-disable @typescript-eslint/no-explicit-any --
 * CLI script reading untyped Supabase rows for the trend and breach reports.
 */
/**
 * Read the eval history.
 *
 *   npm run eval:report                       recent runs
 *   npm run eval:report -- --runs=30
 *   npm run eval:report -- --tier=behaviour
 *   npm run eval:report -- --breaches --days=90
 *   npm run eval:report -- --case=safety-universal-invariants
 *   npm run eval:report -- --json
 *
 * The question this exists to answer is the one a boolean console line can never
 * answer: IS THE AGENT GETTING BETTER OR WORSE?
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { EvalStore } from '../lib/evals/store';
import { printTrend } from '../lib/evals/report';
import { inr, pct } from '../lib/evals/metrics';
import type { EvalRunSummary } from '../lib/evals/types';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit === `--${name}` ? 'true' : hit.slice(name.length + 3);
}
const flag = (name: string) => arg(name) === 'true';
const num = (name: string, fallback: number) => {
  const v = Number(arg(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

(async () => {
  const store = EvalStore.connect();
  if (!store.available) {
    console.error(`Cannot read eval history — ${store.reason}`);
    console.error('Apply supabase/migrations/20261218000000_agent_eval_system.sql first.');
    process.exit(3);
  }

  // ── per-case trend ────────────────────────────────────────────────────────
  const caseId = arg('case');
  if (caseId && caseId !== 'true') {
    const rows = await store.caseHistory(caseId, num('runs', 30));
    if (flag('json')) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (!rows.length) {
      console.log(`No recorded results for case "${caseId}". Check the id with \`npm run eval:context -- --list\`.`);
      return;
    }
    console.log(`\nCASE HISTORY — ${caseId} (newest first)\n`);
    const passCount = rows.filter((r: any) => r.passed).length;
    console.log(
      `${passCount}/${rows.length} passed (${pct(rows.length ? passCount / rows.length : 0)}) over the last ${rows.length} recorded runs\n`
    );
    for (const r of rows as any[]) {
      const mark = r.passed ? 'PASS' : 'FAIL';
      const transition = r.transition && r.transition !== 'same' && r.transition !== 'new' ? `  (${r.transition})` : '';
      console.log(
        `  ${String(r.created_at).replace('T', ' ').slice(0, 19)}  ${mark}  score ${Number(r.score).toFixed(2)}` +
          `  ${r.cost_inr ? inr(Number(r.cost_inr)) : '—'}  ${r.served_model ?? '—'}${transition}`
      );
    }
    console.log('');
    return;
  }

  // ── guardrail breach history ──────────────────────────────────────────────
  if (flag('breaches')) {
    const days = num('days', 90);
    const rows = await store.guardrailBreaches(days);
    if (flag('json')) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log(`\nGUARDRAIL BREACHES — last ${days} days\n`);
    if (!rows.length) {
      console.log('  None. This is the number to quote to a customer.\n');
      return;
    }
    for (const r of rows as any[]) {
      console.log(`  ${String(r.created_at).replace('T', ' ').slice(0, 19)}  ${r.case_id}  [${r.series}/${r.severity}]`);
      const reasons = Array.isArray(r.failure_reasons) ? r.failure_reasons : [];
      for (const reason of reasons.slice(0, 2)) console.log(`      · ${reason}`);
      if (r.served_model) console.log(`      model: ${r.served_model}`);
    }
    console.log(`\n  ${rows.length} breach(es). Every one of these is a bug, not a data point.\n`);
    return;
  }

  // ── trend ─────────────────────────────────────────────────────────────────
  const tierRaw = arg('tier');
  const tier = tierRaw && tierRaw !== 'true' ? (tierRaw as EvalRunSummary['tier']) : undefined;
  const rows = await store.recentRuns(num('runs', 15), tier);

  if (flag('json')) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  printTrend(rows as any[]);

  // A short read of the trend, because a table of numbers still requires the
  // reader to do the comparison in their head.
  if (rows.length >= 2) {
    const latest: any = rows[0];
    const previous: any = rows[1];
    const dScore = Number(latest.weighted_score ?? 0) - Number(previous.weighted_score ?? 0);
    const arrow = dScore > 0.005 ? '▲ improving' : dScore < -0.005 ? '▼ slipping' : '→ flat';
    console.log(`Since the previous run: ${arrow} (weighted score ${dScore >= 0 ? '+' : ''}${dScore.toFixed(3)})`);
    if (Number(latest.guardrail_breaches ?? 0) > 0) {
      console.log(`⚠ the latest run has ${latest.guardrail_breaches} guardrail breach(es) — treat as a release blocker.`);
    }
    if (latest.suite_hash && previous.suite_hash && latest.suite_hash !== previous.suite_hash) {
      console.log(
        '⚠ the case set changed between these two runs (suite hash differs), so this comparison is approximate.'
      );
    }
    console.log('');
  }
})().catch((err) => {
  console.error('failed:', err?.message || err);
  process.exit(3);
});
