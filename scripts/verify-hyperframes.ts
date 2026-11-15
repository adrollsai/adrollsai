/**
 * Proves a hand-written composition becomes renderable, and that render failures are legible.
 *
 * The live failure this pins, twice over:
 *   1. HyperFrames needs data-composition-id and data-duration on the root element. An agent
 *      writing HTML from scratch omits them, and the render dies after 14 seconds with
 *      "Composition has zero duration". That is why designed video "did not work" while ffmpeg
 *      did — the model was routing around a broken contract it could not see.
 *   2. The tool reported only "exit status 1", so the model could not tell a disk problem from a
 *      markup problem and burned minutes probing the filesystem.
 *
 *   npm run verify:hyperframes
 */
import {
  normaliseCompositionHtml,
  renderLogTail,
} from '../lib/agent/tools/hyperframes-render';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

head('1. The composition contract is repaired, not assumed');

const bare = `<!doctype html><html><head><style>b{}</style></head><body><div id="stage"><h1>HELLO</h1></div></body></html>`;
const fixed = normaliseCompositionHtml(bare, { durationSeconds: 8, compositionId: 'launch_reel' });

check(
  'a composition with neither attribute gains both',
  /data-composition-id="launch_reel"/.test(fixed) && /data-duration="8"/.test(fixed),
  'the exact two attributes the renderer demands',
);
check(
  'the attributes land on the root div carrying the id',
  /<div id="stage" data-composition-id="launch_reel" data-duration="8">/.test(fixed),
  'root div, not body',
);
check(
  'the rest of the markup is untouched',
  fixed.includes('<h1>HELLO</h1>') && fixed.startsWith('<!doctype html>') && /<style>b\{\}<\/style>/.test(fixed),
  'author content preserved',
);

const already = `<div data-composition-id="mine" data-duration="12">x</div>`;
check(
  'a correct composition is returned byte-identical',
  normaliseCompositionHtml(already, { durationSeconds: 30 }) === already,
  'no interference',
);

const withDurOnly = `<div id="a" data-dur="6">x</div>`;
const durFixed = normaliseCompositionHtml(withDurOnly, { durationSeconds: 6, compositionId: 'c' });
check(
  'data-dur alone is not enough — data-duration is added',
  /data-duration="6"/.test(durFixed) && /data-dur="6"/.test(durFixed),
  'both present, nothing removed',
);

const noDiv = `<h1>only text</h1>`;
const wrapped = normaliseCompositionHtml(noDiv, { durationSeconds: 4, compositionId: 'w' });
check(
  'markup with no div still gets a valid root',
  /data-composition-id="w"/.test(wrapped) && /data-duration="4"/.test(wrapped) && wrapped.includes('<h1>only text</h1>'),
  'wrapped, content kept',
);

check(
  'a nonsense duration falls back to the default instead of producing NaN',
  /data-duration="15"/.test(normaliseCompositionHtml(bare, { durationSeconds: 0 })) &&
    /data-duration="15"/.test(normaliseCompositionHtml(bare, { durationSeconds: NaN })) &&
    /data-duration="15"/.test(normaliseCompositionHtml(bare, { durationSeconds: -5 })),
  'never zero, never NaN, never negative',
);
check(
  'an unsafe composition id is sanitised',
  /data-composition-id="a_b_c"/.test(normaliseCompositionHtml(bare, { durationSeconds: 5, compositionId: 'a b/c' })),
  'no attribute injection',
);
check(
  'empty input stays empty rather than inventing a document',
  normaliseCompositionHtml('', { durationSeconds: 5 }) === '',
  'no phantom composition',
);

head('2. A render failure is legible to the model');

const log = [
  'render-plan: mem=1982MB cpu=2 frames=120 fps=authored quality=draft workers=1 capture=screenshot',
  '',
  '◆  Rendering hf_manual → /home/user/hf_manual/out.mp4',
  '  Lint: 3 error(s), 0 warning(s)',
  '  \u001b[33m█░░░░░░░░░░░  5%  Failed: [FrameCapture] Composition has zero duration.',
  '  → Fix: add data-duration="<seconds>" to your root <div data-composition-id="..."> element.',
  '@hf-diagnostic {"version":1,"code":"COMPOSITION_ZERO_DURATION"}',
  'render-exit: 1',
].join('\n');
const tail = renderLogTail(log, '');

check('the log tail names the real problem', /Composition has zero duration/.test(tail), 'diagnosis surfaced');
check('it keeps the fix line', /add data-duration/.test(tail), 'actionable');
check('it strips ANSI colour codes', !/\u001b\[/.test(tail), 'clean text for a model');
check('it drops the progress bar noise', !/█░/.test(tail), 'no spinner chatter');
check('it drops machine JSON lines', !/@hf-/.test(tail), 'no protocol frames');
check(
  'it survives an empty log',
  renderLogTail(undefined, undefined) === '',
  'no crash, no invented text',
);
check('it is bounded', renderLogTail(log.repeat(50), '').length <= 1200, 'fits an error message');

head('3. The tool is wired to both');

const toolsSource = readFileSync(join(process.cwd(), 'lib/agent/tools/sandbox_tools.ts'), 'utf8');
check(
  'the render tool normalises before writing the composition',
  /normaliseCompositionHtml\(rawHtml, \{ durationSeconds: dur, compositionId: safeName \}\)/.test(toolsSource),
  'repair happens on the way in',
);
check(
  'and reports the render log when it fails',
  /renderLogTail\(res\.stdout, res\.stderr\)/.test(toolsSource),
  'no more bare "exit status 1"',
);

const scriptSource = readFileSync(join(process.cwd(), 'lib/agent/tools/hyperframes-render.ts'), 'utf8');
check(
  'the render script enlarges /tmp before rendering',
  /mount --bind \/home\/user\/hf-tmp \/tmp/.test(scriptSource),
  'the 992MB tmpfs was the other blocker',
);
check(
  'and restores the sticky bit that package installs depend on',
  /chmod 1777 \/tmp/.test(scriptSource),
  'apt keeps working',
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
