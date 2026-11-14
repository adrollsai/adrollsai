/**
 * Durable pipeline runner for E2B sandboxes.
 *
 * The problem it solves: on the Hobby plan a sandbox is killed after 1 hour of
 * CONTINUOUS runtime, and a kill mid-step loses the workspace and the money spent
 * in that step. This runner makes that a non-event:
 *
 *   - the agent's plan lives in your store, not in the sandbox
 *   - the sandbox is paused the moment it is not computing (idle), which resets
 *     the continuous-runtime clock
 *   - a watchdog pauses + resumes BEFORE the cap, so we are never killed mid-step
 *   - every completed step is checkpointed, so a fresh sandbox can resume
 *   - steps are idempotent: an artefact already present means "skip, do not charge"
 *   - credits are held once, charged per completed step, refunded on hard failure
 *
 * Everything external (sandbox SDK, store, credits, clock) is injected, so this
 * file is testable without E2B, Supabase or a network.
 */

export interface SandboxLike {
  readonly id: string;
  pause(): Promise<void>;
  kill(): Promise<void>;
}

export interface RunnerDeps {
  sandboxes: {
    connect(id: string): Promise<SandboxLike>;
    create(): Promise<SandboxLike>;
  };
  store: {
    load(runId: string): Promise<Checkpoint | null>;
    save(runId: string, checkpoint: Checkpoint): Promise<void>;
  };
  credits: {
    /** reserve the whole run up front so the user can never be overdrawn mid-way */
    hold(runId: string, amount: number): Promise<void>;
    /** called once per completed step; must be idempotent on (runId, step) */
    charge(runId: string, step: string, amount: number): Promise<void>;
    /** release an unspent reserve; amount = what this run held minus what it charged */
    refund(runId: string, amount: number, reason: string): Promise<void>;
  };
  /** true when the artefact for a step already exists (R2 / disk) */
  artefactExists?(step: Step): Promise<boolean>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(event: string, data?: Record<string, unknown>): void;
}

export interface Step {
  name: string;
  credits: number;
  /** idempotency key of the produced artefact, e.g. 'assets/footage/hook-a.mp4' */
  artefact?: string;
  run(sandbox: SandboxLike, ctx: StepContext): Promise<void>;
}

export interface StepContext {
  runId: string;
  signal: { aborted: boolean };
  log(event: string, data?: Record<string, unknown>): void;
}

export interface Checkpoint {
  runId: string;
  sandboxId: string;
  completed: string[];
  /** continuous runtime already burnt in the current sandbox window */
  continuousMs: number;
  held: number;
  charged: number;
}

export interface RunOptions {
  runId: string;
  steps: Step[];
  /** pause the sandbox after this much wall clock with no step running (default 20 s) */
  idlePauseMs?: number;
  /** pause + resume at this continuous runtime (default 50 min, under the 60 min cap) */
  softCapMs?: number;
  maxAttemptsPerStep?: number;
}

export interface RunResult {
  runId: string;
  sandboxId: string;
  completed: string[];
  skipped: string[];
  charged: number;
  pauses: number;
  resumedFrom: number;
}

const MIN = 60_000;

export async function runPipeline(deps: RunnerDeps, opts: RunOptions): Promise<RunResult> {
  const idlePauseMs = opts.idlePauseMs ?? 20_000;
  const softCapMs = opts.softCapMs ?? 50 * MIN;
  const maxAttempts = opts.maxAttemptsPerStep ?? 2;

  const previous = await deps.store.load(opts.runId);
  let chargedThisRun = 0;
  const completed: string[] = previous ? [...previous.completed] : [];
  const skipped: string[] = [];
  let charged = previous ? previous.charged : 0;
  let continuousMs = previous ? previous.continuousMs : 0;
  let pauses = 0;
  let sandbox: SandboxLike;

  const resumedFrom = completed.length;
  // hold only what this run can still perform, so a retry after a refund
  // reserves exactly the remaining work instead of leaning on a stale hold
  const alreadyDone = new Set(completed);
  const heldThisRun = opts.steps
    .filter((s) => !alreadyDone.has(s.name))
    .reduce((sum, s) => sum + s.credits, 0);
  if (heldThisRun > 0) await deps.credits.hold(opts.runId, heldThisRun);

  // ---- sandbox: resume if we have a paused one, otherwise create
  let created = false;
  if (previous?.sandboxId) {
    try {
      sandbox = await deps.sandboxes.connect(previous.sandboxId);
      deps.log('sandbox.resumed', { sandboxId: sandbox.id, completed: completed.length });
    } catch {
      sandbox = await deps.sandboxes.create();
      created = true;
      continuousMs = 0;
      deps.log('sandbox.recreated', { sandboxId: sandbox.id });
    }
  } else {
    sandbox = await deps.sandboxes.create();
    created = true;
    deps.log('sandbox.created', { sandboxId: sandbox.id });
  }
  if (created && previous) {
    // the workspace is gone; only artefact-backed steps can be skipped safely
    deps.log('sandbox.fresh_workspace', { note: 'resuming by artefact only' });
  }

  const save = async () =>
    deps.store.save(opts.runId, {
      runId: opts.runId,
      sandboxId: sandbox.id,
      completed,
      continuousMs,
      held: heldThisRun,
      charged,
    });

  const pauseAndResume = async (reason: string) => {
    await save();
    await sandbox.pause();
    pauses += 1;
    deps.log('sandbox.paused', { reason, sandboxId: sandbox.id });
    if (reason === 'soft-cap') {
      // pausing resets the continuous-runtime clock; a new window of the same
      // sandbox is the cheapest possible fix (no re-provision, no re-download)
      sandbox = await deps.sandboxes.connect(sandbox.id);
      continuousMs = 0;
      deps.log('sandbox.rearmed', { sandboxId: sandbox.id });
    }
  };

  try {
    for (const step of opts.steps) {
      // ---- idempotency: already done in a previous run
      if (completed.includes(step.name)) {
        skipped.push(step.name);
        continue;
      }
      // ---- idempotency: artefact already produced (cheap, survives a lost workspace)
      if (step.artefact && deps.artefactExists && (await deps.artefactExists(step))) {
        completed.push(step.name);
        skipped.push(step.name);
        deps.log('step.skipped_existing_artefact', { step: step.name, artefact: step.artefact });
        await save();
        continue;
      }

      // ---- watchdog: never let continuous runtime reach the platform cap
      if (continuousMs >= softCapMs) {
        await pauseAndResume('soft-cap');
      }

      let attempt = 0;
      for (;;) {
        attempt += 1;
        const startedAt = deps.now();
        try {
          const ctx: StepContext = {
            runId: opts.runId,
            signal: { aborted: false },
            log: (event, data) => deps.log(event, { step: step.name, ...data }),
          };
          await step.run(sandbox, ctx);

          const spent = deps.now() - startedAt;
          continuousMs += spent;
          completed.push(step.name);
          await deps.credits.charge(opts.runId, step.name, step.credits);
          charged += step.credits;
          chargedThisRun += step.credits;
          deps.log('step.done', { step: step.name, ms: spent, credits: step.credits });
          await save();

          // idle-pause: nothing queued that needs a live sandbox right now
          if (idlePauseMs > 0 && spent < idlePauseMs) {
            await pauseAndResume('idle');
          }
          break;
        } catch (error) {
          continuousMs += deps.now() - startedAt;
          deps.log('step.failed', { step: step.name, attempt, error: String(error) });
          if (attempt >= maxAttempts) throw error;
          // a failed step may have wedged the sandbox; a fresh resume is cheap
          await pauseAndResume('retry');
        }
      }
    }
    await save();
    return {
      runId: opts.runId,
      sandboxId: sandbox.id,
      completed,
      skipped,
      charged,
      pauses,
      resumedFrom,
    };
  } catch (error) {
    // pause, do not kill: the workspace is probably still good, and pause is free
    try {
      await save();
      await sandbox.pause();
    } catch {
      /* best effort */
    }
    const release = Math.max(0, heldThisRun - chargedThisRun);
    if (release > 0) {
      await deps.credits.refund(opts.runId, release, `pipeline_failed:${String(error).slice(0, 120)}`);
    }
    deps.log('run.failed', { runId: opts.runId, refunded: release, error: String(error) });
    throw error;
  }
}
