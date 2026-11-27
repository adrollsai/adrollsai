/**
 * NO CONDITIONAL HOOKS IN THE SCREENS PEOPLE USE.
 *
 * On 27 Nov the agent page died for a live tenant with "Application error: a client-side exception has
 * occurred", then "Display Interruption Prevented — Minified React error #300" (rendered more hooks than
 * during the previous render). The cause was one line:
 *
 *   if (!items.length) return null;      // HarnessTranscript, above its own hooks
 *   ...
 *   const [approvalState] = useState(...)
 *   useEffect(...)                        // <- never runs on the empty first paint
 *
 * The first paint of a session has an empty transcript for a frame, so the component ran FEWER hooks than
 * the render that followed. React refuses to continue and the whole route unmounts. That is a one-line
 * mistake with a total outage as its blast radius, and it is invisible to tsc and to every behavioural
 * gate in this repo — so it gets its own check, using React's own linter rather than a regex.
 *
 * This runs `eslint` with `react-hooks/rules-of-hooks` forced to error over the interactive surfaces and
 * fails on any hit. It deliberately ignores the other react-hooks rules (refs during render,
 * set-state-in-effect): they are real style findings, but they do not crash a page, and mixing them in
 * would make this gate noisy enough to be switched off.
 *
 *   npm run verify:agent-hooks
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TARGETS = ['components/agent', 'components/crm', 'app/dashboard/agent', 'app/dashboard/crm', 'hooks'];

let raw = '[]';
try {
  raw = execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['eslint', ...TARGETS, '--format', 'json', '--no-warn-ignored', '--rule', '{"react-hooks/rules-of-hooks":"error"}'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch (error) {
  // eslint exits non-zero for ANY finding; the JSON on stdout is what matters.
  raw = error?.stdout || '[]';
}

let results = [];
try {
  results = JSON.parse(raw);
} catch {
  console.log('FAIL  eslint did not return readable JSON — the hook check could not run');
  process.exit(1);
}

const violations = [];
for (const file of results) {
  for (const message of file.messages || []) {
    if (message.ruleId === 'react-hooks/rules-of-hooks') {
      violations.push({
        file: path.relative(process.cwd(), file.filePath).split(path.sep).join('/'),
        line: message.line,
        text: message.message.split('\n')[0],
      });
    }
  }
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

console.log('── 1. React\u2019s own rules-of-hooks over the interactive surfaces');
console.log(`       ${TARGETS.join(', ')}`);

check(
  'no component calls a hook conditionally',
  violations.length === 0,
  violations.length === 0
    ? 'eslint reports none'
    : violations.map((v) => `${v.file}:${v.line} ${v.text}`).join(' | '),
);

console.log('\n── 2. The transcript keeps every hook above its empty return');

{
  /**
   * The specific shape that broke: a bail-out return placed above a hook. eslint proves it, and this pins
   * the file so a future refactor cannot quietly reintroduce the same ordering.
   */
  const source = fs.readFileSync(path.join(process.cwd(), 'components/agent/HarnessTranscript.tsx'), 'utf8');
  const lines = source.split('\n');
  const componentStart = lines.findIndex((line) => line.includes('export default function HarnessTranscript'));
  const emptyReturn = lines.findIndex((line, index) => index > componentStart && /if \(!deduped\.length\) return null;/.test(line));
  const lastHook = lines.reduce(
    (last, line, index) => (index > componentStart && /React\.(useState|useEffect|useRef|useMemo|useCallback|useLayoutEffect)\s*[<(]/.test(line) ? index : last),
    -1,
  );

  check('the component has an empty-state return', emptyReturn > componentStart, `line ${emptyReturn + 1}`);
  check('and no hook is declared after it', lastHook < emptyReturn, `last hook line ${lastHook + 1}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
