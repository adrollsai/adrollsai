/**
 * Unit checks for the auto-continue decision and the turn-stop tracker.
 * These rules decide whether a task gets picked back up or dropped, so getting
 * them wrong is expensive in both directions.
 *
 *   npm run verify:continue
 */
import { shouldContinueAfterTurn, createTurnStopTracker, turnStopConditions } from '../lib/agent/turn-limits';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const toolStep = { toolCalls: [{ toolName: 'sandbox_bash_run' }], content: [{ type: 'tool-call' }] };
const textStep = { toolCalls: [], content: [{ type: 'text' }] };
const longAnswer = 'x'.repeat(200);

// --- shouldContinueAfterTurn -------------------------------------------------
check(
  'budget stop + wanted tools -> continue',
  shouldContinueAfterTurn({ stopReason: 'time', steps: [toolStep], finalText: '' }) === true
);
check(
  'budget stop + no answer -> continue',
  shouldContinueAfterTurn({ stopReason: 'time', steps: [textStep], finalText: '' }) === true
);
check(
  'step cap + work left -> continue',
  shouldContinueAfterTurn({ stopReason: 'steps', steps: [toolStep], finalText: '' }) === true
);
check(
  'budget stop BUT delivered a real answer -> do NOT continue',
  shouldContinueAfterTurn({ stopReason: 'time', steps: [textStep], finalText: longAnswer }) === false
);
check(
  'natural finish -> do NOT continue',
  shouldContinueAfterTurn({ stopReason: null, finishReason: 'stop', steps: [textStep], finalText: longAnswer }) === false
);
check(
  'provider said tool-calls (legacy signal) -> continue',
  shouldContinueAfterTurn({ stopReason: null, finishReason: 'tool-calls', steps: [toolStep], finalText: '' }) === true
);
check(
  'no steps at all + natural finish -> do NOT continue',
  shouldContinueAfterTurn({ stopReason: null, finishReason: 'stop', steps: [], finalText: '' }) === false
);

// --- tracker records WHY it stopped -----------------------------------------
(async () => {
  const tracker = createTurnStopTracker();
  check('tracker starts null', tracker.reason === null);

  // Simulate the time budget: a condition built with a start time in the past.
  const past = Date.now() - 10 * 60 * 1000;
  const conditions: any[] = turnStopConditions(past, 'verify', tracker);
  let stopped = false;
  for (const c of conditions) {
    if (c({ steps: [toolStep, toolStep] })) {
      stopped = true;
      break;
    }
  }
  check('time condition fires when past budget', stopped);
  check('tracker records reason=time', tracker.reason === 'time', `reason=${tracker.reason} steps=${tracker.steps}`);

  // A fresh tracker with a start time of "now" must not fire.
  const t2 = createTurnStopTracker();
  const fresh: any[] = turnStopConditions(Date.now(), 'verify-fresh', t2);
  const fired = fresh.some((c) => c({ steps: [toolStep] }));
  check('fresh turn does not fire the time budget', fired === false, `reason=${t2.reason}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})();
