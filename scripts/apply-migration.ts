/**
 * Apply a migration directly, when the CLI's bookkeeping cannot be reconciled.
 *
 * The repo does not mirror the remote migration history, so `supabase db push` refuses to run and
 * `db pull` will not materialise it. This connects with the credentials the CLI already stored and
 * executes the SQL, then records the version so a later `db push` does not try to apply it again.
 */
import '../lib/env-local';
import { readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node apply-migration.mjs <path-to-sql>');
  process.exit(1);
}
const sql = readFileSync(file, 'utf8');
const base = path.basename(file, '.sql');
const version = base.split('_')[0];
const name = base.slice(version.length + 1);

const pooler = readFileSync(path.join('supabase', '.temp', 'pooler-url'), 'utf8').trim();

async function connect(url: string) {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

let client: Client | null = null;
try {
  client = await connect(pooler);
  console.log('connected via pooler');
} catch (e: any) {
  console.log(`pooler failed (${e.message}); trying the direct port`);
  client = await connect(pooler.replace(':6543/', ':5432/'));
  console.log('connected on 5432');
}

try {
  const before = await client.query(
    `select table_name from information_schema.tables where table_schema='public' and table_name in ('flow_schedules','flow_runs','flow_settings')`
  );
  console.log('tables before:', before.rows.map((r) => r.table_name).join(', ') || '(none)');

  await client.query(sql);
  console.log('migration applied');

  const after = await client.query(
    `select table_name from information_schema.tables where table_schema='public' and table_name in ('flow_schedules','flow_runs','flow_settings') order by table_name`
  );
  console.log('tables after :', after.rows.map((r) => r.table_name).join(', '));

  const idx = await client.query(
    `select indexname from pg_indexes where schemaname='public' and tablename in ('flow_schedules','flow_runs') order by indexname`
  );
  console.log('indexes      :', idx.rows.map((r) => r.indexname).join(', '));

  // Record the version so a future `supabase db push` sees it as already applied.
  await client.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, name text, inserted_at timestamptz not null default now()
    )`);
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, name) values ($1,$2)
     on conflict (version) do nothing`,
    [version, name]
  );
  console.log(`migration history: ${version} recorded`);
} catch (e: any) {
  console.error('FAILED:', e.message);
  if (e.position) console.error('at character', e.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
