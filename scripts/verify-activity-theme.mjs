/**
 * The activity page is a LIGHT page, and it stays one.
 *
 * This page has now been "converted" twice and broken twice: the first pass changed the backgrounds and
 * left the text colours behind, producing near-black pages with dark text, and white text sitting on white
 * cards — invisible labels, which is exactly what "what the fuck is this UI for the activity page" was
 * looking at.
 *
 * So this gate reads the source and fails on the two shapes that make text unreadable:
 *   1. a dark page/card surface still in the file (bg-[#0…], bg-slate-9xx, bg-black),
 *   2. `text-white` on a line that has no coloured surface behind it.
 *
 *   npm run verify:activity-theme
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = 'app/dashboard/profile/history/page.tsx';

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
const head = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`);

/** A surface dark enough that white text is the correct choice on it. */
const DARK_SURFACE =
  /(?:bg|from|to|via)-(?:blue|indigo|purple|violet|amber|emerald|rose|sky|slate|black|white)-(?:5|6|7|8|9)\d\d|bg-black|bg-gradient-to/;

const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const lines = source.split('\n');

head('1. No dark surfaces left in the page shell');

{
  const darkShell = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /bg-\[#0[0-9a-fA-F]{3,}\]|bg-slate-9\d\d|bg-zinc-9\d\d|bg-neutral-9\d\d|bg-gray-9\d\d/.test(line));

  check('the page does not paint itself near-black', darkShell.length === 0, darkShell.map((h) => `line ${h.number}`).join(', '));
  check('it paints itself light instead', /bg-slate-50/.test(source));
}

head('2. No white text on a light surface');

{
  const whiteOnLight = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /text-white/.test(line) && !DARK_SURFACE.test(line));

  check(
    'every remaining text-white sits on a coloured surface',
    whiteOnLight.length === 0,
    whiteOnLight.map((h) => `line ${h.number}: ${h.line.trim().slice(0, 60)}`).join(' | '),
  );

  const hoverInvisible = lines.filter((line) => /hover:text-white/.test(line) && !DARK_SURFACE.test(line));
  check('no hover state turns text white on a light button', hoverInvisible.length === 0, `${hoverInvisible.length} line(s)`);
}

head('3. Dark-mode leftovers that read as glow-on-black');

{
  // These shades were picked to glow on a black page; on white they are washed out.
  const glowText = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /text-(?:blue|purple|violet|indigo|amber|emerald|sky|rose)-[234]00/.test(line));
  check('accent text uses the -600/-700 shades for a light background', glowText.length === 0, glowText.map((h) => `line ${h.number}`).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
