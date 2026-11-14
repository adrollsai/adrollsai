/**
 * The `image` skill: brief + facts + reference URLs -> ONE kie image call ->
 * one finished PNG in R2 -> the R2 key recorded on `agent_runs`.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *   - It is the ENTRY POINT of the skill and the only part that touches the
 *     outside world: `createKieImageTask` once, `queryKieTask` until the render
 *     lands, an R2 PUT, and one UPDATE on the run row.
 *   - It is NOT a compositor. Nothing here draws on the finished image. There is
 *     no sharp pass, no canvas, no SVG, no second generation — the prompt
 *     (`./prompt.ts`) asks for the complete designed poster in a single pass and
 *     what the provider returns IS the deliverable. That is the whole point of
 *     this skill: the previous shape (generate a bare picture, then overlay HTML
 *     or CSS design elements on it) produced a composited edge, type that did not
 *     belong to the picture, and text the model never saw.
 *
 * THE ORDER THAT KEEPS THE MONEY SAFE
 *
 *     planImageSkill(input)   pure: prompt + registry price + the R2 key  -> the user
 *     createImage(...)        one submission, then the bytes              -> the image
 *
 * ONE SUBMISSION, DELIBERATELY
 * `MEDIA_MODELS.imageEdit`'s fallback chain ends at a text-to-image model, so a
 * blind `withMediaFallback` walk could turn "edit THIS building" into "invent a
 * building" without anybody noticing. So the model is fixed by `imageModelFor`
 * and a transient failure (524, timeout, 429) is retried ON THE SAME MODEL once.
 * A different model is never silently substituted for a reference edit.
 */

import { createHash } from 'node:crypto';

import {
  assertKnownModel,
  estimateCredits,
  imageModelFor,
  isRetryableMediaError,
  MEDIA_MODELS,
} from '../../../media-models';
import {
  assertImageAspectRatio,
  buildImagePrompt,
  findUnverifiedClaims,
  type ImageAspectRatio,
  type ImageFacts,
} from './prompt';

/** The registry routes this skill is allowed to spend money on. Never inlined. */
export const IMAGE_MODEL = assertKnownModel(MEDIA_MODELS.image.id);
export const IMAGE_EDIT_MODEL = assertKnownModel(MEDIA_MODELS.imageEdit.id);

/** `image` = text-to-image, `imageEdit` = a supplied reference is the subject. */
export type ImageRoute = 'image' | 'imageEdit';

/** The ratio a caller gets when it does not ask for one (the feed poster). */
export const DEFAULT_ASPECT: ImageAspectRatio = '3:4';

/** How many times one plan may hit the provider: the first go, plus one retry. */
export const MAX_SUBMISSIONS = 2;

/** Poll cadence for the render: 24 attempts over roughly two minutes. */
export const POLL_TRIES = 24;
export const POLL_MS = 5_000;

// ────────────────────────────────────────────────────────────────────────────
// Input and plan (pure)
// ────────────────────────────────────────────────────────────────────────────

export interface ImageSkillInput {
  /** What the image is for, in the business's own words. */
  brief: string;
  /** Verified facts only. Anything absent from here must not appear in the image. */
  facts?: ImageFacts;
  /** Public https URLs of the real subject. Non-empty routes to the edit model. */
  referenceUrls?: readonly string[];
  /** One of the ratios the app offers. Defaults to 3:4. */
  aspectRatio?: string;
}

export interface CreditLine {
  /** Registry model id, or the route name for readability. */
  media: string;
  credits: number;
  detail: string;
}

export interface ImageSkillPlan {
  /** The complete prompt, exactly as the provider will receive it. */
  prompt: string;
  /** The scrubbed brief, as it appears inside the prompt. */
  brief: string;
  aspectRatio: ImageAspectRatio;
  /** `imageModelFor(referenceUrls)` — the registry decides, not this file. */
  model: string;
  route: ImageRoute;
  referenceUrls: string[];
  /** Credits to reserve BEFORE the call: `estimateCredits(route, 1)`. */
  credits: number;
  creditLines: CreditLine[];
  /** `<dir>/<ratio>-<hash>`, with no extension: the provider's format fixes it. */
  artefactKeyStem: string;
  /** The key this plan expects to publish to (`.png`; a JPEG result publishes `.jpg`). */
  artefactKey: string;
  facts: Record<string, string> | null;
  /** One line for the log and for the user who is about to pay. */
  briefing: string;
  notes: string[];
}

/** R2 prefix for this skill's output. */
const ARTEFACT_ROOT = 'image';

/** A brief turned into a stable, filesystem-safe slug (seeded: same brief, same slug). */
export function slugFor(brief: string): string {
  const base = String(brief ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'image';
}

/** `3:4` -> `3x4`, so the ratio can live inside an object key. */
export function ratioSlug(ratio: string): string {
  return assertImageAspectRatio(ratio).replace(':', 'x');
}

/**
 * The R2 key stem: deterministic in the prompt, the model and the ratio.
 *
 * Determinism is the point — a retry of the same plan overwrites the same object
 * instead of leaving a second copy with a timestamp in its name.
 */
export function artefactKeyStemFor(args: {
  slug: string;
  ratio: string;
  prompt: string;
  model: string;
}): string {
  const digest = createHash('sha1')
    .update(`${args.model}\n${args.ratio}\n${args.prompt}`)
    .digest('hex')
    .slice(0, 8);
  return `${ARTEFACT_ROOT}/${args.slug}/${ratioSlug(args.ratio)}-${digest}`;
}

/** Credits for one image on a route, straight from the registry. */
export function imageCredits(route: ImageRoute = 'image'): number {
  return estimateCredits(route, 1);
}

function normaliseReferences(urls: readonly unknown[] | undefined): string[] {
  return (urls ?? [])
    .map((url) => String(url ?? '').trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 6);
}

function factsRecord(facts: ImageFacts): Record<string, string> | null {
  if (!facts) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The plan the caller sees BEFORE anything is spent.
 *
 * Pure: no network, no Supabase, no clock, no random. It prices the work from the
 * registry, names the R2 key the finished image will land on, and reports the
 * claim scan's findings as notes rather than throwing — `buildImagePrompt` is
 * where the refusal lives.
 */
export function planImageSkill(input: ImageSkillInput): ImageSkillPlan {
  if (typeof input !== 'object' || input === null) {
    throw new Error('[image-skill] needs { brief }');
  }

  const aspectRatio = assertImageAspectRatio(input.aspectRatio ?? DEFAULT_ASPECT);
  const referenceUrls = normaliseReferences(input.referenceUrls);
  const route: ImageRoute = referenceUrls.length > 0 ? 'imageEdit' : 'image';
  const model = imageModelFor(referenceUrls);

  const prompt = buildImagePrompt({
    brief: input.brief,
    facts: input.facts,
    referenceUrls,
    aspectRatio,
  });

  const slug = slugFor(input.brief);
  const artefactKeyStem = artefactKeyStemFor({ slug, ratio: aspectRatio, prompt, model });
  const credits = imageCredits(route);
  const facts = factsRecord(input.facts);

  const notes: string[] = [];
  if (route === 'imageEdit') {
    notes.push(
      `${referenceUrls.length} reference image(s) supplied, so this is an EDIT of the real subject ` +
        `(${model}) — the reference is reproduced, not repainted, and never replaced with an invention`,
    );
  } else {
    notes.push(
      `no reference image supplied, so this renders from the brief alone (${model}); nothing the brief ` +
        'did not name will be depicted',
    );
  }
  if (!facts) {
    notes.push(
      'no verified facts supplied: the image may carry no price, date, discount, percentage or phone ' +
        'number at all',
    );
  }
  const claims = findUnverifiedClaims(String(input.brief ?? ''), input.facts);
  if (claims.length > 0) {
    notes.push(`REFUSED BY THE CLAIM SCAN: ${claims.join(', ')} — see the error from buildImagePrompt`);
  }
  if (aspectRatio === '3:4') {
    notes.push('3:4 is the poster ratio; 4:5 is not a provider enum, so a 4:5 placement uses 3:4 and crops');
  }

  return {
    prompt,
    brief: input.brief,
    aspectRatio,
    model,
    route,
    referenceUrls,
    credits,
    creditLines: [
      {
        media: model,
        credits,
        detail: `1 image at ${aspectRatio} via ${route}`,
      },
    ],
    artefactKeyStem,
    artefactKey: `${artefactKeyStem}.png`,
    facts,
    briefing:
      `One finished ${aspectRatio} image for: ${String(input.brief ?? '').slice(0, 80)}` +
      ` (${route === 'imageEdit' ? 'editing the supplied reference' : 'text-to-image'}, ${credits} credits)`,
    notes,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The outside world (injectable, so the verify suite never spends anything)
// ────────────────────────────────────────────────────────────────────────────

export interface ImageRequest {
  prompt: string;
  model: string;
  aspectRatio: string;
  referenceUrls: string[];
}

export interface SubmitResult {
  taskId: string | null;
  reason: string | null;
}

export interface PollResult {
  url: string | null;
  reason: string | null;
}

export interface PublishResult {
  url: string;
  bytes: number;
}

/** Where the finished image is recorded. */
export interface ImageArtefact {
  /** R2 object key, e.g. `image/diwali-offer/3x4-1a2b3c4d.png`. */
  key: string;
  url: string;
  bytes: number;
  aspectRatio: ImageAspectRatio;
  model: string;
  route: ImageRoute;
  prompt: string;
}

export interface RecordResult {
  recorded: boolean;
  reason: string | null;
}

export interface ImageSkillDeps {
  /** Submit the ONE generation. Default: `createKieImageTask` via `@/utils/external-apis`. */
  submit?: (request: ImageRequest) => Promise<SubmitResult>;
  /** Wait for the task to finish and return the provider's URL. */
  poll?: (taskId: string) => Promise<PollResult>;
  /** Fetch the finished bytes. */
  download?: (url: string) => Promise<Uint8Array>;
  /** PUT the bytes at `key` and return a public URL. Default: R2. */
  publish?: (args: { key: string; bytes: Uint8Array; contentType: string }) => Promise<PublishResult>;
  /** Record the key on the run row. Default: UPDATE agent_runs. */
  record?: (runId: string, artefact: ImageArtefact) => Promise<RecordResult>;
  /** Affordability pre-flight. Default: `canAfford(userId, credits)`. */
  affordable?: (userId: string, credits: number) => Promise<{ ok: boolean; reason?: string }>;
  /** Override the poll cadence (tests). */
  pollTries?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ImageSkillRunOptions {
  /** Keys the credit hold and the run row. Stable across retries. */
  runId: string;
  /** Who pays. */
  userId: string;
  input: ImageSkillInput;
  deps?: ImageSkillDeps;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface ImageSkillResult {
  plan: ImageSkillPlan;
  runId: string;
  taskId: string;
  artefact: ImageArtefact;
  recorded: RecordResult;
  /** Provider submissions actually made (1, or 2 after one transient retry). */
  submissions: number;
  /** Polls spent waiting for the render. */
  polls: number;
}

function messageOf(error: unknown): string {
  const value = error as { message?: unknown } | null;
  return value && value.message !== undefined ? String(value.message) : String(error);
}

const defaultLog = (event: string, data?: Record<string, unknown>) => {
  console.log(`[image-skill] ${event}`, data ? JSON.stringify(data) : '');
};

async function defaultAffordable(
  userId: string,
  credits: number,
): Promise<{ ok: boolean; reason?: string }> {
  const usage = await import('@/lib/agent/usage');
  return usage.canAfford(userId, credits);
}

/** ONE generation. This is the only place a model is asked for pixels. */
async function defaultSubmit(request: ImageRequest): Promise<SubmitResult> {
  const api = await import('@/utils/external-apis');
  try {
    const taskId = await api.createKieImageTask(
      request.prompt,
      request.model,
      request.aspectRatio,
      request.referenceUrls.length > 0 ? [...request.referenceUrls] : undefined,
    );
    return { taskId, reason: null };
  } catch (error) {
    return { taskId: null, reason: messageOf(error) };
  }
}

async function defaultPoll(taskId: string): Promise<PollResult> {
  const api = await import('@/utils/external-apis');
  const status = await api.queryKieTask(taskId);
  if (status.state === 'success' && status.resultUrl) return { url: status.resultUrl, reason: null };
  if (status.state === 'fail') return { url: null, reason: status.error ?? 'the task failed' };
  return { url: null, reason: null };
}

async function defaultDownload(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`[image-skill] could not download the finished image: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** PNG or JPEG, from the bytes themselves — the provider's format decides. */
export function sniffImageExtension(bytes: Uint8Array): 'png' | 'jpg' {
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  return 'png';
}

const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
};

async function defaultPublish(args: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<PublishResult> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');
  const body = Buffer.from(args.bytes);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: args.key,
      Body: body,
      ContentType: args.contentType,
    }),
  );
  return { url: `${String(R2_PUBLIC_URL).replace(/\/+$/, '')}/${args.key}`, bytes: body.length };
}

/**
 * The one place the R2 key is written onto `agent_runs`. Never throws: an image
 * that was generated and published is finished, and losing the bookkeeping write
 * must not turn it into a failure the caller would retry (and pay for) again.
 */
export async function recordImageArtefact(
  supabase: unknown,
  runId: string,
  artefact: ImageArtefact,
): Promise<RecordResult> {
  const db = supabase as { from?: (table: string) => unknown } | null;
  if (!db || typeof db.from !== 'function') {
    return { recorded: false, reason: 'no Supabase client' };
  }

  const table = db.from('agent_runs') as {
    update: (
      values: Record<string, unknown>,
    ) => {
      eq: (
        column: string,
        value: string,
      ) => PromiseLike<{ error: { message?: string; code?: string } | null }>;
    };
  };

  try {
    const { error } = await table
      .update({
        artefact_key: artefact.key,
        artefact_url: artefact.url,
        artefact_meta: {
          skill: 'image',
          bytes: artefact.bytes,
          aspect_ratio: artefact.aspectRatio,
          model: artefact.model,
          route: artefact.route,
          prompt: artefact.prompt,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('run_id', runId);

    if (!error) return { recorded: true, reason: null };

    const text = `${error.code ?? ''} ${error.message ?? ''}`;
    if (/PGRST204|42703|does not exist|schema cache/i.test(text)) {
      return {
        recorded: false,
        reason:
          `agent_runs has no artefact_key column yet (${text.trim()}). Apply ` +
          'supabase/migrations/20261216000000_agent_run_artefact.sql; the image is published and ' +
          `its key is ${artefact.key}.`,
      };
    }
    return { recorded: false, reason: text.trim() || 'unknown Supabase error' };
  } catch (error) {
    return { recorded: false, reason: messageOf(error) };
  }
}

async function defaultRecord(runId: string, artefact: ImageArtefact): Promise<RecordResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { recorded: false, reason: 'no Supabase service-role credentials in this process' };
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  return recordImageArtefact(supabase, runId, artefact);
}

// ────────────────────────────────────────────────────────────────────────────
// The skill entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Produce one finished image: plan -> one submission -> R2 -> the key on the row.
 *
 * Throws whatever stopped it, with the reason. Nothing is written to the run row
 * unless an image actually landed in R2, so a failed run and a finished one can
 * never look the same in the database.
 */
export async function createImage(options: ImageSkillRunOptions): Promise<ImageSkillResult> {
  if (!options?.runId) throw new Error('[image-skill] createImage needs a runId');
  if (!options?.userId) {
    throw new Error('[image-skill] createImage needs a userId — the run is billed to it');
  }

  const log = options.log ?? defaultLog;
  const plan = planImageSkill(options.input);
  const deps: ImageSkillDeps = options.deps ?? {};

  log('image.plan', {
    briefing: plan.briefing,
    route: plan.route,
    model: plan.model,
    aspectRatio: plan.aspectRatio,
    references: plan.referenceUrls.length,
    credits: plan.credits,
    artefact: plan.artefactKey,
    notes: plan.notes,
  });

  // Reserve affordability BEFORE the first vendor call: kie bills on completion
  // and settlement is after the fact, so an empty wallet must stop us here.
  const affordable = await (deps.affordable ?? defaultAffordable)(options.userId, plan.credits);
  if (!affordable.ok) {
    throw new Error(
      `[image-skill] ${affordable.reason ?? `this image needs ${plan.credits} credits the account cannot cover`}`,
    );
  }

  const submit = deps.submit ?? defaultSubmit;
  const request: ImageRequest = {
    prompt: plan.prompt,
    model: plan.model,
    aspectRatio: plan.aspectRatio,
    referenceUrls: plan.referenceUrls,
  };

  let taskId: string | null = null;
  let lastReason: string | null = null;
  let submissions = 0;

  while (submissions < MAX_SUBMISSIONS) {
    submissions++;
    const result = await submit(request);
    if (result?.taskId) {
      taskId = result.taskId;
      break;
    }
    lastReason = result?.reason ?? 'the provider returned no task id';
    if (submissions < MAX_SUBMISSIONS && isRetryableMediaError(lastReason)) {
      log('image.retry', { model: plan.model, attempt: submissions + 1, reason: lastReason });
      continue;
    }
    break;
  }

  if (!taskId) {
    throw new Error(
      `[image-skill] run ${options.runId}: no image was started — ${lastReason ?? 'unknown reason'} ` +
        `(${submissions} submission(s) to ${plan.model})`,
    );
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = deps.pollTries ?? POLL_TRIES;
  const waitMs = deps.pollMs ?? POLL_MS;
  const poll = deps.poll ?? defaultPoll;

  let providerUrl: string | null = null;
  let pollReason: string | null = null;
  let polls = 0;

  for (let attempt = 0; attempt < tries; attempt++) {
    await sleep(waitMs);
    polls++;
    const polled = await poll(taskId);
    if (polled.url) {
      providerUrl = polled.url;
      break;
    }
    if (polled.reason) {
      pollReason = polled.reason;
      break;
    }
  }

  if (!providerUrl) {
    throw new Error(
      `[image-skill] run ${options.runId}: task ${taskId} produced no image — ` +
        `${pollReason ?? `still rendering after ${polls} poll(s)`}`,
    );
  }

  const bytes = await (deps.download ?? defaultDownload)(providerUrl);
  if (bytes.length === 0) {
    throw new Error(`[image-skill] run ${options.runId}: the provider returned an empty file`);
  }

  // The provider's own format decides the extension; the key stem does not change,
  // so a retry still overwrites the same object rather than duplicating it.
  const ext = sniffImageExtension(bytes);
  const key = `${plan.artefactKeyStem}.${ext}`;
  const published = await (deps.publish ?? defaultPublish)({
    key,
    bytes,
    contentType: CONTENT_TYPE_BY_EXT[ext],
  });

  const artefact: ImageArtefact = {
    key,
    url: published.url,
    bytes: published.bytes || bytes.length,
    aspectRatio: plan.aspectRatio,
    model: plan.model,
    route: plan.route,
    prompt: plan.prompt,
  };

  const recorded = await (deps.record ?? defaultRecord)(options.runId, artefact);

  log('image.published', {
    runId: options.runId,
    key: artefact.key,
    url: artefact.url,
    bytes: artefact.bytes,
    recorded: recorded.recorded,
    reason: recorded.reason,
    submissions,
    polls,
  });

  return { plan, runId: options.runId, taskId, artefact, recorded, submissions, polls };
}
