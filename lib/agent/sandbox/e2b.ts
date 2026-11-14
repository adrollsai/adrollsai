/**
 * E2B adapter for the durable sandbox runner.
 *
 * WHAT THIS FILE GUARANTEES
 *   1. It NEVER kills a sandbox. A paused sandbox keeps both its filesystem and
 *      its memory, resumes in ~1 s through `Sandbox.connect()`, and — the reason
 *      this matters on the Hobby plan — pausing RESETS E2B's 1 hour CONTINUOUS
 *      runtime clock. Killing throws all three of those away and buys nothing.
 *      `kill()` is exposed only because the runner's `SandboxLike` requires it;
 *      it degrades to a pause and says so in the log.
 *   2. Every call is wrapped. A failure surfaces as a `SandboxAdapterError` with
 *      the operation, the sandbox id and the underlying cause in its message -
 *      never as a raw SDK error leaking out of the runner. `pause()` is the one
 *      exception: it swallows (and logs), because a failed pause must not abort a
 *      run whose workspace is still perfectly good.
 *   3. The SDK is loaded lazily, so importing this module costs nothing and does
 *      not require E2B credentials. Tests inject a fake `sandboxClass`.
 *
 * API checked against the installed SDK — @e2b/code-interpreter 2.9.1, which
 * re-exports `e2b` 2.63.0:
 *   Sandbox.create(opts?)            -> Promise<Sandbox>
 *   Sandbox.connect(sandboxId, opts) -> Promise<Sandbox>   (resumes if paused)
 *   sandbox.sandboxId: string
 *   sandbox.pause(opts?)             -> Promise<boolean>
 *   sandbox.commands.run(cmd, opts)  -> Promise<{ exitCode, stdout, stderr }>
 *   sandbox.files.write(path, data)  -> Promise<...>
 */

import type { SandboxLike, StepContext } from './runner';
import type { AgentLogger } from './log';
import { silentLogger } from './log';

const MINUTE = 60_000;

/**
 * Sandbox lifetime, refreshed by every connect. It must comfortably exceed the
 * longest single step; the runner's 50 minute soft cap is reached across many
 * steps, each of which reconnects and extends this TTL. On expiry the platform
 * pauses rather than kills (see `lifecycle` below), so the workspace survives
 * even the case we did not anticipate.
 */
const DEFAULT_SANDBOX_TIMEOUT_MS = 30 * MINUTE;

/** A single command may not outlive this unless the caller says otherwise. */
const DEFAULT_EXEC_TIMEOUT_MS = 10 * MINUTE;

export interface E2BExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface E2BExecOptions {
  timeoutMs?: number;
  /** Return a non-zero exit instead of throwing. Default false: a failed command
   *  is a failed step, and the runner's retry/refund logic depends on that. */
  allowNonZero?: boolean;
}

/** The slice of a live E2B sandbox this adapter touches. */
export interface E2BSandboxLike {
  readonly sandboxId: string;
  pause(opts?: Record<string, unknown>): Promise<unknown>;
  kill(opts?: Record<string, unknown>): Promise<unknown>;
  commands: {
    run(
      command: string,
      opts?: { timeoutMs?: number; [key: string]: unknown },
    ): Promise<{ exitCode?: number | null; stdout?: string | null; stderr?: string | null }>;
  };
  files?: {
    write(path: string, content: string): Promise<unknown>;
  };
}

/** The slice of the SDK class this adapter touches. Injectable for tests. */
export interface E2BSandboxClassLike {
  create(opts?: Record<string, unknown>): Promise<E2BSandboxLike>;
  connect(sandboxId: string, opts?: Record<string, unknown>): Promise<E2BSandboxLike>;
}

export type SandboxOperation = 'create' | 'connect' | 'pause' | 'kill' | 'exec' | 'write' | 'load_sdk';

/** A readable, non-throwing-to-the-SDK failure. */
export class SandboxAdapterError extends Error {
  readonly op: SandboxOperation;
  readonly sandboxId: string | null;

  constructor(op: SandboxOperation, message: string, sandboxId?: string | null) {
    super(message);
    this.name = 'SandboxAdapterError';
    this.op = op;
    this.sandboxId = sandboxId ?? null;
    // Class extends Error under an ES2017 target needs this to keep instanceof.
    Object.setPrototypeOf(this, SandboxAdapterError.prototype);
  }
}

/** One line, always. An SDK error can carry huge payloads and nested causes. */
export function detailOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const base = error.message || error.name || 'error';
    if (cause === undefined || cause === null) return base;
    const inner = cause instanceof Error ? cause.message : String(cause);
    return inner && inner !== base ? `${base} (cause: ${inner})` : base;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Last few lines of stderr, so an exec failure is diagnosable from the log. */
function tail(text: string, maxChars = 400): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `…${trimmed.slice(-maxChars)}`;
}

/**
 * What a step actually gets from the runner.
 *
 * It satisfies `SandboxLike` (id / pause / kill, which is all the runner needs to
 * manage the sandbox's lifecycle) and adds the two things a step needs to do
 * work. `kill()` still exists for the interface, but it pauses.
 */
export interface AgentSandbox extends SandboxLike {
  readonly id: string;
  readonly sandboxId: string;
  exec(command: string, opts?: E2BExecOptions): Promise<E2BExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  pause(): Promise<void>;
  kill(): Promise<void>;
}

/** Narrow a `SandboxLike` from the runner back to something that can execute. */
export function isExecutableSandbox(sandbox: SandboxLike): sandbox is AgentSandbox {
  return typeof (sandbox as Partial<AgentSandbox>).exec === 'function';
}

export interface E2BAdapterOptions {
  /** Injected SDK (tests). Defaults to the real `@e2b/code-interpreter`. */
  sandboxClass?: E2BSandboxClassLike;
  /** Defaults to `process.env.E2B_API_KEY`, stripped of stray quotes. */
  apiKey?: string;
  /** Pre-built image alias; when set the stock image is not provisioned at all. */
  template?: string;
  timeoutMs?: number;
  execTimeoutMs?: number;
  log?: AgentLogger;
}

export interface E2BSandboxes {
  create(): Promise<AgentSandbox>;
  connect(sandboxId: string): Promise<AgentSandbox>;
}

function envApiKey(): string {
  return (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

function envTemplate(): string | undefined {
  const tpl = (process.env.E2B_TEMPLATE || '').replace(/^["']|["']$/g, '').trim();
  return tpl || undefined;
}

/**
 * Build the `sandboxes` dependency the runner expects.
 *
 * `create()` is only called for a run with no checkpoint, and `connect()` only
 * for a run that has one. Everything else — pausing, resuming, deciding when a
 * lost sandbox should be recreated — belongs to the runner.
 */
export function createE2BSandboxes(options: E2BAdapterOptions = {}): E2BSandboxes {
  const log = options.log ?? silentLogger;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;
  const execTimeoutMs = options.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

  let resolved: E2BSandboxClassLike | null = options.sandboxClass ?? null;

  /** Lazy so this module is importable (and testable) with no SDK and no key. */
  const sdk = async (): Promise<E2BSandboxClassLike> => {
    if (resolved) return resolved;
    try {
      const mod = (await import('@e2b/code-interpreter')) as unknown as {
        Sandbox?: E2BSandboxClassLike;
        default?: E2BSandboxClassLike;
      };
      const SandboxClass = mod.Sandbox ?? mod.default ?? null;
      if (!SandboxClass) {
        throw new Error('module has no Sandbox export');
      }
      resolved = SandboxClass;
      return SandboxClass;
    } catch (error) {
      throw new SandboxAdapterError(
        'load_sdk',
        `e2b: could not load @e2b/code-interpreter (${detailOf(error)}). Is it installed?`,
      );
    }
  };

  const connectionOpts = (): Record<string, unknown> => {
    const apiKey = options.apiKey ?? envApiKey();
    return {
      timeoutMs,
      ...(apiKey ? { apiKey } : {}),
    };
  };

  const createOpts = (): Record<string, unknown> => {
    const template = options.template ?? envTemplate();
    return {
      ...connectionOpts(),
      // The backstop for the case our own watchdog never runs (the Node process
      // froze or restarted): pause, never kill, and allow traffic to resume it.
      lifecycle: { onTimeout: { action: 'pause' }, autoResume: true },
      ...(template ? { template } : {}),
    };
  };

  const wrap = (sandbox: E2BSandboxLike): AgentSandbox => {
    const sandboxId = String(sandbox.sandboxId || '');

    const safePause = async (why: string): Promise<void> => {
      try {
        await sandbox.pause();
        log('sandbox.adapter.pause', { sandboxId, why });
      } catch (error) {
        // Swallowed on purpose: the run is still valid and the workspace is
        // intact. The runner recounts pauses itself, so this is log-level only.
        log('sandbox.adapter.pause_failed', { sandboxId, why, error: detailOf(error) });
      }
    };

    return {
      get id() {
        return sandboxId;
      },
      get sandboxId() {
        return sandboxId;
      },

      async exec(command: string, execOpts: E2BExecOptions = {}): Promise<E2BExecResult> {
        const wanted = execOpts.timeoutMs ?? execTimeoutMs;
        let result: Awaited<ReturnType<E2BSandboxLike['commands']['run']>>;
        try {
          result = await sandbox.commands.run(command, { timeoutMs: wanted });
        } catch (error) {
          throw new SandboxAdapterError(
            'exec',
            `e2b: command failed on sandbox ${sandboxId}: ${detailOf(error)}`,
            sandboxId,
          );
        }

        const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : -1;
        const stdout = String(result?.stdout ?? '');
        const stderr = String(result?.stderr ?? '');

        if (exitCode !== 0 && !execOpts.allowNonZero) {
          const detail = tail(stderr) || tail(stdout) || 'no output';
          throw new SandboxAdapterError(
            'exec',
            `e2b: command exited ${exitCode} on sandbox ${sandboxId}: ${detail}`,
            sandboxId,
          );
        }

        return { exitCode, stdout, stderr };
      },

      async writeFile(path: string, content: string): Promise<void> {
        const files = sandbox.files;
        if (!files || typeof files.write !== 'function') {
          throw new SandboxAdapterError(
            'write',
            `e2b: sandbox ${sandboxId} exposes no files.write()`,
            sandboxId,
          );
        }
        try {
          await files.write(path, content);
        } catch (error) {
          throw new SandboxAdapterError(
            'write',
            `e2b: could not write ${path} to sandbox ${sandboxId}: ${detailOf(error)}`,
            sandboxId,
          );
        }
      },

      async pause(): Promise<void> {
        await safePause('requested');
      },

      /**
       * Never kills. The runner's contract says "pause, do not kill", and this is
       * the adapter holding that line even if a future caller asks for a kill: a
       * paused sandbox still has the workspace and the checkpoint stays resumable.
       * Reclaiming a sandbox for good is an operator action, not a runtime one.
       */
      async kill(): Promise<void> {
        log('sandbox.adapter.kill_refused', {
          sandboxId,
          note: 'paused instead - a kill destroys the workspace and its memory',
        });
        await safePause('kill_refused');
      },
    };
  };

  return {
    async create(): Promise<AgentSandbox> {
      const SandboxClass = await sdk();
      try {
        const sandbox = await SandboxClass.create(createOpts());
        log('sandbox.adapter.created', { sandboxId: String(sandbox.sandboxId || '') });
        return wrap(sandbox);
      } catch (error) {
        throw new SandboxAdapterError(
          'create',
          `e2b: could not create a sandbox: ${detailOf(error)}`,
        );
      }
    },

    async connect(sandboxId: string): Promise<AgentSandbox> {
      if (!sandboxId || typeof sandboxId !== 'string') {
        throw new SandboxAdapterError(
          'connect',
          `e2b: connect needs a sandbox id, got ${JSON.stringify(sandboxId)}`,
        );
      }
      const SandboxClass = await sdk();
      try {
        const sandbox = await SandboxClass.connect(sandboxId, connectionOpts());
        log('sandbox.adapter.connected', { sandboxId });
        return wrap(sandbox);
      } catch (error) {
        // The runner treats this as "the workspace is gone" and creates a fresh
        // sandbox, so the message has to make that decision obvious in the log.
        throw new SandboxAdapterError(
          'connect',
          `e2b: could not connect to sandbox ${sandboxId} (paused, expired or never existed): ${detailOf(error)}`,
          sandboxId,
        );
      }
    },
  };
}

/**
 * Run a `Step` body as a shell command and require a file to exist afterwards.
 *
 * This is what the pipeline's step `run()` callbacks use: the command is data
 * (see pipeline.ts), the verification is not, so a step can never report success
 * while producing nothing — which is exactly how the previous render path failed
 * silently.
 */
export async function runStepCommand(
  sandbox: SandboxLike,
  spec: { command: string; sandboxPath?: string; timeoutMs?: number },
  ctx?: Pick<StepContext, 'log'> & { name?: string },
): Promise<E2BExecResult> {
  if (!isExecutableSandbox(sandbox)) {
    throw new SandboxAdapterError(
      'exec',
      `step${ctx?.name ? ` ${ctx.name}` : ''} cannot run: sandbox ${sandbox.id} is not executable (no exec())`,
      sandbox.id,
    );
  }

  const result = await sandbox.exec(spec.command, { timeoutMs: spec.timeoutMs });

  if (spec.sandboxPath) {
    // `test -s` fails on a missing OR empty file, which is the real question.
    const check = await sandbox.exec(`test -s ${shellQuote(spec.sandboxPath)}`, {
      allowNonZero: true,
    });
    if (check.exitCode !== 0) {
      throw new SandboxAdapterError(
        'exec',
        `step${ctx?.name ? ` ${ctx.name}` : ''} produced no artefact at ${spec.sandboxPath}`,
        sandbox.id,
      );
    }
  }

  return result;
}

/** Minimal POSIX single-quote escaping for a path that goes into a command. */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
