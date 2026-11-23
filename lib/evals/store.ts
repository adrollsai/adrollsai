/* eslint-disable @typescript-eslint/no-explicit-any --
 * Supabase returns untyped rows here. supabase/database.types.ts is generated and predates agent_eval_runs / agent_eval_results (20261218000000_agent_eval_system.sql), so typing these queries against it would emit a false error for every column. This is the same trade-off utils/credits.ts and utils/voice-helper.ts already make for the same reason. Running `npm run update-types` makes this disable removable.
 */
/**
 * Persistence for eval runs.
 *
 * THE ONE RULE HERE: telemetry must never break the measurement.
 *
 * Every method degrades to a no-op if the table is missing or the database is
 * unreachable, exactly like `recordRunArtefact()` in the video skill. A suite that
 * refuses to score the agent because it could not write a telemetry row would be
 * a suite people disable — and a disabled safety net is worse than none, because
 * it is believed to exist.
 *
 * What is NOT optional is the exit code. A run whose results failed to persist
 * still reports PASS/FAIL truthfully; it just says loudly that history was lost.
 */
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EvalCaseResult, EvalRunSummary } from './types';

export interface RunDeclaration {
  tier: EvalRunSummary['tier'];
  suiteVersion: string;
  suiteHash: string;
  gitSha: string | null;
  modelPrimary: string | null;
  judgeModel: string | null;
  profileId: string | null;
  repeat: number;
}

export interface BaselineSnapshot {
  runId: string;
  startedAt: string;
  outcomes: Map<string, boolean>;
}

/** Postgres undefined_table, plus the REST error shapes Supabase wraps it in. */
function isMissingTable(error: any): boolean {
  const code = String(error?.code ?? '');
  const msg = String(error?.message ?? '');
  return code === '42P01' || /does not exist|relation .* not found|schema cache/i.test(msg);
}

export class EvalStore {
  private sb: SupabaseClient | null;
  private warned = false;
  /** False once we have learned the tables are absent. Public so the CLI can report it. */
  available = true;
  /** Why persistence is off, when it is. */
  reason: string | null = null;

  constructor(sb: SupabaseClient | null) {
    this.sb = sb;
    if (!sb) {
      this.available = false;
      this.reason = 'no Supabase credentials in the environment';
    }
  }

  /** Build a service-role client from env. Returns a disabled store if unconfigured. */
  static connect(): EvalStore {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return new EvalStore(null);
    try {
      return new EvalStore(createClient(url, key, { auth: { persistSession: false } }));
    } catch (err: any) {
      const s = new EvalStore(null);
      s.reason = `client construction failed: ${err?.message || err}`;
      return s;
    }
  }

  /** Turn a failed write into a warning, once. */
  private degrade(op: string, error: any): void {
    if (isMissingTable(error)) {
      this.available = false;
      this.reason = 'agent_eval_runs / agent_eval_results do not exist — apply 20261218000000_agent_eval_system.sql';
    } else {
      this.reason = `${op}: ${error?.message ?? 'unknown error'}`;
    }
    if (!this.warned) {
      this.warned = true;
      console.warn(`[evals] history disabled — ${this.reason}`);
    }
  }

  /**
   * Open a run.
   *
   * The id is minted here rather than by the database so results can be attached
   * (and a run referenced as a baseline) without waiting on a round trip. The row
   * starts as 'running' so a crashed suite leaves evidence instead of vanishing
   * into "no runs since yesterday".
   */
  async startRun(decl: RunDeclaration): Promise<string | null> {
    if (!this.sb || !this.available) return null;
    const runId = crypto.randomUUID();
    const { error } = await this.sb.from('agent_eval_runs').insert({
      run_id: runId,
      tier: decl.tier,
      status: 'running',
      suite_version: decl.suiteVersion,
      suite_hash: decl.suiteHash,
      git_sha: decl.gitSha,
      model_primary: decl.modelPrimary,
      judge_model: decl.judgeModel,
      profile_id: decl.profileId,
      repeat: decl.repeat,
      started_at: new Date().toISOString(),
    });
    if (error) {
      this.degrade('startRun', error);
      return null;
    }
    return runId;
  }

  async saveResult(runId: string, r: EvalCaseResult): Promise<boolean> {
    if (!this.sb || !this.available) return false;
    const { error } = await this.sb.from('agent_eval_results').insert({
      run_id: runId,
      case_id: r.caseId,
      case_title: r.title,
      tier: r.tier,
      series: r.series,
      severity: r.severity,
      passed: r.passed,
      score: round4(r.score),
      guardrail_breach: r.guardrailBreach,
      tool_accuracy: r.toolAccuracy === null ? null : round4(r.toolAccuracy),
      steps: r.steps,
      tokens_in: r.tokensIn,
      tokens_out: r.tokensOut,
      cost_inr: round4(r.costInr),
      latency_ms: r.latencyMs,
      served_model: r.servedModel,
      approval_gate_hit: r.approvalGateHit,
      assertions: r.assertions,
      failure_reasons: r.failureReasons,
      tools_called: r.toolsCalled,
      reply_excerpt: r.replyExcerpt,
      judge: r.judge,
      flaky: r.flaky,
      repeat_passed: r.repeatPassed,
      repeat_total: r.repeatTotal,
      baseline_passed: r.baselinePassed ?? null,
      transition: r.transition ?? null,
    });
    if (error) {
      this.degrade('saveResult', error);
      return false;
    }
    return true;
  }

  /**
   * Close a run with the scorecard.
   *
   * `status` is 'completed' only when the suite actually finished every selected
   * case. 'aborted' (budget or interrupt) and 'failed' are distinct so the trend
   * query can exclude them: an aborted run is not evidence the agent got worse.
   */
  async finishRun(
    runId: string,
    summary: EvalRunSummary,
    status: 'completed' | 'aborted' | 'failed',
    opts: { baselineRunId?: string | null; notes?: string } = {}
  ): Promise<boolean> {
    if (!this.sb || !this.available) return false;
    const { error } = await this.sb
      .from('agent_eval_runs')
      .update({
        status,
        // The model is only known once the runner has resolved it, so it is
        // written here rather than in startRun.
        model_primary: summary.modelPrimary ?? null,
        total_cases: summary.totalCases,
        passed_cases: summary.passedCases,
        failed_cases: summary.failedCases,
        pass_rate: round4(summary.passRate),
        weighted_score: round4(summary.weightedScore),
        guardrail_breaches: summary.guardrailBreaches,
        flaky_cases: summary.flakyCases,
        total_cost_inr: round4(summary.totalCostInr),
        total_tokens_in: summary.totalTokensIn,
        total_tokens_out: summary.totalTokensOut,
        p50_latency_ms: summary.p50LatencyMs,
        p95_latency_ms: summary.p95LatencyMs,
        baseline_run_id: opts.baselineRunId ?? null,
        regressions: summary.regressions,
        improvements: summary.improvements,
        verdict: summary.verdict,
        by_series: Object.fromEntries(summary.bySeries.map((s) => [s.series, s])),
        notes: opts.notes ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq('run_id', runId);
    if (error) {
      this.degrade('finishRun', error);
      return false;
    }
    return true;
  }

  /**
   * Fix a run that died mid-flight.
   *
   * A 'running' row left behind by a crash would otherwise look like a run that
   * is perpetually in progress, and would be excluded from the trend forever with
   * no explanation.
   */
  async markStale(runId: string, reason: string): Promise<void> {
    if (!this.sb || !this.available) return;
    await this.sb
      .from('agent_eval_runs')
      .update({ status: 'failed', notes: reason.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq('run_id', runId)
      .eq('status', 'running');
  }

  /** Most recent COMPLETED runs, newest first. Used by the trend report. */
  async recentRuns(limit = 10, tier?: EvalRunSummary['tier']) {
    if (!this.sb || !this.available) return [];
    let q = this.sb
      .from('agent_eval_runs')
      .select(
        'run_id, tier, started_at, finished_at, git_sha, model_primary, suite_version, suite_hash, total_cases, passed_cases, pass_rate, weighted_score, guardrail_breaches, flaky_cases, regressions, improvements, total_cost_inr, p50_latency_ms, p95_latency_ms, verdict'
      )
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (tier) q = q.eq('tier', tier);
    const { data, error } = await q;
    if (error) {
      this.degrade('recentRuns', error);
      return [];
    }
    return data ?? [];
  }

  /**
   * Find the run to compare against.
   *
   * Matches on (tier, suite_hash) so a trend never compares a 40-case suite to a
   * 47-case one. Falls back to the newest completed run of the tier when no hash
   * match exists, and says so, because "first run after adding cases" should still
   * produce a readable comparison rather than nothing.
   */
  async baselineFor(
    tier: EvalRunSummary['tier'],
    suiteHash: string,
    excludeRunId?: string | null
  ): Promise<BaselineSnapshot | null> {
    if (!this.sb || !this.available) return null;

    const pick = async (requireHash: boolean) => {
      let q = this.sb!
        .from('agent_eval_runs')
        .select('run_id, started_at')
        .eq('status', 'completed')
        .eq('tier', tier)
        .order('started_at', { ascending: false })
        .limit(5);
      if (requireHash) q = q.eq('suite_hash', suiteHash);
      const { data, error } = await q;
      if (error) {
        this.degrade('baselineFor', error);
        return null;
      }
      const row = (data ?? []).find((r: any) => r.run_id !== excludeRunId);
      return row ?? null;
    };

    const row = (await pick(true)) ?? (await pick(false));
    if (!row) return null;

    const { data: rows, error } = await this.sb
      .from('agent_eval_results')
      .select('case_id, passed')
      .eq('run_id', row.run_id);
    if (error) {
      this.degrade('baselineFor/results', error);
      return null;
    }

    const outcomes = new Map<string, boolean>();
    for (const r of rows ?? []) outcomes.set((r as any).case_id, Boolean((r as any).passed));

    return { runId: row.run_id, startedAt: row.started_at, outcomes };
  }

  /**
   * Load a specific run's outcomes by id, for `--baseline=<run_id>`.
   *
   * Past runs are named explicitly when someone is comparing a change against the
   * last known-good scorecard rather than against whatever happened most recently.
   */
  async loadBaselineById(runId: string): Promise<BaselineSnapshot | null> {
    if (!this.sb || !this.available) return null;

    const { data: run, error: runErr } = await this.sb
      .from('agent_eval_runs')
      .select('run_id, started_at, status')
      .eq('run_id', runId)
      .maybeSingle();
    if (runErr) {
      this.degrade('loadBaselineById/run', runErr);
      return null;
    }
    if (!run) {
      console.warn(`[evals] --baseline ${runId} does not exist`);
      return null;
    }

    const { data: rows, error } = await this.sb
      .from('agent_eval_results')
      .select('case_id, passed')
      .eq('run_id', runId);
    if (error) {
      this.degrade('loadBaselineById/results', error);
      return null;
    }

    const outcomes = new Map<string, boolean>();
    for (const r of rows ?? []) outcomes.set((r as any).case_id, Boolean((r as any).passed));
    return { runId: (run as any).run_id, startedAt: (run as any).started_at, outcomes };
  }

  /** Every recorded result for one case, newest first — the per-case trend. */
  async caseHistory(caseId: string, limit = 30) {
    if (!this.sb || !this.available) return [];
    const { data, error } = await this.sb
      .from('agent_eval_results')
      .select('run_id, passed, score, transition, created_at, cost_inr, latency_ms, served_model')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      this.degrade('caseHistory', error);
      return [];
    }
    return data ?? [];
  }

  /**
   * Every guardrail breach ever recorded.
   *
   * This is the query that gets shown to a customer or a buyer, so it exists as a
   * first-class method with a dedicated partial index behind it rather than being
   * something someone has to hand-write under pressure.
   */
  async guardrailBreaches(days = 90) {
    if (!this.sb || !this.available) return [];
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await this.sb
      .from('agent_eval_results')
      .select('run_id, case_id, case_title, series, severity, failure_reasons, created_at, served_model')
      .eq('guardrail_breach', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) {
      this.degrade('guardrailBreaches', error);
      return [];
    }
    return data ?? [];
  }
}

/** numeric(6,4) in Postgres — round before insert so the DB never silently truncates. */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export { isMissingTable };
