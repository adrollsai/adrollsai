/**
 * Builds the repo snapshot that lets the owner ask "how does X work?" and get an answer from
 * the real code instead of from a model's imagination.
 *
 * WHY A SNAPSHOT AND NOT A CHECKOUT
 * The app runs on Vercel, where there is no `git` and no repository — the deployed bundle is
 * the only thing present. So the code has to travel with the deployment. This script distils
 * the tracked source into one JSON file that is committed and bundled, which means the answer
 * endpoint works at 3am on a machine that has never seen this project.
 *
 * WHY NOT EMBEDDINGS
 * `lib/agent/skill-router.ts` already sets the house precedent: deterministic scoring is
 * instant, free, has no index to go stale, and a search you can explain is a search you can
 * debug. A codebase this small does not need a vector store — it needs the header comments,
 * which in this repo are unusually good, matched against the question.
 *
 * WHAT IS EXTRACTED, AND WHY EACH FIELD EARNS ITS BYTES
 *   path      the strongest signal there is ("ask about the review gate" → review-gate.ts)
 *   header    the leading block comment, which says what the file is FOR in prose
 *   exports   the public surface, so "what does the healer export" is answerable
 *   tables    every from('…') the file touches, so "what writes to leads?" is answerable
 *   routes    HTTP methods for API routes, so "which endpoint does X" is answerable
 *
 * Run with `npm run build:ops-repo-index` after changing source. The verify gate fails if the
 * snapshot's commit does not match HEAD, so it cannot silently rot.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'lib/ops/repo-snapshot.json';

/** Source we index. Binaries, assets and generated files are deliberately absent. */
const INCLUDE = /\.(ts|tsx|mjs|js|sql|md)$/i;
const EXCLUDE = /^(public\/|assets\/|node_modules\/|\.next\/|play-store-assets\/|android\/|ios\/)/i;

/** Header comments are the single most useful field, but a 40KB one has to be truncated. */
const HEADER_MAX = 1100;
/** Files above this many exports or tables are described by their first N. */
const LIST_MAX = 24;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

// `--others --exclude-standard` is not optional. Plain `git ls-files` lists TRACKED files only,
// so a module written but not yet committed is invisible to the ask console — which is exactly
// backwards, because new code is the code the owner is most likely to be asking about. Found
// the hard way: the first snapshot silently omitted all of lib/ops because lib/ops was new.
const files = git('ls-files', '--cached', '--others', '--exclude-standard')
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((path) => INCLUDE.test(path) && !EXCLUDE.test(path));

/** The leading block comment or line-comment run: the file's own explanation of itself. */
function headerOf(source) {
  const text = source.replace(/^\uFEFF/, '');
  const leading = text.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  if (leading) {
    return leading[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
      .join('\n')
      .trim();
  }
  // A shebang or an `import` first: take the first run of `//` lines after it.
  const lineComments = text.match(/^(?:#[^\n]*\n|\s*)*((?:\s*\/\/[^\n]*\n){2,})/);
  if (lineComments) {
    return lineComments[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\/\/\s?/, '').trimEnd())
      .join('\n')
      .trim();
  }
  return '';
}

function exportsOf(source) {
  const names = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:interface|type|class|enum)\s+([A-Za-z0-9_$]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return [...names].slice(0, LIST_MAX);
}

/** Supabase tables the file reads or writes — the fastest way to answer "who touches X". */
function tablesOf(source) {
  const names = new Set();
  for (const match of source.matchAll(/\.from\(\s*['"`]([a-z0-9_]+)['"`]\s*\)/gi)) names.add(match[1]);
  for (const match of source.matchAll(/\.rpc\(\s*['"`]([a-z0-9_]+)['"`]/gi)) names.add(`rpc:${match[1]}`);
  return [...names].slice(0, LIST_MAX);
}

/**
 * A compact keyword signature of the file BODY.
 *
 * This exists because only a quarter of the files in this repo open with a header comment, and
 * the ask console was measurably worse without it: "where are whatsapp template messages sent?"
 * could not find `lib/agent/tools/whatsapp.ts`, because its *name* matched but nothing inside it
 * did. Header prose only helps files that were written with prose.
 *
 * The signature is the most distinctive identifiers the file actually uses, by frequency. Not a
 * code excerpt: excerpts waste bytes on punctuation and generic scaffolding, while identifiers
 * (`sendTemplateMessage`, `waba_id`, `broadcast`) are exactly the words a question uses.
 */
const CODE_KEYWORDS = new Set([
  'const', 'return', 'async', 'await', 'function', 'export', 'import', 'from', 'this', 'that',
  'number', 'string', 'boolean', 'true', 'false', 'null', 'undefined', 'default', 'break',
  'continue', 'else', 'typeof', 'instanceof', 'interface', 'extends', 'implements', 'public',
  'private', 'static', 'readonly', 'class', 'throw', 'catch', 'while', 'case', 'switch', 'danger',
  'require', 'console', 'json', 'object', 'array', 'props', 'value', 'data', 'type', 'name',
  'makes', 'there', 'which', 'their', 'would', 'could', 'should', 'because', 'before', 'after',
  'these', 'those', 'where', 'while', 'still', 'never', 'always', 'every', 'first', 'other',
]);

function bodySignature(source) {
  const body = source
    // Strip block comments: their words are already captured by the header field.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  const counts = new Map();
  for (const match of body.matchAll(/[A-Za-z][A-Za-z0-9_]{3,}/g)) {
    const word = match[0].toLowerCase();
    if (CODE_KEYWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 48)
    .map(([word]) => word)
    .join(' ')
    .slice(0, 420);
}

/** HTTP verbs an App Router route handler exports. */
function routesOf(source) {
  const verbs = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
    verbs.add(match[1]);
  }
  return [...verbs];
}

const entries = [];
let skippedBinary = 0;
let totalSourceBytes = 0;

for (const path of files) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    skippedBinary++;
    continue;
  }
  // A NUL byte in the first block means it is not text, whatever its extension claims.
  if (source.slice(0, 4000).includes('\u0000')) {
    skippedBinary++;
    continue;
  }
  totalSourceBytes += source.length;

  const header = headerOf(source).slice(0, HEADER_MAX);
  const entry = {
    p: path,
    l: source.split(/\r?\n/).length,
    h: header,
  };
  const names = exportsOf(source);
  if (names.length) entry.e = names;
  const tables = tablesOf(source);
  if (tables.length) entry.t = tables;
  const routes = routesOf(source);
  if (routes.length) entry.r = routes;
  const signature = bodySignature(source);
  if (signature) entry.b = signature;

  entries.push(entry);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  commit: git('rev-parse', '--short', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  fileCount: entries.length,
  files: entries,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snapshot), 'utf8');

const bytes = readFileSync(OUT).length;
const withHeaders = entries.filter((entry) => entry.h).length;
console.log(`indexed ${entries.length} file(s) at ${snapshot.commit} (${snapshot.branch})`);
console.log(`  ${withHeaders} carry a header comment (${Math.round((100 * withHeaders) / entries.length)}%)`);
console.log(`  ${skippedBinary} skipped as binary`);
console.log(`  read ${(totalSourceBytes / 1024 / 1024).toFixed(1)} MB of source`);
console.log(`  wrote ${OUT}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
