/* eslint-disable @typescript-eslint/no-explicit-any --
 * The service-role Supabase client is intentionally loose here, for the same
 * reason lib/automation/billing.ts documents: database.types.ts is stale.
 */
/**
 * THE REAL ENTRY POINT.
 *
 * This is where the four adapters meet the runner: an E2B sandbox provider, a
 * Supabase checkpoint store, a credit ledger and an R2 artefact probe, wired into
 * one durable three-step video job:
 *
 *     voiceover  ->  clips  ->  render
 *
 * Nothing here executes at import time. `videoPipelineSteps()` is pure data, so
 * the shape of the job is unit-testable and reviewable without a sandbox, and
 * `runVideoPipeline()` is the only function that touches the outside world.
 *
 * WHAT A STEP IS
 *   name        the checkpoint key — a step in `agent_runs.completed` never re-runs
 *   credits     what the step costs, charged only after it succeeds
 *   artefact    the R2 key it produces; if that key already exists the step is
 *               skipped and NOT charged (see artefact.ts)
 *   sandboxPath where the file must appear inside the sandbox, verified with
 *               `test -s` so a step cannot report success having produced nothing
 *   command     the shell command, as data
 *
 * The default commands are real ffmpeg invocations (the sandbox image has ffmpeg)
 * so a smoke run produces actual files. They are deliberately boring: the vendor
 * calls — kie TTS, kie clip generation, the HyperFrames render — plug in through
 * `VideoJobSpec.commands` (a shell command) or `VideoJobSpec.run` (a function with
 * the live sandbox in hand, e.g. lib/agent/sandbox.ts's executeInE2BSandbox).
 *
 * PRICING is not invented here: the voice step costs what
 * lib/agent/media-models.ts says the voice model costs, and the clip step costs
 * what the video model charges per second. Only the render — which is E2B compute,
 * not a vendor call — uses a local constant, and it is overridable.
 */

import { runPipeline } from './runner';
import type { RunnerDeps, RunResult, SandboxLike, Step, StepContext } from './runner';
import { createE2BSandboxes, detailOf, runStepCommand } from './e2b';
import { createSupabaseStore } from './store';
import type { AgentRunStatus, AgentRunStore } from './store';
import { createSupabaseCredits } from './credits';
import type { CreditsAdapter } from './credits';
import { createArtefactExists } from './artefact';
import { consoleLogger } from './log';
import type { AgentLogger } from './log';
import { MEDIA_MODELS, videoCredits } from '../media-models';

const MINUTE = 60_000;

/**
 * Sandbox compute for the render step: a local ffmpeg encode costs no vendor
 * credits, but it is the most expensive thing we do in wall-clock terms and E2B
 * bills per second. Kept next to the step so the number has one home.
 */
export const RENDER_CREDITS = 4;

export type VideoStepName = 'voiceover' | 'clips' | 'render';

/**
 * Default file names per step. Kept as data next to the keys they back, so a
 * caller overriding one without the other is an obvious mistake rather than a
 * silent mismatch between what a step writes and what the run claims it wrote.
 */
const ARTEFACT_NAMES: Record<VideoStepName, string> = {
  voiceover: 'voiceover.mp3',
  clips: 'clip.mp4',
  render: 'final.mp4',
};

const SANDBOX_NAMES: Record<VideoStepName, string> = {
  voiceover: 'voiceover.mp3',
  clips: 'clip.mp4',
  render: 'final.mp4',
};

export interface VideoJobSpec {
  /** Names the sandbox work dir and the R2 key prefix. Must be unique per job. */
  jobId: string;
  /** What the voiceover says. */
  script: string;
  /** Direction for the clip generator. */
  clipPrompt: string;
  clipSeconds: number;
  /** Sandbox-relative work dir. Defaults to `work/<jobId>`. */
  workDir?: string;
  /** Override the render price (defaults to RENDER_CREDITS). */
  renderCredits?: number;
  /**
   * Override a step's R2 artefact key.
   *
   * The default (`agent_render/<jobId>/<name>`) is right for the smoke job, but a
   * caller that produces something else — the `video` skill writes a measured
   * `voiceover.json`, a project manifest and a real `final.mp4` — has to name its
   * own keys, or the run row would claim an mp3 it never made.
   */
  artefacts?: Partial<Record<VideoStepName, string>>;
  /** Override a step's sandbox path (the file the step must leave behind). */
  sandboxPaths?: Partial<Record<VideoStepName, string>>;
  /** Replace a step's shell command. This is where real vendor calls go. */
  commands?: Partial<Record<VideoStepName, string>>;
  /** Replace a step's body entirely, with the live sandbox in hand. */
  run?: Partial<Record<VideoStepName, (sandbox: SandboxLike, ctx: StepContext) => Promise<void>>>;
}

export interface VideoStepSpec {
  name: VideoStepName;
  credits: number;
  /** R2 key that proves the step already happened. */
  artefact: string;
  /** Absolute path inside the sandbox the step must leave behind. */
  sandboxPath: string;
  /** The shell command that produces it. */
  command: string;
  /** Must exceed the longest legitimate run of this step. */
  timeoutMs: number;
}

/** A small, real default so a smoke run works with no arguments. */
export const DEFAULT_VIDEO_JOB: VideoJobSpec = {
  jobId: 'demo',
  script: 'Nobo turns a listing into a finished vertical video in one pass.',
  clipPrompt: 'slow push in on a sunlit apartment balcony, vertical, cinematic',
  clipSeconds: 6,
};

/**
 * Default step commands. `{{dir}}` is the sandbox work dir, `{{out}}` the target
 * file; the rest are job parameters. Replace via `VideoJobSpec.commands`.
 */
export const STEP_COMMANDS: Record<VideoStepName, string> = {
  voiceover: 'ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=mono -t 3 -c:a libmp3lame -q:a 6 {{out}}',
  clips:
    'ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:d={{seconds}}:r=30 -c:v libx264 -pix_fmt yuv420p {{out}}',
  render: 'ffmpeg -y -i {{vo}} -i {{clip}} -map 1:v:0 -map 0:a:0 -shortest -c:v copy -c:a aac {{out}}',
};

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** POSIX-quote a value that is about to be interpolated into a command. */
function q(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * The job, as data: three steps in the order the runner will execute them.
 *
 * Pure — no I/O, no environment, no side effects. Everything a reviewer needs to
 * know about cost and idempotency is in the returned objects.
 */
export function videoPipelineSteps(job: VideoJobSpec = DEFAULT_VIDEO_JOB): VideoStepSpec[] {
  const workDir = (job.workDir ?? `work/${job.jobId}`).replace(/^\/+|\/+$/g, '');
  const dir = `/home/user/${workDir}`;
  const keyBase = `agent_render/${job.jobId}`;

  const voiceover = STEP_COMMANDS.voiceover;
  const clips = STEP_COMMANDS.clips;
  const render = STEP_COMMANDS.render;

  const vars = {
    dir,
    seconds: job.clipSeconds,
    script: job.script,
    prompt: job.clipPrompt,
    vo: `${dir}/voiceover.mp3`,
    clip: `${dir}/clip.mp4`,
    out: '',
  };

  const mkdir = `mkdir -p ${q(dir)}`;
  const artefact = (name: VideoStepName): string =>
    job.artefacts?.[name] ?? `${keyBase}/${ARTEFACT_NAMES[name]}`;
  const sandboxPath = (name: VideoStepName): string =>
    job.sandboxPaths?.[name] ?? `${dir}/${SANDBOX_NAMES[name]}`;

  return [
    {
      name: 'voiceover',
      credits: MEDIA_MODELS.voice.credits,
      artefact: artefact('voiceover'),
      sandboxPath: sandboxPath('voiceover'),
      command: `${mkdir} && ${fill(job.commands?.voiceover ?? voiceover, { ...vars, out: q(vars.vo) })}`,
      timeoutMs: MEDIA_MODELS.voice.timeoutMs,
    },
    {
      name: 'clips',
      credits: videoCredits(job.clipSeconds),
      artefact: artefact('clips'),
      sandboxPath: sandboxPath('clips'),
      command: `${mkdir} && ${fill(job.commands?.clips ?? clips, { ...vars, out: q(vars.clip) })}`,
      timeoutMs: MEDIA_MODELS.video.timeoutMs,
    },
    {
      name: 'render',
      credits: job.renderCredits ?? RENDER_CREDITS,
      artefact: artefact('render'),
      sandboxPath: sandboxPath('render'),
      command: `${mkdir} && ${fill(job.commands?.render ?? render, { ...vars, out: q(`${dir}/final.mp4`) })}`,
      timeoutMs: 10 * MINUTE,
    },
  ];
}

/**
 * Turn step specs into runner steps.
 *
 * The body is the same for every step: run the command, then require the file to
 * exist. A step that produced nothing throws, so the runner retries it and, if it
 * keeps failing, refunds the unspent reserve instead of charging for a step that
 * never happened.
 */
export function toRunnerSteps(specs: VideoStepSpec[], job: VideoJobSpec = DEFAULT_VIDEO_JOB): Step[] {
  const overrides = job.run ?? {};

  return specs.map((spec) => ({
    name: spec.name,
    credits: spec.credits,
    artefact: spec.artefact,
    async run(sandbox: SandboxLike, ctx: StepContext): Promise<void> {
      const override = overrides[spec.name];

      if (override) {
        await override(sandbox, ctx);
        return;
      }

      await runStepCommand(
        sandbox,
        { command: spec.command, sandboxPath: spec.sandboxPath, timeoutMs: spec.timeoutMs },
        { log: ctx.log, name: spec.name },
      );

      ctx.log('step.artefact_ready', {
        artefact: spec.artefact,
        path: spec.sandboxPath,
        credits: spec.credits,
      });
    },
  }));
}

export interface RunVideoPipelineOptions {
  /** Stable id for the run: keys the checkpoint, the credit hold and the refs. */
  runId: string;
  /** Who gets billed. Mapped to the paying owner by the credits adapter. */
  userId: string;
  job?: VideoJobSpec;

  /** Injection seams. Production leaves these unset and gets the real adapters. */
  supabase?: any;
  sandboxes?: RunnerDeps['sandboxes'];
  store?: RunnerDeps['store'];
  credits?: RunnerDeps['credits'];
  artefactExists?: RunnerDeps['artefactExists'];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: AgentLogger;

  /** Runner tuning, passed straight through. */
  idlePauseMs?: number;
  softCapMs?: number;
  maxAttemptsPerStep?: number;
}

/**
 * Run the video pipeline for one job, durably.
 *
 * Resolves with the runner's result, or throws whatever stopped it (after the
 * runner has paused the sandbox, refunded the unspent reserve and recorded the
 * failure on the run row). Callers should treat a throw as "the run can be
 * retried with the same runId", not as "start a new one".
 */
export async function runVideoPipeline(options: RunVideoPipelineOptions): Promise<RunResult> {
  if (!options || !options.runId) {
    throw new Error('[agent-run] runVideoPipeline needs a runId');
  }
  if (!options.userId) {
    throw new Error('[agent-run] runVideoPipeline needs a userId - the run is billed to it');
  }

  const job = options.job ?? DEFAULT_VIDEO_JOB;
  const log = options.log ?? consoleLogger;
  const specs = videoPipelineSteps(job);
  const steps = toRunnerSteps(specs, job);

  const needsSupabase = !options.store || !options.credits;
  const supabase = options.supabase ?? (needsSupabase ? await serviceRoleClient() : null);

  if (needsSupabase && !supabase) {
    throw new Error(
      '[agent-run] no Supabase client: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, ' +
        'or pass options.supabase',
    );
  }

  const store = options.store ?? createSupabaseStore({ supabase, userId: options.userId, log });
  const credits =
    options.credits ?? createSupabaseCredits({ supabase, userId: options.userId, log });
  const sandboxes = options.sandboxes ?? createE2BSandboxes({ log });
  const artefactExists = options.artefactExists ?? createArtefactExists({ log });

  const deps: RunnerDeps = {
    sandboxes,
    store,
    credits,
    artefactExists,
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    log,
  };

  log('run.start', {
    runId: options.runId,
    jobId: job.jobId,
    steps: specs.map((step) => step.name),
    reserve: specs.reduce((sum, step) => sum + step.credits, 0),
  });

  try {
    const result = await runPipeline(deps, {
      runId: options.runId,
      steps,
      idlePauseMs: options.idlePauseMs,
      softCapMs: options.softCapMs,
      maxAttemptsPerStep: options.maxAttemptsPerStep,
    });

    // A step skipped because its artefact already existed was never charged, so
    // the reservation can be larger than what the run actually spent. Release the
    // difference instead of leaving it held until it expires.
    await settleCredits(credits, options.runId, log);
    await recordStatus(store, options.runId, 'completed', null, log);

    log('run.completed', {
      runId: options.runId,
      sandboxId: result.sandboxId,
      completed: result.completed,
      skipped: result.skipped,
      charged: result.charged,
      pauses: result.pauses,
      resumedFrom: result.resumedFrom,
    });

    return result;
  } catch (error) {
    // The runner has already paused the sandbox and refunded the reserve by now.
    await recordStatus(store, options.runId, 'failed', detailOf(error), log);
    log('run.failed', { runId: options.runId, error: detailOf(error) });
    throw error;
  }
}

/** Release whatever the finished run never spent. No-op without a reservation. */
async function settleCredits(
  credits: RunnerDeps['credits'],
  runId: string,
  log: AgentLogger,
): Promise<void> {
  const adapter = credits as Partial<CreditsAdapter>;
  if (typeof adapter.settle !== 'function') return;
  try {
    await adapter.settle(runId, 'run_complete');
  } catch (error) {
    // The work is done and paid for; a leftover hold expires on its own.
    log('run.settle_failed', { runId, error: detailOf(error) });
  }
}

/** Record a terminal status; never let bookkeeping turn a success into a failure. */
async function recordStatus(
  store: RunnerDeps['store'],
  runId: string,
  status: AgentRunStatus,
  lastError: string | null,
  log: AgentLogger,
): Promise<void> {
  const adapter = store as Partial<AgentRunStore>;
  if (typeof adapter.setStatus !== 'function') return;
  try {
    await adapter.setStatus(runId, status, lastError);
  } catch (error) {
    log('run.status_failed', { runId, status, error: detailOf(error) });
  }
}

/**
 * Service-role client, created lazily so importing this module needs no env.
 * Imported dynamically for the same reason.
 */
async function serviceRoleClient(): Promise<any | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}
