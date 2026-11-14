/**
 * `artefactExists` for the durable sandbox runner: does the artefact this step
 * produces already live in R2?
 *
 * Why it matters more than it looks: the runner's checkpoint (`agent_runs`) is
 * lost whenever a run is started with a fresh id, and a recreated sandbox has an
 * empty filesystem. A HEAD on the artefact is the cheap, durable answer to "did
 * this step already happen?", and a `true` answer means the step is SKIPPED and
 * NOT CHARGED. So the probe must be honest in one direction:
 *
 *   404 / NoSuchKey  -> false   the artefact is definitely not there: run the step.
 *   any other error  -> false   plus a loud log line. We cannot prove it exists,
 *                               and assuming it does would silently produce
 *                               nothing while telling the user the run finished.
 *                               Re-running a step is recoverable; a run that
 *                               "succeeded" with no output is not.
 *
 * The existing R2 client from utils/r2.ts is reused as-is (lazy proxy, reads
 * credentials at call time). No new SDK client, no new dependency.
 */

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { R2_BUCKET, R2_PUBLIC_URL, r2 } from '@/utils/r2';
import type { RunnerDeps, Step } from './runner';
import type { AgentLogger } from './log';
import { silentLogger } from './log';

/** Injected probe (tests). Returns true only when the object really exists. */
export type HeadFn = (key: string) => Promise<boolean>;

export interface ArtefactProbeOptions {
  head?: HeadFn;
  /** Key prefix for artefacts stored per tenant, e.g. 'agent_render/<user>/'. */
  prefix?: string;
  bucket?: string;
  log?: AgentLogger;
}

/** What the runner asks for: see `RunnerDeps['artefactExists']`. */
export type ArtefactProbe = NonNullable<RunnerDeps['artefactExists']>;

function errorCode(error: any): string {
  return String(error?.Code || error?.code || error?.name || '');
}

/**
 * True only for the errors that definitely mean "this object is not in the
 * bucket". A 403 is deliberately NOT in here: bad credentials also produce 403,
 * and that has to be logged rather than silently answering "nothing exists".
 */
export function isMissingObjectError(error: any): boolean {
  if (!error) return false;
  const status = Number(error?.$metadata?.httpStatusCode ?? error?.status ?? error?.statusCode ?? 0);
  if (status === 404) return true;
  const code = errorCode(error);
  if (code === 'NotFound' || code === 'NoSuchKey' || code === '404') return true;
  const message = String(error?.message || '');
  return /not found|nosuchkey|does not exist/i.test(message);
}

/**
 * Turn a step's artefact into an R2 key.
 *
 * Accepts either a key ('renders/x/final.mp4') or the public URL the app hands to
 * the browser ('https://pub-….r2.dev/renders/x/final.mp4'). A URL that is not on
 * our public host is returned unchanged so the HEAD fails honestly rather than
 * probing a mangled key.
 */
export function artefactKey(artefact: string, prefix = ''): string {
  const raw = String(artefact || '').trim();
  if (!raw) return '';

  let key = raw;
  const publicBase = (R2_PUBLIC_URL || '').replace(/\/+$/, '');
  if (publicBase && key.startsWith(publicBase)) {
    key = key.slice(publicBase.length);
  }
  key = key.replace(/^\/+/, '');

  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  if (cleanPrefix && key && !key.startsWith(`${cleanPrefix}/`)) {
    return `${cleanPrefix}/${key}`;
  }
  return key;
}

/** Default probe: one HEAD against the bucket the rest of the app already uses. */
export async function r2ObjectExists(
  key: string,
  options: { bucket?: string; log?: AgentLogger } = {},
): Promise<boolean> {
  const log = options.log ?? silentLogger;
  if (!key) return false;

  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: options.bucket ?? R2_BUCKET,
        Key: key,
      }),
    );
    return true;
  } catch (error: any) {
    if (isMissingObjectError(error)) return false;
    // Credentials, network or bucket problems: say so and treat it as missing.
    log('artefact.head_failed', {
      key,
      error: String(error?.message || error),
      treated_as: 'missing',
      note: 'the step will run again; the checkpoint is what prevents a double charge',
    });
    return false;
  }
}

export function createArtefactExists(options: ArtefactProbeOptions = {}): ArtefactProbe {
  const log = options.log ?? silentLogger;
  const head: HeadFn =
    options.head ?? ((key) => r2ObjectExists(key, { bucket: options.bucket, log }));
  const prefix = options.prefix ?? '';

  return async (step: Step): Promise<boolean> => {
    if (!step.artefact) return false;

    const key = artefactKey(step.artefact, prefix);
    if (!key) return false;

    try {
      const exists = await head(key);
      if (exists) log('artefact.exists', { step: step.name, key });
      return Boolean(exists);
    } catch (error: any) {
      // A probe must never abort a run: the runner would refund and stop.
      log('artefact.head_threw', {
        step: step.name,
        key,
        error: String(error?.message || error),
        treated_as: 'missing',
      });
      return false;
    }
  };
}
