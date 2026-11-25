/**
 * Apply one SQL file to the database, using the pooler URL the Supabase CLI already stored.
 *
 * The repo's apply-migration.ts uses top-level await, which tsx refuses to transform for CJS ("Top-level
 * await is currently not supported with the cjs output format"). This is the same job in plain ESM so it
 * can actually run.
 *
 *   node scripts/apply-sql.mjs supabase/migrations/<file>.sql
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-sql.mjs <path-to-sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const poolerUrl = readFileSync(path.join('supabase', '.temp', 'pooler-url'), 'utf8').trim();

const client = new pg.Client({ connectionString: poolerUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // One transaction: a half-applied migration is worse than none.
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  console.log(`applied ${path.basename(file)}`);
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(`FAILED ${path.basename(file)}:`, error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
