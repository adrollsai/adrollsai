/**
 * Repair UTF-8 text that was saved after being read as Windows-1252.
 *
 * The catalogue card rendered "📍 Mexmon Dreams, Jalandhar" as "ðŸ  Mexmon Dreams, Jalandhar", and
 * several toast messages say "AI Generation Started âœ¨" instead of "✨". Those are not exotic: a file
 * written with a Latin-1/CP1252 encoder turns each UTF-8 byte into a character, so 📍 (F0 9F 93 8D)
 * became the four characters "ð Ÿ " and — (E2 80 94) became "â€"".
 *
 * This reverses it exactly: take a maximal run of characters that could be CP1252 bytes, encode them
 * back to bytes, decode as UTF-8, and keep the result only when it decodes cleanly (no U+FFFD). A
 * run that does not decode is left alone, so genuinely non-ASCII text — a Malayalam label, a name
 * with an accent stored correctly — is never touched.
 *
 *   node scripts/fix-mojibake.mjs            # report what would change
 *   node scripts/fix-mojibake.mjs --write    # rewrite the files
 *   node scripts/fix-mojibake.mjs --all      # include comment lines too
 */
import fs from 'node:fs';
import path from 'node:path';

/** The 27 CP1252 code points that differ from Latin-1, mapped to the byte they came from. */
const CP1252_TO_BYTE = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const byteFor = (code) => (code >= 0x80 && code <= 0xff ? code : CP1252_TO_BYTE.get(code) ?? null);

/** Is this code point one a CP1252 encoder could have produced from a UTF-8 byte? */
const couldBeByte = (code) => byteFor(code) !== null;

function decodeRun(run) {
  const bytes = [];
  for (const char of run) {
    const byte = byteFor(char.codePointAt(0));
    if (byte === null) return null;
    bytes.push(byte);
  }
  const decoded = Buffer.from(bytes).toString('utf8');
  if (decoded.includes('\uFFFD')) return null;
  return decoded;
}

/**
 * A line is worth looking at when it holds a run of at least two byte-like characters, one of them
 * non-ASCII. That is the shape every mojibake sequence has ("â€", "ðŸ", "âœ") and it keeps ASCII-only
 * lines — most of the codebase — out of the scan entirely.
 */
function looksRepairable(line) {
  let run = 0;
  let sawNonAscii = false;
  for (const char of line) {
    const code = char.codePointAt(0);
    if (couldBeByte(code)) {
      run += 1;
      if (code > 0x7f) sawNonAscii = true;
    } else {
      if (run >= 2 && sawNonAscii) return true;
      run = 0;
      sawNonAscii = false;
    }
  }
  return run >= 2 && sawNonAscii;
}

function repairLine(line, includeComments) {
  if (!looksRepairable(line)) return line;
  const trimmed = line.trimStart();
  if (!includeComments && /^(\/\/|\*|\/\*)/.test(trimmed)) return line;

  let out = '';
  let index = 0;
  while (index < line.length) {
    const code = line.codePointAt(index);
    if (!couldBeByte(code)) {
      out += String.fromCodePoint(code);
      index += code > 0xffff ? 2 : 1;
      continue;
    }
    // Take the maximal run of byte-like characters and try to decode it.
    let end = index;
    while (end < line.length && couldBeByte(line.codePointAt(end))) {
      end += line.codePointAt(end) > 0xffff ? 2 : 1;
    }
    const run = line.slice(index, end);
    const decoded = decodeRun(run);
    out += decoded ?? run;
    index = end;
  }
  return out;
}

const FILES = [
  'app/dashboard/page.tsx',
  'app/dashboard/crm/page.tsx',
  'app/dashboard/team/page.tsx',
  'app/dashboard/page.tsx',
  'components/WhatsAppSettings.tsx',
  'components/VoiceAgentSettings.tsx',
  'components/GroupLeadDistributionModal.tsx',
  'components/SearchableSelect.tsx',
];

const write = process.argv.includes('--write');
const includeComments = process.argv.includes('--all');
const scanTree = process.argv.includes('--all-files');
const root = process.cwd();

/** Every .tsx/.ts under app/ and components/ — the files a person can actually see text from. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(relative));
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(relative);
  }
  return out;
}

const targets = scanTree ? [...FILES, ...walk('app'), ...walk('components')] : FILES;
let changedFiles = 0;
let changedLines = 0;

for (const relative of [...new Set(targets)]) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  let touched = 0;
  const repaired = lines.map((line) => {
    const next = repairLine(line, includeComments);
    if (next !== line) {
      touched++;
      if (touched <= 6) {
        console.log(`  ${relative}:${lines.indexOf(line) + 1}`);
        console.log(`    - ${line.trim().slice(0, 120)}`);
        console.log(`    + ${next.trim().slice(0, 120)}`);
      }
    }
    return next;
  });
  if (touched === 0) continue;
  changedFiles++;
  changedLines += touched;
  console.log(`  ${relative}: ${touched} line(s)`);
  if (write) fs.writeFileSync(file, repaired.join('\n'), 'utf8');
}

console.log(
  `\n${changedLines} line(s) in ${changedFiles} file(s) ${write ? 'repaired' : 'would change'} ` +
    `(${includeComments ? 'including' : 'ignoring'} comment lines).`
);
if (!write && changedLines > 0) console.log('Re-run with --write to apply.');
