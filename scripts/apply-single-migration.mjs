/**
 * Apply ONE migration file to the project as a single statement.
 *
 * `scripts/db-apply-migration.mjs` splits a file on ';'-at-end-of-line so it can
 * report which statement failed. That is the right tool for a file of many small
 * statements, and the wrong one for a PL/pgSQL function whose body is full of
 * semicolons — the splitter would cut the function in half.
 *
 * So: strip the `--` comment lines, send everything that is left as one
 * statement, and print whatever the API says. Nothing here is clever.
 *
 *   node scripts/apply-single-migration.mjs supabase/migrations/foo.sql
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_REF = 'hpssqssdewmkmafxlfud';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

function readToken() {
  if (process.env.SUPABASE_MANAGEMENT_TOKEN) return process.env.SUPABASE_MANAGEMENT_TOKEN.trim();
  const line = fs
    .readFileSync(path.resolve('.env.local'), 'utf8')
    .split(/\r?\n/)
    .find((entry) => /^\s*SUPABASE_MANAGEMENT_TOKEN\s*=/.test(entry));
  if (!line) throw new Error('SUPABASE_MANAGEMENT_TOKEN is not in .env.local');
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/apply-single-migration.mjs <file.sql>');

const sql = fs
  .readFileSync(path.resolve(file), 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter((line) => !/^\s*--/.test(line))
  .join('\n')
  .trim();

if (!sql) throw new Error('nothing left after stripping comments');

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { Authorization: `Bearer ${readToken()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 2000) || '(empty body)');
process.exit(res.ok ? 0 : 1);
