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
import { register } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/**
 * Node strips TypeScript types natively, but its resolver is stricter than the
 * bundler's: no `@/utils/r2`, no extensionless `./runner`. These hooks add the
 * two things this repo's source already relies on and nothing else, so every
 * assertion below exercises the REAL adapter modules rather than a copy.
 */
register('./ts-resolve-hooks.mjs', import.meta.url);

const { runPipeline } = await load('lib/agent/sandbox/runner.ts');
const { MEDIA_MODELS, imageModelFor, routeOrder, videoCredits, assertKnownModel } = await load(
  'lib/agent/media-models.ts',
);
const { createE2BSandboxes, SandboxAdapterError, runStepCommand } = await load(
  'lib/agent/sandbox/e2b.ts',
);
const { createSupabaseStore } = await load('lib/agent/sandbox/store.ts');
const { createSupabaseCredits, InsufficientCreditsError, chargeRef } = await load(
  'lib/agent/sandbox/credits.ts',
);
const { createArtefactExists, artefactKey } = await load('lib/agent/sandbox/artefact.ts');
const { runVideoPipeline, videoPipelineSteps, DEFAULT_VIDEO_JOB } = await load(
  'lib/agent/sandbox/pipeline.ts',
);
const { bufferedLogger } = await load('lib/agent/sandbox/log.ts');
const { R2_PUBLIC_URL } = await load('utils/r2.ts');


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

// ---------------------------------------------------------------- fake PostgREST
/**
 * The smallest PostgREST + credit RPC surface the REAL adapters use.
 *
 * This is not a stub of the adapters: `createSupabaseStore` and
 * `createSupabaseCredits` run for real, through the real
 * lib/automation/billing.ts helpers, against this in-memory database. The RPCs
 * below mirror 20261213000100_atomic_credit_functions.sql closely enough to keep
 * its two load-bearing properties: `charge_hold` claims the unique `ref` BEFORE
 * moving a balance, and `close_hold` only acts on a hold that is still 'open'.
 */
function makeFakePostgres({ credits = 500, userId = 'user-1' } = {}) {
  const state = {
    profiles: [{ id: userId, parent_id: null, agency_id: null, credits }],
    credit_holds: [],
    credit_transactions: [],
    agent_runs: [],
    rpcCalls: [],
  };

  const rows = (table) => {
    if (!(table in state)) throw new Error(`fake postgrest: unknown table ${table}`);
    return state[table];
  };

  class Query {
    constructor(table, op, payload) {
      this.table = table;
      this.op = op;
      this.payload = payload;
      this.filters = [];
      this.conflict = 'id';
    }
    select() {
      return this;
    }
    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    }
    matches(row) {
      return this.filters.every(([column, value]) => row[column] === value);
    }
    matching() {
      return rows(this.table).filter((row) => this.matches(row));
    }
    async maybeSingle() {
      const found = this.matching();
      return { data: found.length > 0 ? found[0] : null, error: null };
    }
    async single() {
      return this.maybeSingle();
    }
    then(onFulfilled, onRejected) {
      return this.run().then(onFulfilled, onRejected);
    }
    async run() {
      const table = rows(this.table);
      if (this.op === 'select') return { data: this.matching(), error: null };
      if (this.op === 'insert') {
        const row = { ...this.payload };
        if (this.table === 'credit_transactions' && row.ref != null) {
          const clash = table.some((existing) => existing.ref === row.ref);
          if (clash) {
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "credit_transactions_ref_uniq"',
              },
            };
          }
        }
        table.push(row);
        return { data: row, error: null };
      }
      if (this.op === 'upsert') {
        const keys = Array.isArray(this.conflict) ? this.conflict : [this.conflict];
        const existing = table.find((row) => keys.every((key) => row[key] === this.payload[key]));
        if (existing) Object.assign(existing, this.payload);
        else table.push({ ...this.payload });
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        for (const row of this.matching()) Object.assign(row, this.payload);
        return { data: null, error: null };
      }
      if (this.op === 'delete') {
        for (const row of this.matching()) table.splice(table.indexOf(row), 1);
        return { data: null, error: null };
      }
      throw new Error(`fake postgrest: unsupported op ${this.op}`);
    }
  }

  const available = (uid) => {
    const profile = state.profiles.find((p) => p.id === uid);
    if (!profile) return null;
    const reserved = state.credit_holds
      .filter((hold) => hold.user_id === uid && hold.state === 'open')
      .reduce((sum, hold) => sum + (hold.amount - hold.spent), 0);
    return Number(profile.credits ?? 0) - reserved;
  };

  const api = {
    from(table) {
      return {
        select: () => new Query(table, 'select'),
        insert: (row) => new Query(table, 'insert', row),
        upsert: (row, opts) => {
          const query = new Query(table, 'upsert', row);
          query.conflict = opts?.onConflict ?? 'id';
          return query;
        },
        update: (patch) => new Query(table, 'update', patch),
        delete: () => new Query(table, 'delete'),
      };
    },

    async rpc(name, params = {}) {
      state.rpcCalls.push({ name, params });
      const openHold = (uid, jobId) =>
        state.credit_holds.find(
          (hold) => hold.user_id === uid && hold.job_id === jobId && hold.state === 'open',
        );

      switch (name) {
        case 'available_credits':
          return { data: available(params.p_user_id), error: null };

        case 'reserve_credits': {
          const uid = params.p_user_id;
          const existing = openHold(uid, params.p_job_id);
          if (existing) return { data: existing.id, error: null }; // re-attach
          const left = available(uid);
          if (left === null || left < Number(params.p_amount)) return { data: null, error: null };
          const hold = {
            id: `hold-${state.credit_holds.length + 1}`,
            user_id: uid,
            job_id: params.p_job_id,
            amount: Number(params.p_amount),
            spent: 0,
            state: 'open',
            reason: params.p_reason ?? null,
            created_at: new Date().toISOString(),
          };
          state.credit_holds.push(hold);
          return { data: hold.id, error: null };
        }

        case 'charge_hold': {
          const hold = state.credit_holds.find((h) => h.id === params.p_hold_id);
          if (!hold) return { data: { ok: false, error: 'hold_not_found' }, error: null };
          if (hold.state !== 'open') {
            return { data: { ok: false, error: `hold_${hold.state}` }, error: null };
          }
          const remaining = Math.max(hold.amount - hold.spent, 0);
          const requested = Math.max(Number(params.p_amount) || 0, 0);
          const charge = Math.min(requested, remaining);
          if (charge <= 0) {
            return { data: { ok: true, charged: 0, capped: requested > 0, remaining }, error: null };
          }
          if (params.p_ref != null) {
            const duplicate = state.credit_transactions.some((t) => t.ref === params.p_ref);
            if (duplicate) {
              return { data: { ok: true, duplicate: true, charged: 0, remaining }, error: null };
            }
            state.credit_transactions.push({
              user_id: hold.user_id,
              amount: -charge,
              category: params.p_category,
              description: params.p_description,
              ref: params.p_ref,
            });
          }
          const profile = state.profiles.find((p) => p.id === hold.user_id);
          if (!profile || Number(profile.credits) < charge) {
            if (params.p_ref != null) {
              const index = state.credit_transactions.findIndex(
                (t) => t.ref === params.p_ref && t.amount === -charge,
              );
              if (index >= 0) state.credit_transactions.splice(index, 1);
            }
            return {
              data: { ok: false, error: 'insufficient_at_settle', requested: charge, remaining },
              error: null,
            };
          }
          profile.credits = Number(profile.credits) - charge;
          hold.spent += charge;
          if (params.p_ref == null) {
            state.credit_transactions.push({
              user_id: hold.user_id,
              amount: -charge,
              category: params.p_category,
              description: params.p_description,
            });
          }
          return {
            data: {
              ok: true,
              charged: charge,
              balance: profile.credits,
              remaining: remaining - charge,
              capped: requested > charge,
            },
            error: null,
          };
        }

        case 'close_hold':
        case 'release_hold': {
          const hold = state.credit_holds.find((h) => h.id === params.p_hold_id);
          if (!hold) return { data: { ok: false, error: 'hold_not_found' }, error: null };
          if (hold.state !== 'open') {
            return { data: { ok: true, already: hold.state, spent: hold.spent }, error: null };
          }
          hold.state = hold.spent > 0 ? 'settled' : 'released';
          hold.settled_at = new Date().toISOString();
          return {
            data: { ok: true, state: hold.state, spent: hold.spent, released: hold.amount - hold.spent },
            error: null,
          };
        }

        case 'spend_credits': {
          const profile = state.profiles.find((p) => p.id === params.p_user_id);
          if (!profile) return { data: null, error: null };
          const amount = Number(params.p_amount) || 0;
          if (amount === 0) return { data: Number(profile.credits), error: null };
          if (Number(profile.credits) < amount) return { data: null, error: null };
          profile.credits = Number(profile.credits) - amount;
          return { data: profile.credits, error: null };
        }

        default:
          return {
            data: null,
            error: { code: 'PGRST202', message: `Could not find the function public.${name}` },
          };
      }
    },
  };

  return { state, api, available };
}

/** What a wallet looks like from outside: balance, reserved, spendable. */
function wallet(pg) {
  const balance = Number(pg.state.profiles[0]?.credits ?? 0);
  const reserved = pg.state.credit_holds
    .filter((hold) => hold.state === 'open')
    .reduce((sum, hold) => sum + (hold.amount - hold.spent), 0);
  return { balance, reserved, available: balance - reserved, ledger: pg.state.credit_transactions.length };
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

console.log('\nsandbox store: the checkpoint survives a restart');
{
  const pg = makeFakePostgres();
  const store = createSupabaseStore({ supabase: pg.api, userId: 'user-1', log: bufferedLogger() });

  check('an unknown run loads as null', (await store.load('run-none')) === null);

  await store.save('run-1', {
    runId: 'run-1',
    sandboxId: 'sbx-9',
    completed: ['voiceover', 'clips'],
    continuousMs: 123_456,
    held: 54,
    charged: 50,
  });

  const loaded = await store.load('run-1');
  check(
    'round-trips completed',
    JSON.stringify(loaded.completed) === '["voiceover","clips"]',
    JSON.stringify(loaded.completed),
  );
  check('round-trips continuous_ms', loaded.continuousMs === 123_456, String(loaded.continuousMs));
  check(
    'round-trips held and charged',
    loaded.held === 54 && loaded.charged === 50,
    `${loaded.held}/${loaded.charged}`,
  );
  check('round-trips the sandbox id', loaded.sandboxId === 'sbx-9', loaded.sandboxId);

  await store.save('run-1', {
    runId: 'run-1',
    sandboxId: 'sbx-10',
    completed: ['voiceover', 'clips', 'render'],
    continuousMs: 1,
    held: 54,
    charged: 54,
  });
  check(
    'save is an upsert on run_id (one row per run)',
    pg.state.agent_runs.length === 1 && pg.state.agent_runs[0].sandbox_id === 'sbx-10',
    JSON.stringify(pg.state.agent_runs.map((row) => row.sandbox_id)),
  );
  check(
    'the row keeps the owner the RLS policy checks',
    pg.state.agent_runs[0].user_id === 'user-1',
    String(pg.state.agent_runs[0].user_id),
  );

  await store.setStatus('run-1', 'completed');
  check('setStatus records the terminal state', (await store.read('run-1')).status === 'completed');

  const unreadable = createSupabaseStore({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }),
          }),
        }),
      }),
    },
    userId: 'user-1',
  });
  let loadError = null;
  try {
    await unreadable.load('run-1');
  } catch (error) {
    loadError = error;
  }
  check(
    'an unreadable checkpoint fails loudly instead of resuming blind',
    loadError !== null && /connection reset/.test(loadError.message),
    String(loadError),
  );
}

console.log('\ncredits adapter: exactly once per (run_id, step)');
{
  const pg = makeFakePostgres({ credits: 500 });
  const log = bufferedLogger();
  const credits = createSupabaseCredits({ supabase: pg.api, userId: 'user-1', log });

  await credits.hold('run-A', 12);
  check(
    'the whole run is reserved before any work starts',
    pg.state.credit_holds.length === 1 &&
      pg.state.credit_holds[0].amount === 12 &&
      wallet(pg).available === 488,
    JSON.stringify(wallet(pg)),
  );

  await credits.charge('run-A', 'voiceover', 2);
  check(
    'a completed step moves exactly its price',
    wallet(pg).balance === 498 && pg.state.credit_holds[0].spent === 2,
    JSON.stringify(wallet(pg)),
  );

  await credits.charge('run-A', 'voiceover', 2);
  check(
    'the repeated (run_id, step) charges exactly once',
    wallet(pg).balance === 498 && wallet(pg).ledger === 1,
    JSON.stringify(wallet(pg)),
  );
  check(
    'the repeat is reported as a duplicate, not an error',
    log.events.some((entry) => entry.event === 'credits.charge_duplicate'),
    log.events.map((entry) => entry.event).join(','),
  );
  check(
    'the idempotency key is namespaced per run and step',
    chargeRef('run-A', 'voiceover') === 'agent_run:run-A:voiceover' &&
      pg.state.credit_transactions[0].ref === 'agent_run:run-A:voiceover',
    String(pg.state.credit_transactions[0].ref),
  );

  const beforeRefund = wallet(pg);
  await credits.refund('run-A', 10, 'pipeline_failed:boom');
  check(
    'a refund releases the unspent reserve (a partly spent hold closes as settled)',
    wallet(pg).reserved === 0 &&
      wallet(pg).available === beforeRefund.available + 10 &&
      pg.state.credit_holds[0].state === 'settled',
    JSON.stringify({ before: beforeRefund, after: wallet(pg), state: pg.state.credit_holds[0].state }),
  );

  const afterRefund = wallet(pg);
  await credits.refund('run-A', 10, 'pipeline_failed:boom');
  check(
    'a repeated refund moves nothing',
    wallet(pg).available === afterRefund.available &&
      wallet(pg).balance === afterRefund.balance &&
      wallet(pg).ledger === afterRefund.ledger,
    JSON.stringify({ after: afterRefund, again: wallet(pg) }),
  );

  const poor = makeFakePostgres({ credits: 5 });
  const poorCredits = createSupabaseCredits({ supabase: poor.api, userId: 'user-1' });
  let paywall = null;
  try {
    await poorCredits.hold('run-poor', 12);
  } catch (error) {
    paywall = error;
  }
  check(
    'an unfunded run is refused before any work and reserves nothing',
    paywall instanceof InsufficientCreditsError && poor.state.credit_holds.length === 0,
    String(paywall),
  );

  const pgRestart = makeFakePostgres({ credits: 500 });
  const firstProcess = createSupabaseCredits({ supabase: pgRestart.api, userId: 'user-1' });
  await firstProcess.hold('run-B', 10);
  const secondProcess = createSupabaseCredits({ supabase: pgRestart.api, userId: 'user-1' });
  await secondProcess.charge('run-B', 'voiceover', 2);
  check(
    'a resumed run re-attaches to the existing reservation instead of reserving twice',
    pgRestart.state.credit_holds.length === 1 && wallet(pgRestart).balance === 498,
    JSON.stringify(wallet(pgRestart)),
  );

  const pgSettle = makeFakePostgres({ credits: 500 });
  const settleCredits = createSupabaseCredits({ supabase: pgSettle.api, userId: 'user-1' });
  await settleCredits.hold('run-C', 12);
  await settleCredits.charge('run-C', 'voiceover', 2);
  await settleCredits.settle('run-C', 'run_complete');
  check(
    'settle releases what a finished run never spent',
    pgSettle.state.credit_holds[0].state === 'settled' &&
      wallet(pgSettle).reserved === 0 &&
      wallet(pgSettle).available === 498,
    JSON.stringify({ wallet: wallet(pgSettle), state: pgSettle.state.credit_holds[0].state }),
  );
}

console.log('\ne2b adapter: readable errors, and it never kills');
{
  const log = bufferedLogger();
  const observed = { kills: 0, pauses: 0 };

  const createFails = createE2BSandboxes({
    log,
    sandboxClass: {
      async create() {
        const error = new Error('you have reached the sandbox concurrency limit');
        error.name = 'RateLimitError';
        throw error;
      },
      async connect() {
        throw new Error('unreachable');
      },
    },
  });

  let createError = null;
  try {
    await createFails.create();
  } catch (error) {
    createError = error;
  }
  check(
    'a create failure is a readable SandboxAdapterError',
    createError instanceof SandboxAdapterError && createError.op === 'create',
    String(createError),
  );
  check(
    'the create failure names e2b and keeps the cause',
    typeof createError?.message === 'string' &&
      /e2b/.test(createError.message) &&
      /concurrency limit/.test(createError.message),
    createError?.message,
  );

  const connectFails = createE2BSandboxes({
    log,
    sandboxClass: {
      async create() {
        throw new Error('sdk should not be asked to create here');
      },
      async connect(sandboxId) {
        const error = new Error('sandbox not found');
        error.name = 'NotFoundError';
        error.sandboxId = sandboxId;
        throw error;
      },
    },
  });

  let connectError = null;
  try {
    await connectFails.connect('sbx-dead');
  } catch (error) {
    connectError = error;
  }
  check(
    'a connect failure is readable and names the sandbox',
    connectError instanceof SandboxAdapterError &&
      connectError.op === 'connect' &&
      /sbx-dead/.test(connectError.message),
    connectError?.message,
  );

  const handle = {
    sandboxId: 'sbx-live',
    commands: {
      async run(command) {
        if (command.includes('explode')) throw new Error('channel closed');
        if (command.includes('exit-3')) return { exitCode: 3, stdout: '', stderr: 'boom: no such file' };
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    },
    files: { async write() {} },
    async pause() {
      observed.pauses += 1;
      throw new Error('node busy, cannot pause right now');
    },
    async kill() {
      observed.kills += 1;
    },
  };

  const live = createE2BSandboxes({
    log,
    sandboxClass: {
      async create() {
        return handle;
      },
      async connect() {
        return handle;
      },
    },
  });

  const sandbox = await live.create();
  check('a created sandbox exposes the id the checkpoint stores', sandbox.id === 'sbx-live', sandbox.id);

  let pauseThrew = false;
  try {
    await sandbox.pause();
  } catch {
    pauseThrew = true;
  }
  check(
    'a refused pause is logged, never thrown out of the runner',
    !pauseThrew && log.events.some((entry) => entry.event === 'sandbox.adapter.pause_failed'),
    String(pauseThrew),
  );

  await sandbox.kill();
  check(
    'kill() pauses instead of killing - the workspace always survives',
    observed.kills === 0 && observed.pauses >= 2,
    JSON.stringify(observed),
  );

  let execError = null;
  try {
    await sandbox.exec('exit-3');
  } catch (error) {
    execError = error;
  }
  check(
    'a non-zero command becomes a readable error with the stderr tail',
    execError instanceof SandboxAdapterError &&
      /exited 3/.test(execError.message) &&
      /no such file/.test(execError.message),
    execError?.message,
  );
  check(
    'allowNonZero returns the failure instead of throwing',
    (await sandbox.exec('exit-3', { allowNonZero: true })).exitCode === 3,
  );

  let bareError = null;
  try {
    await runStepCommand(
      { id: 'plain', async pause() {}, async kill() {} },
      { command: 'ffmpeg', sandboxPath: '/tmp/x.mp4' },
      { name: 'render' },
    );
  } catch (error) {
    bareError = error;
  }
  check(
    'a step refuses to run on a sandbox with no exec()',
    /not executable/.test(String(bareError?.message)),
    String(bareError),
  );
}

console.log('\nartefactExists: an R2 head decides skip-or-run');
{
  const log = bufferedLogger();
  const asked = [];

  const probe = createArtefactExists({
    log,
    head: async (key) => {
      asked.push(key);
      return key === 'agent_render/demo/voiceover.mp3';
    },
  });

  const present = await probe({ name: 'voiceover', credits: 2, artefact: 'agent_render/demo/voiceover.mp3', async run() {} });
  const absent = await probe({ name: 'clips', credits: 48, artefact: 'agent_render/demo/clip.mp4', async run() {} });
  const noArtefact = await probe({ name: 'adhoc', credits: 0, async run() {} });

  check('true when the object is in the bucket (step is skipped, not charged)', present === true);
  check('false when it is not (the step runs)', absent === false);
  check('false for a step that declares no artefact', noArtefact === false);
  check('the probe asks for the artefact key', asked[0] === 'agent_render/demo/voiceover.mp3', asked.join(','));

  const throwing = createArtefactExists({
    head: async () => {
      throw new Error('HeadObject 403 Forbidden');
    },
  });
  check(
    'a probe that throws answers "missing" rather than aborting the run',
    (await throwing({ name: 'clips', credits: 1, artefact: 'x/y.mp4', async run() {} })) === false,
  );

  check(
    'a public R2 URL is reduced to its key',
    artefactKey(`${R2_PUBLIC_URL}/agent_render/demo/final.mp4`) === 'agent_render/demo/final.mp4',
    artefactKey(`${R2_PUBLIC_URL}/agent_render/demo/final.mp4`),
  );

  const scopedKeys = [];
  const scoped = createArtefactExists({
    prefix: 'tenant-7',
    head: async (key) => {
      scopedKeys.push(key);
      return true;
    },
  });
  await scoped({ name: 'render', credits: 4, artefact: 'a/final.mp4', async run() {} });
  check('a prefix scopes keys per tenant', scopedKeys[0] === 'tenant-7/a/final.mp4', String(scopedKeys[0]));

  const alreadyScoped = [];
  const scopedAgain = createArtefactExists({
    prefix: 'tenant-7',
    head: async (key) => {
      alreadyScoped.push(key);
      return true;
    },
  });
  await scopedAgain({
    name: 'render',
    credits: 4,
    artefact: 'tenant-7/a/final.mp4',
    async run() {},
  });
  check(
    'an already prefixed key is not prefixed twice',
    alreadyScoped[0] === 'tenant-7/a/final.mp4',
    String(alreadyScoped[0]),
  );
}

console.log('\npipeline: a real 3-step video job, resumed after a death');
{
  const events = bufferedLogger();
  const observed = { kills: 0, pauses: 0, connects: 0, creates: 0, execs: [], failClips: true, connectFails: 0 };
  const runRows = new Map();
  const charges = new Map();
  const money = { holds: [], refunds: [], settled: null, duplicates: 0 };

  const makeHandle = (id) => ({
    id,
    sandboxId: id,
    async exec(command, opts) {
      observed.execs.push(command);
      if (observed.failClips && /color=c=black/.test(command)) {
        throw new Error('sandbox connection reset at 40%');
      }
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
    async writeFile() {},
    async pause() {
      observed.pauses += 1;
    },
    async kill() {
      observed.kills += 1;
    },
  });

  const sandboxes = {
    async create() {
      observed.creates += 1;
      return makeHandle(`sbx-${observed.creates}`);
    },
    async connect(id) {
      observed.connects += 1;
      if (observed.connectFails > 0) {
        observed.connectFails -= 1;
        throw new Error('sandbox sbx-1 is gone');
      }
      return makeHandle(id);
    },
  };

  const store = {
    async load(runId) {
      const row = runRows.get(runId);
      return row ? JSON.parse(JSON.stringify(row)) : null;
    },
    async save(runId, checkpoint) {
      runRows.set(runId, JSON.parse(JSON.stringify(checkpoint)));
    },
    async setStatus(runId, status) {
      runRows.set(runId, { ...(runRows.get(runId) ?? {}), status });
    },
  };

  const credits = {
    async hold(runId, amount) {
      money.holds.push({ runId, amount });
    },
    async charge(runId, step, amount) {
      const key = `${runId}:${step}`;
      if (charges.has(key)) {
        money.duplicates += 1;
        return;
      }
      charges.set(key, amount);
    },
    async refund(runId, amount, reason) {
      money.refunds.push({ runId, amount, reason });
    },
    async settle(runId, reason) {
      money.settled = { runId, reason };
    },
  };

  const specs = videoPipelineSteps(DEFAULT_VIDEO_JOB);
  check(
    'the job assembles three steps in order',
    specs.map((spec) => spec.name).join(',') === 'voiceover,clips,render',
    specs.map((spec) => spec.name).join(','),
  );
  check(
    'each step is priced from the model registry, not invented',
    specs[0].credits === MEDIA_MODELS.voice.credits &&
      specs[1].credits === videoCredits(DEFAULT_VIDEO_JOB.clipSeconds) &&
      specs[2].credits > 0,
    specs.map((spec) => spec.credits).join(','),
  );
  check(
    'each step declares the R2 key that proves it already happened',
    specs.every((spec) => spec.artefact.startsWith('agent_render/demo/')),
    specs.map((spec) => spec.artefact).join(','),
  );
  check(
    'the run reserves exactly the sum of the three steps',
    specs.reduce((sum, spec) => sum + spec.credits, 0) ===
      MEDIA_MODELS.voice.credits + videoCredits(DEFAULT_VIDEO_JOB.clipSeconds) + specs[2].credits,
  );

  let firstRunError = null;
  try {
    await runVideoPipeline({
      runId: 'run-pipe',
      userId: 'user-1',
      sandboxes,
      store,
      credits,
      artefactExists: async () => false,
      log: events,
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })(),
      idlePauseMs: 0,
      maxAttemptsPerStep: 2,
    });
  } catch (error) {
    firstRunError = error;
  }

  check('a step that keeps dying fails the run', firstRunError !== null, String(firstRunError));
  check(
    'the death is on step 2, so only step 1 was charged',
    charges.size === 1 && charges.has('run-pipe:voiceover'),
    JSON.stringify([...charges.keys()]),
  );
  check(
    'the unspent reserve is refunded, not silently kept',
    money.refunds.length === 1 &&
      money.refunds[0].amount ===
        specs.reduce((sum, spec) => sum + spec.credits, 0) - MEDIA_MODELS.voice.credits,
    JSON.stringify(money.refunds),
  );
  check('the sandbox was paused, never killed', observed.kills === 0 && observed.pauses > 0, JSON.stringify(observed));

  observed.failClips = false;
  observed.connectFails = 1;

  const resumed = await runVideoPipeline({
    runId: 'run-pipe',
    userId: 'user-1',
    sandboxes,
    store,
    credits,
    artefactExists: async () => false,
    log: events,
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    idlePauseMs: 0,
    maxAttemptsPerStep: 2,
  });

  check('the resumed run picks up from the checkpoint', resumed.resumedFrom === 1, String(resumed.resumedFrom));
  check('it completes all three steps', resumed.completed.length === 3, JSON.stringify(resumed.completed));
  check(
    'a lost sandbox is recreated, not fatal',
    observed.connectFails === 0 && observed.creates >= 2,
    JSON.stringify(observed),
  );
  check(
    'no step is charged twice across both runs',
    charges.size === 3 &&
      [...charges.values()].reduce((sum, value) => sum + value, 0) ===
        specs.reduce((sum, spec) => sum + spec.credits, 0) &&
      money.duplicates === 0,
    JSON.stringify({ charges: [...charges.entries()], duplicates: money.duplicates }),
  );
  check(
    'the leftover reservation of the finished run is settled',
    money.settled !== null && money.settled.runId === 'run-pipe',
    JSON.stringify(money.settled),
  );
  check(
    'the run row ends as completed',
    runRows.get('run-pipe')?.status === 'completed',
    String(runRows.get('run-pipe')?.status),
  );

  const third = await runVideoPipeline({
    runId: 'run-pipe',
    userId: 'user-1',
    sandboxes,
    store,
    credits,
    artefactExists: async () => false,
    log: events,
    idlePauseMs: 0,
  });
  check(
    're-running a finished run charges nothing at all',
    third.skipped.length === 3 && charges.size === 3,
    JSON.stringify({ skipped: third.skipped, charges: [...charges.keys()] }),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('failures:', failures.join(', '));
  process.exit(1);
}
