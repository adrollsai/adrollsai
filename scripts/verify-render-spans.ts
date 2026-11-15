/**
 * Long films: spans instead of one long command, and no arbitrary ceilings.
 *
 * The old shape capped a render at 300s and a composition at 60s, so "make me a 3 minute film"
 * could not work no matter how good the model was. Length must be limited by the pipeline, not by
 * a number someone typed. This gate pins the planning maths, the resumability contract and the
 * absence of the old caps.
 *
 *   npm run verify:render-spans
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bitrateForSize,
  buildHyperFramesRenderScript,
  planRenderSpans,
  renderSliceBudgetSeconds,
} from '../lib/agent/tools/hyperframes-render';

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
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

head('1. Any length is planned into renderable spans');

const short = planRenderSpans({ durationSeconds: 8 });
check('a short film is one span', short.length === 1 && short[0].start === 0 && short[0].end === 8, `${short.length} span`);

const minute = planRenderSpans({ durationSeconds: 60, chunkSeconds: 20 });
check('a one-minute film is three spans', minute.length === 3, minute.map((s) => `${s.start}-${s.end}`).join(', '));

const hour = planRenderSpans({ durationSeconds: 3600, chunkSeconds: 20 });
check(
  'a one-HOUR film plans 180 spans with no ceiling',
  hour.length === 180 && hour[hour.length - 1].end === 3600,
  `${hour.length} spans, last ends at ${hour[hour.length - 1].end}`,
);
check(
  'the spans tile the film with no gaps and no overlap',
  hour.every((s, i) => (i === 0 ? s.start === 0 : s.start === hour[i - 1].end)),
  'contiguous',
);
check(
  'an explicit span request stays a single span',
  planRenderSpans({ durationSeconds: 60, startSeconds: 20, endSeconds: 40 }).length === 1,
  'iterating on one section',
);
check(
  'a nonsense duration still plans something renderable',
  planRenderSpans({ durationSeconds: 0 }).length === 1 && planRenderSpans({ durationSeconds: NaN }).length === 1,
  'never empty',
);
check(
  'chunk size is clamped to a sane range',
  planRenderSpans({ durationSeconds: 100, chunkSeconds: 1 })[0].end === 2 &&
    planRenderSpans({ durationSeconds: 500, chunkSeconds: 900 }).length === 5,
  'min 2s, max 120s',
);

head('2. The slice budget follows the request, not a constant');

check(
  'a nearly-exhausted request gets no render budget',
  renderSliceBudgetSeconds(10_000) === 0,
  'it stops instead of being killed mid-frame',
);
check(
  'a full request gets most of its time',
  renderSliceBudgetSeconds(1_700_000) > 1600,
  `${renderSliceBudgetSeconds(1_700_000)}s`,
);
check(
  'headroom is left to upload and return',
  renderSliceBudgetSeconds(600_000 as number) <= 575,
  '25s held back',
);
check(
  'an unbounded budget (self-hosted) still yields a workable slice',
  renderSliceBudgetSeconds(Infinity) === 600,
  '600s slice when the turn is unlimited',
);

head('3. The script renders spans, resumes, and stitches');

const script = buildHyperFramesRenderScript({ projectDir: 'p', durationSeconds: 60, chunkSeconds: 20, budgetSeconds: 300 });
check('it renders in parts, not one process', /parts\/part_/.test(script), 'span files');
check('a finished span is skipped on the next call', /if \[ -f "\$out" \]; then echo "HF-PART: \$idx cached"/.test(script), 'resumable');
check('it stops starting spans when the slice is spent', /HF-BUDGET: out of slice time/.test(script), 'graceful stop');
check('it reports progress the caller can parse', /HF-PARTS: \$\{HAVE\}\/\$\{TOTAL_CHUNKS\}/.test(script), 'HF-PARTS: n/m');
check('it stitches with a stream copy first', /-f concat -safe 0 -i parts\/list.txt -c copy out\.mp4/.test(script), 'fast');
check(
  'and re-encodes if the spans disagree on parameters',
  /HF-STITCH-RETRY: re-encoding/.test(script) && /libx264/.test(script),
  'no losing a finished film',
);
check('an incomplete film does not pretend to be finished', /HF-STITCHED: no \(film incomplete/.test(script), 'honest');
check('a budget of 0 means no slice limit', /BUDGET_SECONDS:-0/.test(script), 'self-hosted can run long');
check('the plan is echoed for diagnosis', /HF-SPANS: /.test(script), 'which spans this slice planned');

head('4. No arbitrary ceilings remain');

const tools = readFileSync(join(process.cwd(), 'lib/agent/tools/sandbox_tools.ts'), 'utf8');
check('the 300s render timeout is gone', !/timeoutMs: 300_000/.test(tools), 'derived from the slice');
check('the 60s composition cap is gone', !/5\), 60\)/.test(tools), 'up to an hour');
check('a one-hour film is allowed by the schema', /3600/.test(tools) && /up to 3600/.test(tools), '3600s');
check(
  'the shell tool no longer advertises a 300s ceiling',
  !/up to 300s/.test(tools) && !/timeoutSeconds \|\| 120, 10\), 300\)/.test(tools),
  'the runner clamps, not the schema',
);
check(
  'an unfinished film returns a resumable result, not an error',
  /partial: true/.test(tools) && /resumes at the next span/.test(tools),
  'the agent continues instead of restarting',
);

head('5. Nothing gives up while there is work left to do');

const toolsSrc = readFileSync(join(process.cwd(), 'lib/agent/tools/sandbox_tools.ts'), 'utf8');
check(
  'the tool loops inside one call instead of returning after a single slice',
  /for \(let slice = 0; slice < 40; slice\+\+\)/.test(toolsSrc),
  'progress does not depend on the model remembering',
);
check(
  'it stops only when the request is genuinely spent',
  /budgetSeconds < 45\) break/.test(toolsSrc),
  '45s floor to record the result',
);
check(
  'a resumed slice reuses the composition already on disk',
  /files: slice === 0 \? files : \[\]/.test(toolsSrc),
  'no rewrite, no lost work',
);
check(
  'an unfinished film explicitly forbids restarting',
  /Never tell the user this failed, and never start over/.test(toolsSrc),
  'the model is told what to do',
);

const turnLimits = readFileSync(join(process.cwd(), 'lib/agent/turn-limits.ts'), 'utf8');
check(
  'continuation is no longer capped at six slices',
  /AGENT_MAX_CONTINUATIONS \|\| ''\)\.replace\(\/\^\["'\］\|\["'\]\$\/g, ''\)\.trim\(\) \|\| 40/.test(turnLimits) ||
    /\|\| 40\s*\n?\);/.test(turnLimits),
  '40 chained slices by default',
);

const orchestrator = readFileSync(join(process.cwd(), 'lib/agent/orchestrator.ts'), 'utf8');
check(
  'the prompt tells the agent long renders are normal',
  /LONG FILMS ARE EXPECTED/.test(orchestrator) && /Never report a film as failed because it is taking a while/.test(orchestrator),
  'no giving up',
);

head('6. Long pieces are rendered as a loop, not frame by frame');

const looped = buildHyperFramesRenderScript({
  projectDir: 'p',
  durationSeconds: 3600,
  loopSeconds: 20,
  chunkSeconds: 20,
  budgetSeconds: 300,
});
check(
  'a one-hour film asks for ONE 20s span when it is a loop',
  /HF-SPANS: 0:0-20/.test(looped) && !/1:20-40/.test(looped),
  '20s of rendering, not 108,000 frames',
);
check('it repeats the result with a stream copy', /-stream_loop -1 -i out\.mp4 -t 3600 -c copy/.test(looped), 'seconds, not hours');
check('the loop outcome is logged honestly', /HF-LOOPING: 3600s total/.test(looped) && /HF-LOOPED: /.test(looped), 'visible either way');
check(
  'a non-looping film is untouched',
  /if \[ "0" -gt 0 \]; then\n\s+echo "HF-LOOPING/.test(
    buildHyperFramesRenderScript({ projectDir: 'p', durationSeconds: 45, chunkSeconds: 20 }),
  ),
  'the loop branch is never entered',
);
check(
  'a loop longer than the film is ignored',
  /if \[ "0" -gt 0 \]/.test(
    buildHyperFramesRenderScript({ projectDir: 'p', durationSeconds: 10, loopSeconds: 30 }),
  ),
  'loopSeconds must be shorter to mean anything',
);
check(
  'the prompt tells the agent when to use it',
  /loopSeconds/.test(orchestrator) && /RENDER TIME IS FRAMES/.test(orchestrator),
  'the model knows the cost',
);

head('7. The delivered file fits what people can actually send');

check(
  'a capped film computes a bitrate for the target size',
  bitrateForSize(24, 600) > 200 && bitrateForSize(24, 600) < 400,
  `24MB over 600s = ${bitrateForSize(24, 600)}k`,
);
check(
  'a tiny target for a long film shrinks the frame instead of pretending',
  /HF-CAP-SCALE/.test(buildHyperFramesRenderScript({ projectDir: 'p', durationSeconds: 600, maxSizeMB: 1 })),
  'resolution is the variable, not honesty',
);
check(
  'the delivered size is always logged',
  /HF-FINAL-SIZE/.test(buildHyperFramesRenderScript({ projectDir: 'p', durationSeconds: 30 })),
  'the agent can tell the user what they got',
);
check(
  'missing the target is reported as partial, not as success',
  /HF-CAPPED: partial/.test(buildHyperFramesRenderScript({ projectDir: 'p', durationSeconds: 600, maxSizeMB: 1 })),
  'no silent oversize',
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
