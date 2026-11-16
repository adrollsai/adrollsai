/**
 * Does a composition that renders NOTHING stop quickly, or does it melt the sandbox?
 *
 * Measured live this session: a Procolor video run built a composition holding a `<video>` element,
 * and every slice reported `0/1 spans`. The resume loop only ever stopped on the request budget or
 * after FORTY slices, so a render that could never succeed was allowed to spend up to 40 x 210s —
 * over two hours — of sandbox time, and then reported no cause at all. That is the same customer
 * experience as the "15-30 hours" complaint in the brief, and it happened in a test run.
 *
 * The decision is now `decideRenderSlice()`, a pure function, so every case is checked here without
 * a sandbox. The wiring is asserted in source, because a guard nobody calls is a comment.
 *
 *   npx esbuild scripts/verify-render-stalls.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-render-stalls.mjs && node .tmp-render-stalls.mjs
 */
import fs from 'node:fs';
import { decideRenderSlice, MAX_STALLED_SLICES, MAX_SLICE_SECONDS } from '../lib/agent/tools/hyperframes-render';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const decide = (over: Partial<Parameters<typeof decideRenderSlice>[0]> = {}) =>
  decideRenderSlice({
    previousSpansDone: 0,
    spansDone: 0,
    spansTotal: 1,
    stalledSlices: 0,
    hasVideo: false,
    ...over,
  });

console.log('▸ a finished film always wins');
check('a produced MP4 stops the loop as done', decide({ hasVideo: true, spansDone: 0 }).action === 'stop-done');
check(
  'and it clears the stall count',
  decide({ hasVideo: true, stalledSlices: 2 }).stalledSlices === 0,
  'a success must not leave the loop primed to abort',
);

console.log('\n▸ progress resets the countdown');
const progressed = decide({ previousSpansDone: 1, spansDone: 2, spansTotal: 5, stalledSlices: 2 });
check('a slice that finished a span continues', progressed.action === 'continue', progressed.action);
check('and resets the stall count to zero', progressed.stalledSlices === 0, String(progressed.stalledSlices));
check('it is reported as progress', progressed.progressed === true);

console.log('\n▸ zero progress counts, and eventually stops');
const stall1 = decide({ stalledSlices: 0 });
check('the first empty slice counts one stall', stall1.stalledSlices === 1, String(stall1.stalledSlices));
check('but it continues, in case the span was merely slow', stall1.action === 'continue', stall1.action);
const stall2 = decide({ stalledSlices: 1 });
check('the second empty slice continues', stall2.action === 'continue', String(stall2.stalledSlices));
const stall3 = decide({ stalledSlices: 2 });
check(
  `the ${MAX_STALLED_SLICES}rd empty slice stops the loop`,
  stall3.action === 'stop-stalled',
  `${stall3.stalledSlices} stalls`,
);

console.log('\n▸ the bound is far below the old behaviour');
const worstCaseSeconds = MAX_STALLED_SLICES * MAX_SLICE_SECONDS;
check(
  'a hopeless render is bounded to minutes, not hours',
  worstCaseSeconds <= 15 * 60,
  `${worstCaseSeconds}s worst case (was up to ${40 * MAX_SLICE_SECONDS}s over 40 slices)`,
);
check('the stall cap is a small number, not 40', MAX_STALLED_SLICES <= 5, String(MAX_STALLED_SLICES));

console.log('\n▸ all spans done is not a stall');
const allDone = decide({ previousSpansDone: 3, spansDone: 4, spansTotal: 4, stalledSlices: 2 });
check(
  'a slice that finishes the last span continues (to stitching) instead of aborting',
  allDone.action === 'continue',
  allDone.action,
);

console.log('\n▸ the loop actually uses it');
const tools = fs.readFileSync('lib/agent/tools/sandbox_tools.ts', 'utf8');
check('the resume loop calls decideRenderSlice', /decideRenderSlice\(/.test(tools));
check(
  'a stalled render is reported as broken rather than as out of time',
  /not slow, it is/.test(tools) && /never finish/.test(tools),
  'the agent is told which it was',
);
check(
  'the error names the three things that actually break a composition',
  /data-composition-id/.test(tools) && /__timelines/.test(tools) && /<video>|<audio>/.test(tools),
  'so the next attempt can fix it',
);
check(
  'the previous behaviour — only the budget or 40 slices could stop it — is gone',
  !/for \(let slice = 0; slice < 40; slice\+\+\)/.test(tools) || /stop-stalled/.test(tools),
  'the 40-slice ceiling is no longer the only brake',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
