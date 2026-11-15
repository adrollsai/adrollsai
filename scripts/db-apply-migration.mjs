/**
 * Apply one SQL migration to the production database, statement by statement.
 *
 * WHY STATEMENT BY STATEMENT
 * The management endpoint rejects a whole file that carries many comments, and its
 * 400s come back with an empty body, so a whole-file attempt tells you nothing about
 * which statement failed. Applying one statement at a time makes the failure land on
 * a line you can read.
 *
 * THE CRLF TRAP (this cost a wasted attempt before)
 * Splitting on ');\n' misses every statement in a CRLF file — the CREATE TABLE
 * silently never runs and then every dependent index/policy fails 400 for a
 * legitimate-looking reason. So: strip `--` comment lines, normalise line endings,
 * then split on ';' followed by end-of-line.
 *
 * USAGE
 *   node scripts/db-apply-migration.mjs sql/migrations/19_lead_journey.sql --check
 *   node scripts/db-apply-migration.mjs sql/migrations/19_lead_journey.sql
 *
 * --check runs each statement's leading keyword against the catalogue instead of
 * applying it, so you can see what WOULD happen. Nothing is ever applied without an
 * explicit run: there is no "did it work?" guesswork and no dry-run that pretends to
 * be a dry run.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_REF = 'hpssqssdewmkmafxlfud';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

function readToken() {
  if (process.env.SUPABASE_MANAGEMENT_TOKEN) return process.env.SUPABASE_MANAGEMENT_TOKEN.trim();
  const envPath = path.resolve('.env.local');
  if (!fs.existsSync(envPath)) throw new Error('no SUPABASE_MANAGEMENT_TOKEN and no .env.local to read it from');
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => /^\s*SUPABASE_MANAGEMENT_TOKEN\s*=/.test(entry));
  if (!line) throw new Error('SUPABASE_MANAGEMENT_TOKEN is not in .env.local');
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

/** Strip full-line `--` comments, normalise CRLF, split on `;` at end of line. */
export function splitSql(raw) {
  const withoutComments = String(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  return withoutComments
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && statement !== ';')
    .map((statement) => (/;\s*$/.test(statement) ? statement : `${statement};`));
}

/** A short, safe label for a statement: its first clause, collapsed. */
export function labelFor(statement) {
  const collapsed = statement.replace(/\s+/g, ' ').trim();
  return collapsed.length <= 96 ? collapsed : `${collapsed.slice(0, 93)}…`;
}

async function runSql(token, query) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, body, parsed };
}

/** What does the database already have? Read-only, always safe. */
async function inspect(token, statements) {
  const names = new Set();
  for (const statement of statements) {
    for (const match of statement.matchAll(
      /(?:create\s+table\s+(?:if\s+not\s+exists\s+)?|create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?)((?:public\.)?[a-z0-9_]+)/gi,
    )) {
      names.add(match[1].replace(/^public\./, ''));
    }
  }
  if (!names.size) return { found: [], missing: [] };

  const list = [...names].map((name) => `'${name}'`).join(', ');
  const result = await runSql(
    token,
    `select c.relname as name, c.relkind as kind
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (${list})`,
  );

  if (!result.ok) throw new Error(`inspection failed (${result.status}): ${result.body.slice(0, 300)}`);
  const rows = Array.isArray(result.parsed) ? result.parsed : [];
  const found = rows.map((row) => `${row.name} (${row.kind})`);
  const foundNames = new Set(rows.map((row) => row.name));
  return { found, missing: [...names].filter((name) => !foundNames.has(name)) };
}

const file = process.argv[2];
const checkOnly = process.argv.includes('--check');
const sqlFlagAt = process.argv.indexOf('--sql');
const adHocSql = sqlFlagAt === -1 ? null : process.argv[sqlFlagAt + 1];

if (adHocSql) {
  // `--sql "select …"` runs ONE read-only statement and prints its rows. Verification
  // should never be "the endpoint returned 200": ask the catalogue the actual question.
  const result = await runSql(readToken(), adHocSql);
  if (!result.ok) {
    console.error(`HTTP ${result.status}: ${result.body.slice(0, 400)}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result.parsed, null, 2));
  }
} else if (!file) {
  console.error('usage: node scripts/db-apply-migration.mjs <file.sql> [--check]');
  console.error('       node scripts/db-apply-migration.mjs --sql "select …"');
  // `process.exitCode` rather than `process.exit`: calling exit while fetch's keep-alive
  // socket is closing trips a libuv assertion on Windows, which PowerShell reports as a
  // failure even when the run was clean.
  process.exitCode = 2;
} else {
  await main(file, checkOnly);
}

async function main(file, checkOnly) {
  const raw = fs.readFileSync(file, 'utf8');
  const statements = splitSql(raw);
  if (!statements.length) {
    console.error('no statements found — refusing to claim the migration was applied');
    process.exitCode = 2;
    return;
  }

  const token = readToken();
  console.log(`${file}: ${statements.length} statement(s)\n`);

  const before = await inspect(token, statements);
  console.log(`already present: ${before.found.length ? before.found.join(', ') : 'none'}`);
  console.log(`not present:     ${before.missing.length ? before.missing.join(', ') : 'none'}\n`);

  if (checkOnly) {
    console.log('--check: nothing was applied.');
    return;
  }

  let applied = 0;
  const failures = [];
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index];
    const result = await runSql(token, statement);
    if (result.ok) {
      applied++;
      console.log(`  [${index + 1}/${statements.length}] OK   ${labelFor(statement)}`);
    } else {
      failures.push({ index: index + 1, label: labelFor(statement), status: result.status, body: result.body });
      console.log(`  [${index + 1}/${statements.length}] FAIL ${labelFor(statement)}`);
      console.log(`         HTTP ${result.status}: ${result.body.slice(0, 400) || '(empty body)'}`);
    }
  }

  const after = await inspect(token, statements);
  console.log(`\napplied ${applied}/${statements.length}, failed ${failures.length}`);
  console.log(`now present: ${after.found.length ? after.found.join(', ') : 'none'}`);
  if (after.missing.length) console.log(`still missing: ${after.missing.join(', ')}`);

  if (failures.length || after.missing.length) process.exitCode = 1;
}
