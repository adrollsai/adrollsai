/**
 * Does the agent UI survive being switched to dark mode?
 *
 * WHY THIS EXISTS
 * Dark mode was broken in a way no amount of staring at one screen would have proven:
 * `lib/ui/agent-skin.css` defined its entire palette under `.dsh[data-theme='light']` and
 * wrote the component rules under that same selector too. So in dark mode the skin was not
 * "slightly wrong" — it was not applied at all. `--nobo-card` was undefined, the two rules
 * that used a literal `#ffffff` stayed white, and every structural rule (tap feedback, focus
 * ring, 44px targets, the sticky composer) silently stopped existing. On top of that,
 * `CeoFindingsCard` was built from Tailwind `dark:` pairs, which key off the OS colour scheme
 * and not off `data-theme`, so they always resolved to their light branch.
 *
 * That is a class of bug, not an incident: the theme is a second axis nobody was testing, so
 * every new rule could silently pick the wrong one and nothing would say so. These checks
 * make the class impossible to reintroduce quietly:
 *
 *   1. BOTH PALETTES EXIST, and declare the same token names. A token defined in only one
 *      theme is undefined in the other — the exact root cause here.
 *   2. NO COMPONENT RULE IS THEME-SCOPED. Only a palette block (or the canvas-tint block,
 *      which is one gradient) may be written under `data-theme='light'`/`'dark'`. Rules read
 *      tokens; they never pick a theme.
 *   3. NO LITERAL SURFACES. Outside the palette blocks nothing may set a background or a
 *      border to a raw colour, because a raw colour is right in one theme and wrong in the
 *      other. Gradient fills and text-on-fill are allowed: those are deliberately identical.
 *   4. NO TAILWIND `dark:` IN components/agent. It cannot see `data-theme`, so it is always
 *      a bug — the light branch is what renders.
 *   5. NO INLINE HEX SURFACES in components/agent. Same reason as 3, one level up.
 *
 * Static and deterministic: it reads files, spends no tokens and needs no browser.
 *
 *   npm run verify:agent-theme
 */
import fs from 'node:fs';
import path from 'node:path';

const CSS = 'lib/ui/agent-skin.css';
const AGENT_DIR = 'components/agent';

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
  }
}

// ── read ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(CSS)) {
  console.error(`Cannot find ${CSS}. Run this from the repo root.`);
  process.exit(1);
}
const css = fs.readFileSync(CSS, 'utf8');
const lines = css.split(/\r?\n/);

/**
 * The same lines with `/* … *\/` comments blanked out, keeping the line count so a hit can
 * still be reported by its real line number. Without this the checks below match their own
 * explanation — the header comment names `data-theme='light'` while describing the bug.
 */
const code = (() => {
  let inComment = false;
  return lines.map((line) => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const close = line.indexOf('*/', i);
        if (close === -1) { i = line.length; break; }
        inComment = false;
        i = close + 2;
        continue;
      }
      const open = line.indexOf('/*', i);
      if (open === -1) { out += line.slice(i); break; }
      out += line.slice(i, open);
      inComment = true;
      i = open + 2;
    }
    return out;
  });
})();

/** Text of the block whose selector line matches, by brace depth. */
function blockFor(selector, from = 0) {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() !== selector) continue;
    let depth = 0;
    const body = [];
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
      if (j > i || lines[j].includes('{')) body.push(lines[j]);
      if (depth === 0) return { start: i, end: j, text: body.join('\n') };
    }
  }
  return null;
}

const light = blockFor(".dsh[data-theme='light'] {");
const dark = blockFor(".dsh[data-theme='dark'] {");

// ── 1. both palettes, same token names ───────────────────────────────────────

check('agent-skin.css declares a light palette', Boolean(light));
check('agent-skin.css declares a dark palette', Boolean(dark));

const tokenNames = (block) =>
  new Set(
    (block?.text ?? '')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(--[a-z0-9-]+)\s*:/i)?.[1])
      .filter(Boolean)
  );

const lightTokens = tokenNames(light);
const darkTokens = tokenNames(dark);

check(
  'the light palette is substantial (not an empty stub)',
  lightTokens.size >= 35,
  `found ${lightTokens.size} tokens`
);

const onlyLight = [...lightTokens].filter((t) => !darkTokens.has(t));
const onlyDark = [...darkTokens].filter((t) => !lightTokens.has(t));

check(
  'every token defined for light is also defined for dark',
  onlyLight.length === 0,
  onlyLight.length ? `missing from dark: ${onlyLight.join(', ')}` : ''
);
check(
  'every token defined for dark is also defined for light',
  onlyDark.length === 0,
  onlyDark.length ? `missing from light: ${onlyDark.join(', ')}` : ''
);

// ── 2. no component rule is theme-scoped ────────────────────────────────────

const paletteRanges = [light, dark].filter(Boolean).map((b) => [b.start, b.end]);
const inPalette = (i) => paletteRanges.some(([s, e]) => i >= s && i <= e);

/**
 * A theme selector is legitimate only as a palette block or the canvas-tint block, so the
 * line has to end in `{` or be one of the `> div,` pair. A theme selector followed by a
 * descendant is a rule that will be dead in the other theme.
 */
const themeScopedRules = [];
code.forEach((line, i) => {
  if (inPalette(i)) return;
  if (!/data-theme\s*=\s*['"]?(light|dark)/.test(line)) return;
  const trimmed = line.trim();
  const isPaletteOrTint = trimmed.endsWith('{') || trimmed.endsWith(',');
  if (!isPaletteOrTint) themeScopedRules.push(`${i + 1}: ${trimmed}`);
});

check(
  'no component rule is scoped to a single theme',
  themeScopedRules.length === 0,
  themeScopedRules.length
    ? `${themeScopedRules.length} theme-locked rule(s):\n         ${themeScopedRules.slice(0, 8).join('\n         ')}`
    : ''
);

// The behaviours that used to be light-only, asserted by name so they cannot quietly go
// back to being one-theme.
for (const selector of [
  '.dsh[data-theme] button',
  '.dsh[data-theme] .nobo-bubble-agent',
  '.dsh[data-theme] .nobo-dock',
  '.dsh[data-theme] .nobo-agent-card',
]) {
  check(`"${selector}" is scoped to both themes`, css.includes(selector));
}

// ── 3. no literal surfaces outside the palettes ─────────────────────────────

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
const SURFACE = /^\s*(background|background-color|border|border-color|border-top-color|border-bottom-color)\s*:/i;
const literalSurfaces = [];
code.forEach((line, i) => {
  if (inPalette(i)) return;
  if (!SURFACE.test(line)) return;
  if (!LITERAL.test(line)) return;
  literalSurfaces.push(`${i + 1}: ${line.trim()}`);
});

check(
  'no rule outside the palettes sets a surface to a raw colour',
  literalSurfaces.length === 0,
  literalSurfaces.length
    ? `${literalSurfaces.length} literal surface(s) — tokenise them:\n         ${literalSurfaces.slice(0, 8).join('\n         ')}`
    : ''
);

// ── 4/5. the components ─────────────────────────────────────────────────────

const agentFiles = fs.existsSync(AGENT_DIR)
  ? fs.readdirSync(AGENT_DIR).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  : [];
check('found the agent components', agentFiles.length >= 10, `${agentFiles.length} file(s)`);

const tailwindDark = [];
const inlineHexSurfaces = [];
for (const file of agentFiles) {
  const full = path.join(AGENT_DIR, file);
  const source = fs.readFileSync(full, 'utf8');
  source.split(/\r?\n/).forEach((line, i) => {
    // A `dark:` variant only bites inside a className, so comment mentions are harmless.
    if (line.includes('className') && /\bdark:[a-z]/.test(line)) {
      tailwindDark.push(`${file}:${i + 1}`);
    }
    if (/[bB]ackground(Color)?\s*:\s*['"]#/.test(line)) {
      inlineHexSurfaces.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

check(
  'no component relies on Tailwind `dark:` (it cannot see data-theme)',
  tailwindDark.length === 0,
  tailwindDark.length ? `${tailwindDark.length} hit(s): ${tailwindDark.slice(0, 8).join(', ')}` : ''
);
check(
  'no component paints a surface with an inline hex colour',
  inlineHexSurfaces.length === 0,
  inlineHexSurfaces.length
    ? `${inlineHexSurfaces.length} hit(s):\n         ${inlineHexSurfaces.slice(0, 8).join('\n         ')}`
    : ''
);

// The two components that had the hardest hardcoded surfaces, asserted directly: the
// welcome cards and the mascot's speech bubble were literal white.
for (const file of ['AgentWelcome.tsx', 'NoboMascot.tsx']) {
  const full = path.join(AGENT_DIR, file);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, 'utf8');
  check(`${file} paints its bubble/card from a token`, /background:\s*'var\(--nobo-/.test(source));
}

// ── summary ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`${pass}/${pass + fail} checks passed`);
if (fail > 0) {
  console.log('');
  console.log('Dark mode is not theme-safe yet. Every failure above is a rule that renders in');
  console.log('one theme and not the other; fix it by moving the colour into a token instead.');
  process.exit(1);
}
console.log('Both themes are driven by the same rules, and the palettes are complete.');
