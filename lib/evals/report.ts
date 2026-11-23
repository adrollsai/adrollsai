/* eslint-disable @typescript-eslint/no-explicit-any --
 * Rows read from Supabase carry numeric columns that arrive as strings and status columns the generated types do not know about.
 */
/**
 * Reporting: console output, a markdown artifact and a JSON artifact.
 *
 * Three audiences, three formats, one source of truth.
 *
 *   console   a human watching a run, who needs to know in five seconds whether
 *             anything broke and which case it was.
 *   markdown  the same human a week later, and anyone in a PR or an investor
 *             conversation, who needs the per-category picture and the failure
 *             reasons without reading code.
 *   json      machines: the trend query, a dashboard, and the diff between two
 *             runs. Full transcripts live here and only here — the database keeps
 *             a trimmed excerpt because a transcript can hold customer data.
 *
 * A deliberate rule throughout: never print one headline number on its own. The
 * pass rate is always printed next to the guardrail-breach count, because an
 * average is precisely the number that hides a safety regression.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cell, inr, pct } from './metrics';
import { judgeLabel } from './judge';
import type { EvalCaseResult, EvalRunSummary } from './types';

export interface ReportMeta {
  startedAt: Date;
  finishedAt: Date;
  baselineRunId?: string | null;
  baselineStartedAt?: string | null;
  runId?: string | null;
  persisted: boolean;
  persistNote?: string | null;
  budgetExceeded?: boolean;
  warnings?: string[];
  /** Where the JSON/markdown artifacts were written, when they were. */
  artifactDir?: string | null;
}

const TRANSITION_MARK: Record<string, string> = {
  regression: '▼ REGRESSED',
  improvement: '▲ improved',
  new: 'new',
  same: '',
};

/** The console scorecard. */
export function printRunReport(
  results: EvalCaseResult[],
  summary: EvalRunSummary,
  meta: ReportMeta
): void {
  const showBaseline = results.some((r) => r.transition && r.transition !== 'new');

  console.log('');
  console.log(
    `NOBOGENT AGENT EVAL — ${summary.tier} — ${meta.startedAt.toISOString().replace('T', ' ').slice(0, 19)}`
  );
  console.log(
    `suite ${summary.suiteVersion} (${summary.suiteHash.slice(0, 12)})  model ${summary.modelPrimary ?? '—'}` +
      (summary.judgeModel ? `  judge ${summary.judgeModel}` : '  judge off') +
      (summary.repeat > 1 ? `  repeat ${summary.repeat}` : '')
  );
  console.log('');

  const idW = 42;
  const header =
    cell('CASE', idW) +
    cell('SERIES', 13) +
    cell('SEV', 8) +
    cell('RESULT', 8) +
    cell('SCORE', 7) +
    cell('TOOLS', 9) +
    cell('STEPS', 6) +
    cell('COST', 10) +
    cell('MS', 7) +
    (summary.judgeModel ? cell('JUDGE', 9) : '') +
    (showBaseline ? 'TREND' : '');
  console.log(header);
  console.log('─'.repeat(Math.min(header.length, 160)));

  for (const r of results) {
    const result = r.passed ? 'PASS' : r.guardrailBreach ? 'BREACH' : 'FAIL';
    const tools = r.toolAccuracy === null ? '—' : `${Math.round(r.toolAccuracy * 100)}%`;
    console.log(
      cell(r.caseId, idW) +
        cell(r.series, 13) +
        cell(r.severity, 8) +
        cell(result, 8) +
        cell(r.score.toFixed(2), 7) +
        cell(tools, 9) +
        cell(r.steps === null ? '—' : String(r.steps), 6) +
        cell(r.costInr ? inr(r.costInr) : '—', 10) +
        cell(r.latencyMs === null ? '—' : String(r.latencyMs), 7) +
        (summary.judgeModel ? cell(judgeLabel(r.judge), 9) : '') +
        (showBaseline ? TRANSITION_MARK[r.transition ?? 'new'] ?? '' : '')
    );
  }

  console.log('─'.repeat(Math.min(header.length, 160)));
  console.log('');

  // ── failures first: the reason anyone is reading this ──────────────────────
  const failures = results.filter((r) => !r.passed);
  if (failures.length) {
    console.log(`FAILURES (${failures.length})`);
    for (const f of failures) {
      console.log(`  ✗ ${f.caseId} — ${f.title}`);
      for (const reason of f.failureReasons.slice(0, 4)) console.log(`      · ${reason}`);
      if (f.replyExcerpt) console.log(`      reply: ${f.replyExcerpt.slice(0, 180)}`);
    }
    console.log('');
  }

  // ── per-series rollup: the number that must never be replaced by an average ─
  if (summary.bySeries.length > 1) {
    console.log('BY CATEGORY');
    for (const s of summary.bySeries) {
      const flag = s.breaches ? `  ⚠ ${s.breaches} BREACH` : '';
      console.log(
        `  ${cell(s.series, 14)} ${cell(`${s.passed}/${s.total}`, 8)} ${cell(pct(s.total ? s.passed / s.total : 0), 7)} score ${s.score.toFixed(2)}${flag}`
      );
    }
    console.log('');
  }

  // ── the scorecard footer ──────────────────────────────────────────────────
  console.log(
    `PASS RATE  ${summary.passedCases}/${summary.totalCases} (${pct(summary.passRate)})` +
      `   WEIGHTED SCORE ${summary.weightedScore.toFixed(3)}`
  );
  console.log(
    `GUARDRAIL BREACHES  ${summary.guardrailBreaches}` +
      (summary.flakyCases ? `   FLAKY  ${summary.flakyCases}` : '') +
      (summary.regressions ? `   ▼ REGRESSIONS  ${summary.regressions}` : '') +
      (summary.improvements ? `   ▲ IMPROVEMENTS  ${summary.improvements}` : '')
  );
  console.log(
    `COST  ${inr(summary.totalCostInr)}   TOKENS  ${summary.totalTokensIn} in / ${summary.totalTokensOut} out` +
      (summary.p50LatencyMs !== null ? `   LATENCY  p50 ${summary.p50LatencyMs}ms p95 ${summary.p95LatencyMs}ms` : '')
  );

  if (summary.guardrailBreaches > 0) {
    console.log('');
    console.log('⚠ A GUARDRAIL WAS BREACHED. This run fails regardless of the pass rate above —');
    console.log('  an agent that spends or messages without approval is not "mostly working".');
  }

  console.log('');
  console.log(`VERDICT: ${summary.verdict.toUpperCase()}`);
  if (meta.budgetExceeded) {
    console.log('⚠ BUDGET CAP REACHED — the suite stopped early. Results above are partial and');
    console.log('  must not be compared to a full run as if they were the same measurement.');
  }
  if (!meta.persisted) {
    console.log(`⚠ HISTORY NOT SAVED — ${meta.persistNote ?? 'no database'}. This run cannot be trended.`);
  }
  for (const w of meta.warnings ?? []) console.log(`note: ${w}`);
  console.log('');
}

/** Markdown artifact — the version that gets read, pasted and forwarded. */
export function renderMarkdown(
  results: EvalCaseResult[],
  summary: EvalRunSummary,
  meta: ReportMeta
): string {
  const lines: string[] = [];
  const stamp = meta.startedAt.toISOString().replace('T', ' ').slice(0, 19);

  lines.push(`# Nobogent agent eval — ${summary.tier} tier`);
  lines.push('');
  lines.push(`**Verdict: ${summary.verdict.toUpperCase()}** · ${stamp} · suite ${summary.suiteVersion}`);
  lines.push('');

  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Cases passed | ${summary.passedCases} / ${summary.totalCases} (${pct(summary.passRate)}) |`);
  lines.push(`| Weighted score | ${summary.weightedScore.toFixed(3)} |`);
  lines.push(`| **Guardrail breaches** | **${summary.guardrailBreaches}** |`);
  if (summary.flakyCases) lines.push(`| Flaky cases | ${summary.flakyCases} |`);
  if (summary.regressions) lines.push(`| Regressions | ${summary.regressions} |`);
  if (summary.improvements) lines.push(`| Improvements | ${summary.improvements} |`);
  lines.push(`| Vendor cost | ${inr(summary.totalCostInr)} |`);
  lines.push(`| Tokens | ${summary.totalTokensIn} in / ${summary.totalTokensOut} out |`);
  if (summary.p50LatencyMs !== null) {
    lines.push(`| Latency | p50 ${summary.p50LatencyMs}ms / p95 ${summary.p95LatencyMs}ms |`);
  }
  lines.push(`| Model | ${summary.modelPrimary ?? '—'} |`);
  if (summary.judgeModel) lines.push(`| Judge | ${summary.judgeModel} |`);
  if (summary.gitSha) lines.push(`| Commit | ${summary.gitSha.slice(0, 12)} |`);
  lines.push(`| Suite hash | \`${summary.suiteHash.slice(0, 16)}\` |`);
  lines.push('');

  if (summary.bySeries.length > 1) {
    lines.push('## By category');
    lines.push('');
    lines.push('| Category | Passed | Rate | Score | Breaches |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const s of summary.bySeries) {
      lines.push(
        `| ${s.series} | ${s.passed}/${s.total} | ${pct(s.total ? s.passed / s.total : 0)} | ${s.score.toFixed(2)} | ${s.breaches || '—'} |`
      );
    }
    lines.push('');
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push('## Failures');
    lines.push('');
    for (const f of failures) {
      lines.push(`### ${f.passed ? '' : '✗ '}${f.caseId}`);
      lines.push(`*${f.title}* — ${f.series} / ${f.severity}${f.guardrailBreach ? ' — **GUARDRAIL BREACH**' : ''}`);
      lines.push('');
      for (const reason of f.failureReasons) lines.push(`- ${reason}`);
      if (f.toolsCalled.length) lines.push(`- tools called: \`${f.toolsCalled.join('`, `')}\``);
      if (f.replyExcerpt) lines.push(`- reply: ${f.replyExcerpt.slice(0, 400)}`);
      if (f.judge && !f.judge.error) {
        lines.push(`- judge (${f.judge.overall.toFixed(1)}/3, ${f.judge.verdict}): ${f.judge.reasoning}`);
      }
      lines.push('');
    }
  }

  if (summary.regressions > 0) {
    lines.push('## Regressions vs baseline');
    lines.push('');
    lines.push(
      meta.baselineRunId
        ? `Baseline run \`${meta.baselineRunId.slice(0, 8)}\` (${meta.baselineStartedAt ?? 'unknown time'}).`
        : ''
    );
    lines.push('');
    for (const r of results.filter((x) => x.transition === 'regression')) {
      lines.push(`- **${r.caseId}** passed before, fails now — ${r.failureReasons[0] ?? 'see detail'}`);
    }
    lines.push('');
  }

  lines.push('## All cases');
  lines.push('');
  lines.push('| Case | Category | Severity | Result | Score | Tools | Steps | Cost | ms |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const result = r.passed ? 'PASS' : r.guardrailBreach ? '**BREACH**' : 'FAIL';
    lines.push(
      `| \`${r.caseId}\` | ${r.series} | ${r.severity} | ${result} | ${r.score.toFixed(2)} | ${
        r.toolAccuracy === null ? '—' : `${Math.round(r.toolAccuracy * 100)}%`
      } | ${r.steps ?? '—'} | ${r.costInr ? inr(r.costInr) : '—'} | ${r.latencyMs ?? '—'} |`
    );
  }
  lines.push('');

  if (meta.budgetExceeded) {
    lines.push('> ⚠ **Budget cap reached** — this run stopped early and is partial.');
    lines.push('');
  }
  if (!meta.persisted) {
    lines.push(`> ⚠ **History not saved** — ${meta.persistNote ?? 'no database'}.`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write the JSON and markdown artifacts.
 *
 * Best-effort by design: a full disk must not fail a suite that already measured
 * the agent. Returns the paths it managed to write.
 */
export function writeArtifacts(
  results: EvalCaseResult[],
  summary: EvalRunSummary,
  meta: ReportMeta
): { jsonPath: string | null; mdPath: string | null; dir: string | null } {
  try {
    const dir = meta.artifactDir ?? path.resolve(process.cwd(), 'evals', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = meta.startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = `${stamp}-${summary.tier}`;

    const jsonPath = path.join(dir, `${base}.json`);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          meta: {
            ...meta,
            startedAt: meta.startedAt.toISOString(),
            finishedAt: meta.finishedAt.toISOString(),
            durationMs: meta.finishedAt.getTime() - meta.startedAt.getTime(),
          },
          summary,
          results,
        },
        null,
        2
      ),
      'utf8'
    );

    const mdPath = path.join(dir, `${base}.md`);
    fs.writeFileSync(mdPath, renderMarkdown(results, summary, meta), 'utf8');

    return { jsonPath, mdPath, dir };
  } catch (err: any) {
    console.warn(`[evals] could not write artifacts: ${err?.message || err}`);
    return { jsonPath: null, mdPath: null, dir: null };
  }
}

/** The trend table: is the agent getting better or worse? */
export function printTrend(rows: any[]): void {
  if (!rows.length) {
    console.log('No completed eval runs recorded yet. Run `npm run eval:all` first.');
    return;
  }
  console.log('');
  console.log('EVAL TREND (completed runs, newest first)');
  console.log('');
  const header =
    cell('STARTED', 20) + cell('TIER', 10) + cell('PASS', 10) + cell('SCORE', 8) + cell('BREACH', 8) +
    cell('REGR', 6) + cell('COST', 10) + cell('VERDICT', 10) + 'MODEL';
  console.log(header);
  console.log('─'.repeat(Math.min(header.length + 16, 140)));
  for (const r of rows) {
    console.log(
      cell(String(r.started_at).replace('T', ' ').slice(0, 19), 20) +
        cell(String(r.tier), 10) +
        cell(`${r.passed_cases}/${r.total_cases}`, 10) +
        cell(Number(r.weighted_score ?? 0).toFixed(3), 8) +
        cell(String(r.guardrail_breaches ?? 0), 8) +
        cell(String(r.regressions ?? 0), 6) +
        cell(inr(Number(r.total_cost_inr ?? 0)), 10) +
        cell(String(r.verdict ?? '—').toUpperCase(), 10) +
        String(r.model_primary ?? '—')
    );
  }
  console.log('');
}
