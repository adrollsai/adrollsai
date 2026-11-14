/**
 * Agent self-test — proves the durable runner actually behaves under failure.
 *
 * Run:  node scripts/agent-selftest.mjs
 *
 * Nothing here touches E2B, kie.ai or Supabase: the sandbox, store and credit
 * ledger are fakes that record what the runner did. If these pass, a killed
 * sandbox costs one step, never a double charge.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { runPipeline } = await load('lib/agent/sandbox/runner.ts');
const { MEDIA_MODELS, imageModelFor, routeOrder, videoCredits, assertKnownModel } = await load(
  'lib/agent/media-models.ts',
);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- fakes
function makeHarness({ killAfterStep, failStep, artefactPresent = [] } = {}) {
  const events = [];
  const state = {
    sandbox: null,
    store: new Map(),
    holds: [],
    charges: [],
    refunds: [],
    created: 0,
    connects: 0,
    pauses: 0,
    kills: 0,
  };

  const sandboxes = {
    async create() {
      state.created += 1;
      state.sandbox = { id: `sbx-${state.created}`, paused: false };
      return {
        get id() {
          return state.sandbox.id;
        },
        async pause() {
          state.pauses += 1;
          state.sandbox.paused = true;
          events.push('pause');
        },
        async kill() {
          state.kills += 1;
          events.push('kill');
        },
      };
    },
    async connect(id) {
      state.connects += 1;
      if (killAfterStep && state.store.get('run')?.completed.includes(killAfterStep) && state.connects === 1) {
        throw new Error('sandbox gone');
      }
      state.sandbox = { id, paused: false };
      return {
        get id() {
          return id;
        },
        async pause() {
          state.pauses += 1;
          events.push('pause');
        },
        async kill() {
          state.kills += 1;
          events.push('kill');
        },
      };
    },
  };

  const deps = {
    sandboxes,
    store: {
      async load() {
        return state.store.get('run') ?? null;
      },
      async save(_runId, cp) {
        state.store.set('run', JSON.parse(JSON.stringify(cp)));
      },
    },
    credits: {
      async hold(_r, amount) {
        state.holds.push(amount);
      },
      async charge(_r, step, amount) {
        state.charges.push({ step, amount });
      },
      async refund(_r, amount, reason) {
        state.refunds.push({ amount, reason });
      },
    },
    artefactExists: async (step) => artefactPresent.includes(step.artefact),
    now: (() => {
      let t = 0;
      return () => (t += 5);
    })(),
    sleep: async () => {},
    log: (event, data) => events.push(`${event}${data ? '' : ''}`),
  };

  return { deps, state, events };
}

function steps(overrides = {}) {
  return [
    {
      name: 'fetch-reference',
      credits: 0,
      artefact: 'ref.jpg',
      async run() {},
      ...(overrides['fetch-reference'] ?? {}),
    },
    {
      name: 'voiceover',
      credits: 2,
      artefact: 'vo.wav',
      async run() {},
      ...(overrides.voiceover ?? {}),
    },
    { name: 'render', credits: 10, artefact: 'out.mp4', async run() {}, ...(overrides.render ?? {}) },
  ];
}

// ---------------------------------------------------------------- tests
console.log('\nrunner: happy path');
{
  const { deps, state } = makeHarness();
  const result = await runPipeline(deps, { runId: 'run', steps: steps(), idlePauseMs: 0 });
  check('all steps complete', result.completed.length === 3, JSON.stringify(result.completed));
  check('charges match steps', state.charges.reduce((s, c) => s + c.amount, 0) === 12);
  check('exactly one hold for the full run', state.holds.length === 1 && state.holds[0] === 12);
  check('sandbox never killed', state.kills === 0);
}

console.log('\nrunner: artefact already exists (no double charge)');
{
  const { deps, state } = makeHarness({ artefactPresent: ['ref.jpg', 'vo.wav'] });
  const result = await runPipeline(deps, { runId: 'run', steps: steps(), idlePauseMs: 0 });
  check('skips two steps', result.skipped.length === 2, JSON.stringify(result.skipped));
  check('charges only the remaining step', state.charges.length === 1 && state.charges[0].step === 'render');
}

console.log('\nrunner: resume after a lost sandbox');
{
  const { deps, state } = makeHarness();
  let boom = true;
  const s = steps({
    render: {
      async run() {
        if (boom) throw new Error('render died at 74%');
      },
    },
  });
  let threw = false;
  try {
    await runPipeline(deps, { runId: 'run', steps: s, idlePauseMs: 0, maxAttemptsPerStep: 1 });
  } catch {
    threw = true;
  }
  check('first attempt fails loudly', threw);
  check('refund released only the unspent reserve', state.refunds.length === 1 && state.refunds[0].amount === 10, JSON.stringify(state.refunds));
  check('sandbox paused, not killed', state.kills === 0 && state.pauses >= 1);

  boom = false;
  const result = await runPipeline(deps, { runId: 'run', steps: s, idlePauseMs: 0 });
  check('resumes from checkpoint', result.resumedFrom === 2, `resumedFrom=${result.resumedFrom}`);
  const totalCharged = state.charges.reduce((s, c) => s + c.amount, 0);
  const renderCharges = state.charges.filter((c) => c.step === 'render').length;
  check('every step charged exactly once across both runs', totalCharged === 12 && renderCharges === 1, JSON.stringify(state.charges));
  check('now completes all three', result.completed.length === 3);
}

console.log('\nrunner: soft cap (never reach the 1 h kill)');
{
  const { deps, state } = makeHarness();
  const result = await runPipeline(deps, { runId: 'run', steps: steps(), softCapMs: 1, idlePauseMs: 0 });
  check('pauses at least once', result.pauses >= 1, `pauses=${result.pauses}`);
  check('every step completes once', result.completed.length === 3);
  check('reconnects instead of recreating', state.created === 1 && state.connects >= 1);
}

console.log('\nrunner: idle pause');
{
  const { deps, state } = makeHarness();
  const result = await runPipeline(deps, { runId: 'run', steps: steps(), idlePauseMs: 6, softCapMs: 1e9 });
  check('pauses while idle', result.pauses >= 1, `pauses=${result.pauses}`);
  check('still charges each step once', state.charges.length === 3);
}

console.log('\nmedia models: the ids this account actually uses');
{
  check('image t2i is Flare 2.5', MEDIA_MODELS.image.id === 'gpt-image-2-5-flare-text-to-image');
  check('image i2i is Flare 2.5', MEDIA_MODELS.imageEdit.id === 'gpt-image-2-5-flare-image-to-image');
  check('video is Grok Imagine 1.5', MEDIA_MODELS.video.id === 'grok-imagine-video-1-5-preview');
  check('voice is Gemini 3.8 Flash TTS', MEDIA_MODELS.voice.id === 'google/gemini-3-8-flash-tts');
  check('voice has a Pro fallback', MEDIA_MODELS.voice.fallbacks.includes('google/gemini-2-5-pro-tts'));
  check('reference input routes to i2i', imageModelFor(['x.jpg']) === MEDIA_MODELS.imageEdit.id);
  check('no reference routes to t2i', imageModelFor([]) === MEDIA_MODELS.image.id);
  check('route order puts primary first', routeOrder('image')[0] === MEDIA_MODELS.image.id);
  check('a 6 s clip costs 48 credits', videoCredits(6) === 48, String(videoCredits(6)));
  let rejected = false;
  try {
    assertKnownModel('made-up-model');
  } catch {
    rejected = true;
  }
  check('unknown model id is rejected', rejected);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('failures:', failures.join(', '));
  process.exit(1);
}
