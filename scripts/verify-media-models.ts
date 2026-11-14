/**
 * Guard: every media model id lives in lib/agent/media-models.ts, and nowhere else.
 *
 * The bug this catches is copy drift, not a crash. The same kie.ai id used to be
 * typed into the chat route, onboarding, delivery allocation, both auto-generate
 * crons, three utils and two dashboards; when one copy was updated and the others
 * were not, half the app quietly kept using a retired model. So:
 *
 *   1. no application file may mention a media model id — the registry is the
 *      only place those strings are allowed to exist;
 *   2. the registry's own promises hold (known ids accepted, unknown rejected,
 *      reference in -> image-to-image, voice route order, credit maths);
 *   3. the retry-then-fallback helper retries a transient failure once, falls
 *      back exactly once, and leaves a successful primary alone.
 *
 *   npm run verify:media-models
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MEDIA_MODELS,
  imageModelFor,
  routeOrder,
  estimateCredits,
  videoCredits,
  assertKnownModel,
  isRetryableMediaError,
  withMediaFallback,
  type MediaKind,
} from '../lib/agent/media-models';

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

const ROOT = process.cwd();

/**
 * Application code: everything that ships to a user or an API route. `scripts`
 * is deliberately absent — it is where the id fixtures and this guard live, and
 * `scripts/agent-selftest.mjs` asserts the ids as an independent second opinion.
 */
const SCAN_DIRS = [
  'app',
  'components',
  'lib',
  'utils',
  'mobile',
  'renderer',
  'stitcher',
  'remotion',
  'voice-bridge',
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.vercel',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
]);

/**
 * Files that legitimately mention a TTS model id that is NOT a kie media model —
 * the Google-direct call pipeline:
 *
 *  - lib/agent/media-models.ts   the registry itself.
 *  - utils/tts-flash-config.ts   }
 *  - utils/app-url.ts            } Vertex ids written with dots
 *  - voice-bridge/**             } (`gemini-3.8-flash-tts`), chosen per deploy by
 *                                  TTS_FLASH_TTS_MODEL; app-url.ts holds a Cloud
 *                                  Run HOSTNAME (`gemini-voice-bridge-tts`), not
 *                                  a model. None of it is a kie model, so none of
 *                                  it belongs in the registry. The bridge is
 *                                  plain Node and its own header says it cannot
 *                                  import from /utils.
 */
const ALLOWED_FILES = new Set([
  'lib/agent/media-models.ts',
  'utils/tts-flash-config.ts',
  'utils/app-url.ts',
]);
const ALLOWED_PREFIXES = ['voice-bridge/'];

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'gpt-image-', re: /gpt-image-/ },
  { label: 'grok-imagine', re: /grok-imagine/ },
  { label: 'gemini-*-tts', re: /gemini-[A-Za-z0-9.-]*-tts/ },
  { label: 'nano-banana', re: /nano-banana/ },
  { label: 'V6_MINI', re: /V6_MINI/ },
];

function walk(dir: string, sink: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, sink);
    } else if (entry.isFile() && TEXT_EXT.has(path.extname(entry.name))) {
      sink.push(full);
    }
  }
}

const rel = (full: string) => path.relative(ROOT, full).split(path.sep).join('/');

(async () => {
  console.log('=== no media model id outside lib/agent/media-models.ts ===');
  {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files);

    const scanned = files.filter((f) => {
      const r = rel(f);
      if (ALLOWED_FILES.has(r)) return false;
      if (ALLOWED_PREFIXES.some((p) => r.startsWith(p))) return false;
      return true;
    });

    check('application files were found to scan', scanned.length > 100, `${scanned.length} files`);

    for (const pattern of PATTERNS) {
      const hits: string[] = [];
      for (const file of scanned) {
        let text: string;
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        if (!pattern.re.test(text)) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.re.test(lines[i])) hits.push(`${rel(file)}:${i + 1}`);
        }
      }
      check(
        `no inline \`${pattern.label}\` in application code`,
        hits.length === 0,
        hits.length
          ? `${hits.length} hit(s): ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? ' …' : ''}`
          : `${scanned.length} files clean`,
      );
    }
  }

  console.log('\n=== assertKnownModel: the registry is the only authority ===');
  {
    const known = new Set<string>();
    for (const kind of Object.keys(MEDIA_MODELS) as MediaKind[]) {
      known.add(MEDIA_MODELS[kind].id);
      for (const fb of MEDIA_MODELS[kind].fallbacks) known.add(fb);
    }

    let accepted = 0;
    for (const id of known) {
      try {
        if (assertKnownModel(id) === id) accepted++;
      } catch {
        /* counted below */
      }
    }
    check(
      'every registry id (and fallback) is accepted',
      accepted === known.size,
      `${accepted}/${known.size} ids`,
    );

    for (const bogus of ['gpt-image-4', 'grok-imagine-video-9']) {
      let threw = false;
      try {
        assertKnownModel(bogus);
      } catch {
        threw = true;
      }
      check(`\`${bogus}\` is rejected`, threw);
    }
  }

  console.log('\n=== imageModelFor: a reference in means image-to-image ===');
  check(
    'imageModelFor([]) is the text-to-image id',
    imageModelFor([]) === MEDIA_MODELS.image.id,
    imageModelFor([]),
  );
  check(
    "imageModelFor(['https://x/y.png']) is the image-to-image id",
    imageModelFor(['https://x/y.png']) === MEDIA_MODELS.imageEdit.id,
    imageModelFor(['https://x/y.png']),
  );

  console.log('\n=== routeOrder: primary first, then the fallbacks in order ===');
  for (const kind of ['voice', 'image', 'imageEdit', 'video'] as MediaKind[]) {
    const expected = [MEDIA_MODELS[kind].id, ...MEDIA_MODELS[kind].fallbacks];
    const got = routeOrder(kind);
    check(
      `routeOrder('${kind}') is ${expected.length} id(s), primary first`,
      JSON.stringify(got) === JSON.stringify(expected),
      got.join(' -> '),
    );
  }
  check(
    "routeOrder('voice') is [3.8 Flash, 2.5 Pro] in that order",
    routeOrder('voice')[0] === MEDIA_MODELS.voice.id &&
      routeOrder('voice')[1] === MEDIA_MODELS.voice.fallbacks[0],
    routeOrder('voice').join(' -> '),
  );

  console.log('\n=== credit maths ===');
  {
    // Grok Imagine 1080p is billed per second of output, not per request.
    check(
      'registry says video is 8 credits/sec',
      MEDIA_MODELS.video.creditsPerSecond === 8,
      `creditsPerSecond=${MEDIA_MODELS.video.creditsPerSecond}`,
    );
    check('videoCredits(6) is 48', videoCredits(6) === 48, `got ${videoCredits(6)}`);
    check(
      "estimateCredits('video', 6) is 48",
      estimateCredits('video', 6) === 48,
      `got ${estimateCredits('video', 6)}`,
    );
    check(
      'estimateCredits and videoCredits agree on video',
      estimateCredits('video', 6) === videoCredits(6),
      `${estimateCredits('video', 6)} vs ${videoCredits(6)}`,
    );
    check(
      "estimateCredits('image', 1) is non-zero",
      estimateCredits('image', 1) > 0,
      `got ${estimateCredits('image', 1)}`,
    );
    check(
      "estimateCredits('music', 1) is non-zero",
      estimateCredits('music', 1) > 0,
      `got ${estimateCredits('music', 1)}`,
    );
    check(
      "estimateCredits('voice', 1) is non-zero",
      estimateCredits('voice', 1) > 0,
      `got ${estimateCredits('voice', 1)}`,
    );
  }

  console.log('\n=== retry-then-fallback helper ===');
  {
    const voice = MEDIA_MODELS.voice.id;
    const voiceFallback = MEDIA_MODELS.voice.fallbacks[0];
    const quiet = { log: () => {} };

    check('HTTP 524 is retryable', isRetryableMediaError('Kie AI Task creation failed with status 524'));
    check('`generate task timeout` is retryable', isRetryableMediaError('generate task timeout'));
    check('a 422 is NOT retryable', !isRetryableMediaError('Kie AI Task creation failed with status 422'));

    // 1. primary 524s: one retry on the primary, then exactly one fallback.
    const calls524: string[] = [];
    const res524 = await withMediaFallback(
      'voice',
      async (model) => {
        calls524.push(model);
        if (model === voice) return { taskId: null as string | null, error: 'HTTP 524: origin timed out' };
        return { taskId: 'task-fallback', error: null };
      },
      quiet,
    );
    const primaryAttempts = calls524.filter((m) => m === voice).length;
    const fallbackAttempts = calls524.filter((m) => m === voiceFallback).length;
    check('a 524 on the primary is retried once', primaryAttempts === 2, `primary called ${primaryAttempts}x`);
    check('after the retry it falls back exactly once', fallbackAttempts === 1, `fallback called ${fallbackAttempts}x`);
    check(
      'the fallback result is the one returned, and reported as a fallback',
      res524.ok && res524.fellBack && res524.model === voiceFallback && res524.value?.taskId === 'task-fallback',
      `ok=${res524.ok} model=${res524.model} fellBack=${res524.fellBack}`,
    );
    check('the log says which model was used and why', /FALLBACK/.test(res524.log.join('\n')), res524.log.slice(-1)[0]);

    // 2. a permanent failure is not retried — it just falls back.
    const calls422: string[] = [];
    await withMediaFallback(
      'voice',
      async (model) => {
        calls422.push(model);
        if (model === voice) return { taskId: null as string | null, error: 'HTTP 422: bad payload' };
        return { taskId: 'task-422', error: null };
      },
      quiet,
    );
    check(
      'a 422 is not retried, it falls straight back',
      calls422.filter((m) => m === voice).length === 1 &&
        calls422.filter((m) => m === voiceFallback).length === 1,
      calls422.join(' -> '),
    );

    // 3. a healthy primary is never shadowed by a fallback.
    const callsOk: string[] = [];
    const resOk = await withMediaFallback(
      'voice',
      async (model) => {
        callsOk.push(model);
        return { taskId: 'task-primary', error: null };
      },
      quiet,
    );
    check(
      'a successful primary does not fall back',
      resOk.ok && !resOk.fellBack && resOk.model === voice && callsOk.length === 1 && callsOk[0] === voice,
      `calls=${callsOk.join(',')} model=${resOk.model}`,
    );
    check('a successful primary is not retried either', resOk.attempts.length === 1, `${resOk.attempts.length} attempt(s)`);

    // 4. a route with no fallback reports failure instead of inventing one.
    const resDead = await withMediaFallback(
      'music',
      async () => ({ taskId: null as string | null, error: 'generate task timeout' }),
      quiet,
    );
    check(
      'a route with no fallback gives up with the last reason',
      !resDead.ok && resDead.model === null && /timeout/.test(String(resDead.reason)),
      `ok=${resDead.ok} reason=${resDead.reason}`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error('verify-media-models failed:', e?.message || e);
  process.exit(1);
});
