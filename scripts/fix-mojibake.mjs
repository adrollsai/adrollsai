/**
 * Repair UTF-8 text that was saved after being read as Windows-1252.
 *
 * The catalogue card rendered "📍 Mexmon Dreams, Jalandhar" as "ðŸ  Mexmon Dreams, Jalandhar", and
 * several toast messages say "AI Generation Started âœ¨" instead of "✨". Those are not exotic: a file
 * written with a Latin-1/CP1252 encoder turns each UTF-8 byte into a character, so 📍 (F0 9F 93 8D)
 * became the four characters "ð Ÿ " and — (E2 80 94) became "â€"".
 *
 * This reverses it: take a maximal run of characters that could be CP1252 bytes, encode them back to
 * bytes, decode as UTF-8, and keep the result only when it decodes cleanly. A run that does not decode
 * is left alone, so genuinely non-ASCII text — a Malayalam label, a name with an accent stored
 * correctly — is never touched.
 *
 * TRUNCATED SEQUENCES ARE THE INTERESTING CASE. `components/LeadHistoryModal.tsx` compares stored
 * descriptions against prefixes like "🎙️ CALL_JSON:", and every one of them had been mangled to
 * "ðŸŽ™ï¸ CALL_JSON:" — with the final byte of the variation selector (EF B8 8F) missing. A decoder
 * that only accepts all-or-nothing runs rejects that as invalid UTF-8 and repairs nothing, which is
 * exactly why a whole file of mojibake survived. So the decoder is greedy: it consumes every complete
 * sequence, and when the run ends mid-sequence the truncated remainder is dropped rather than kept as
 * garbage. "ðŸŽ™ï¸" therefore becomes "🎙", not "🎙ï¸".
 *
 *   node scripts/fix-mojibake.mjs                     # report the default file list
 *   node scripts/fix-mojibake.mjs --write             # rewrite them
 *   node scripts/fix-mojibake.mjs --all-files         # scan app/, components/, lib/, utils/, hooks/
 *   node scripts/fix-mojibake.mjs --all --write app/x.tsx lib/y.ts   # named files, comments included
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

/**
 * Decode as many complete UTF-8 sequences as the bytes allow.
 *
 * Returns the decoded text and how many source characters it consumed. `truncatedTail` is true when
 * the run stopped on an incomplete multi-byte sequence — the marker of a dropped final byte.
 */
function decodeRun(run) {
  const bytes = [];
  for (const char of run) {
    const byte = byteFor(char.codePointAt(0));
    if (byte === null) break;
    bytes.push(byte);
  }

  let out = '';
  let index = 0;
  let truncatedTail = false;

  while (index < bytes.length) {
    const lead = bytes[index];
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      index += 1;
      continue;
    }

    const length = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
    if (length === 0) break; // 0x80–0xC1 and 0xF5+ can never start a sequence
    if (index + length > bytes.length) {
      truncatedTail = true;
      break;
    }

    let codePoint = lead & (0xff >> (length + 1));
    let ok = true;
    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[index + offset];
      if (next < 0x80 || next > 0xbf) {
        ok = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (!ok) break;
    // Reject overlong encodings, surrogates and out-of-range values: they are not text.
    const tooSmall = (length === 2 && codePoint < 0x80) || (length === 3 && codePoint < 0x800) || (length === 4 && codePoint < 0x10000);
    if (tooSmall || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) break;

    out += String.fromCodePoint(codePoint);
    index += length;
  }

  return { text: out, consumed: index, truncatedTail };
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

  const chars = [...line];
  let out = '';
  let index = 0;
  while (index < chars.length) {
    if (!couldBeByte(chars[index].codePointAt(0))) {
      out += chars[index];
      index += 1;
      continue;
    }
    // Take the maximal run of byte-like characters and decode as much of it as is real text.
    let end = index;
    while (end < chars.length && couldBeByte(chars[end].codePointAt(0))) end += 1;
    const run = chars.slice(index, end).join('');
    const decoded = decodeRun(run);
    if (decoded.consumed === 0) {
      // Nothing here is UTF-8: a correctly stored "é" or "—", or a lone high byte. Leave it.
      out += run;
      index = end;
      continue;
    }
    out += decoded.text;
    index += decoded.consumed;
    if (decoded.truncatedTail) {
      // The last byte of a sequence was lost when the file was saved. The rest of the run is the
      // remnant of that one character, so drop it instead of printing half an emoji.
      index = end;
    }
  }
  return out;
}

const DEFAULT_FILES = [
  'app/dashboard/page.tsx',
  'app/dashboard/crm/page.tsx',
  'app/dashboard/team/page.tsx',
  'components/WhatsAppSettings.tsx',
  'components/VoiceAgentSettings.tsx',
  'components/GroupLeadDistributionModal.tsx',
  'components/SearchableSelect.tsx',
];

/**
 * Patterns that CONTAIN mojibake on purpose — a detector for corrupt markup, and this file's own
 * examples. Repairing those would delete the check that catches the next occurrence.
 */
const NEVER_REPAIR = new Set(['scripts/fix-mojibake.mjs', 'scripts/accept-catalog.ts']);

const args = process.argv.slice(2);
const write = args.includes('--write');
const includeComments = args.includes('--all');
const scanTree = args.includes('--all-files');
const named = args.filter((arg) => !arg.startsWith('--'));
const root = process.cwd();

/** Every source file a person can actually see text from. */
function walk(dir) {
  if (!fs.existsSync(path.join(root, dir))) return [];
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(relative));
    else if (/\.(tsx|ts|jsx|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(relative);
  }
  return out;
}

const scanned = scanTree ? ['app', 'components', 'lib', 'utils', 'hooks'].flatMap(walk) : [];
const targets = named.length > 0 ? named : scanTree ? [...DEFAULT_FILES, ...scanned] : DEFAULT_FILES;
let changedFiles = 0;
let changedLines = 0;

for (const relative of [...new Set(targets.map((entry) => entry.split(path.sep).join('/')))]) {
  if (NEVER_REPAIR.has(relative)) {
    console.log(`  ${relative}: skipped (its mojibake is a detector)`);
    continue;
  }
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    console.log(`  ${relative}: not found`);
    continue;
  }
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  let touched = 0;
  const repaired = lines.map((line, lineIndex) => {
    const next = repairLine(line, includeComments);
    if (next !== line) {
      touched += 1;
      if (touched <= 8) {
        console.log(`  ${relative}:${lineIndex + 1}`);
        console.log(`    - ${line.trim().slice(0, 120)}`);
        console.log(`    + ${next.trim().slice(0, 120)}`);
      }
    }
    return next;
  });
  if (touched === 0) continue;
  changedFiles += 1;
  changedLines += touched;
  console.log(`  ${relative}: ${touched} line(s)`);
  if (write) fs.writeFileSync(file, repaired.join('\n'), 'utf8');
}

console.log(
  `\n${changedLines} line(s) in ${changedFiles} file(s) ${write ? 'repaired' : 'would change'} ` +
    `(${includeComments ? 'including' : 'ignoring'} comment lines).`,
);
if (!write && changedLines > 0) console.log('Re-run with --write to apply.');
