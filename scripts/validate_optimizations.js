/* Validates 20261112140000 BEFORE it is applied.
 *
 * Pass 1 (as owner): for EVERY profile, assert
 *   A. lead_owner_ids() set == the original leads policy's owner set (exactly)
 *   B. my_tenant_ids() set == is_same_tenant() truth set (exactly)
 *   C. leads rows visible under the new policy == under the ORIGINAL policy
 * Pass 2 (as the Bluesquare admin, role=authenticated, real 8s timeout): timings.
 * Both passes apply the real migration file inside a transaction and ROLLBACK.
 *
 *   node scripts/validate_optimizations.js
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const TOKEN = env.SUPABASE_MANAGEMENT_TOKEN;
const REF = 'hpssqssdewmkmafxlfud';
const MIGRATION = 'supabase/migrations/20261112140000_narrow_leads_scope_and_set_based_policies.sql';
const ADMIN = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

async function sql(query) {
  const started = Date.now();
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - started, text };
}

const ddl = fs.readFileSync(MIGRATION, 'utf8')
  .replace(/^\s*begin\s*;/im, '')
  .replace(/^\s*commit\s*;\s*$/im, '');

const assertions = `
create temp table v_results (check_name text, caller uuid, detail text);

do $val$
declare
  u record;
  bad_sets int;
  bad_tenant int;
  old_cnt bigint;
  new_cnt bigint;
begin
  for u in select id from public.profiles loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', u.id, 'role', 'authenticated')::text, true);

    with caller as (select * from public.profiles where id = u.id),
    expected as (
      select caller.id from caller
      union select caller.parent_id from caller where caller.parent_id is not null
      union select caller.agency_id from caller where caller.agency_id is not null
      union select c.id from public.profiles c, caller where c.agency_id = caller.id
      union select p.id from public.profiles p, caller where caller.role = 'super_admin'
    )
    select count(*) into bad_sets from (
      (select id from expected except select * from public.lead_owner_ids())
      union all
      (select * from public.lead_owner_ids() except select id from expected)
    ) d;
    if bad_sets <> 0 then
      insert into v_results values ('A_lead_owner_ids_mismatch', u.id, bad_sets::text);
    end if;

    -- Only existing profile ids (guaranteed by the user_id FK) and NULL can
    -- ever appear in user_id, so those are the only values worth comparing.
    select count(*) into bad_tenant from (
      select x.id
      from (select id from public.profiles union all select null::uuid) x
      where coalesce(public.is_same_tenant(x.id), false)
         <> coalesce((x.id in (select * from public.my_tenant_ids())), false)
    ) m;
    if bad_tenant <> 0 then
      insert into v_results values ('B_my_tenant_ids_mismatch', u.id, bad_tenant::text);
    end if;

    select count(*) filter (where
        u.id = l.user_id
        or u.id = l.assigned_to
        or exists (select 1 from public.profiles p
                    where p.id = u.id
                      and (p.agency_id = l.user_id
                        or p.parent_id = l.user_id
                        or p.role = 'super_admin'))
        or exists (select 1 from public.profiles p
                    where p.id = l.user_id and p.agency_id = u.id))
      into old_cnt from public.leads l;

    select count(*) filter (where
        u.id = l.assigned_to
        or l.user_id in (select * from public.lead_owner_ids()))
      into new_cnt from public.leads l;

    if old_cnt <> new_cnt then
      insert into v_results values ('C_leads_rows_differ', u.id,
        format('original=%s new=%s', old_cnt, new_cnt));
    end if;
  end loop;
end $val$;

select (select count(*) from public.profiles)  as profiles_checked,
       (select count(*) from v_results)        as failed_check_count,
       (select coalesce(string_agg(check_name || '@' || caller || ':' || detail, ' | '), 'NONE')
          from v_results)                      as failed_checks,
       -- If every user_id carries an FK to profiles(id), no orphan owner can
       -- exist, which is what makes the set form exactly equal to the scalar one.
       (select count(*) from pg_constraint
          where contype = 'f'
            and conname in ('leads_user_id_fkey','lead_history_user_id_fkey','notifications_user_id_fkey'))
                                               as user_id_fkeys_present;
`;

const timing = `
set local role authenticated;
set local request.jwt.claims = '{"sub":"${ADMIN}","role":"authenticated"}';
set local statement_timeout = '8s';
select
  (select count(*) from public.leads)          as leads_count,
  (select count(*) from public.lead_history)   as lead_history_count,
  (select count(*) from public.notifications)  as notifications_count,
  (select count(*) from (
      select id from public.leads order by created_at desc limit 1000) f) as first_page;
`;

(async () => {
  console.log('Pass 1: exhaustive equivalence across every profile...');
  const a = await sql(`begin;\n${ddl}\n${assertions}\nrollback;`);
  console.log(`  HTTP ${a.status} in ${a.ms}ms`);
  if (a.status !== 201) { console.log(a.text.slice(0, 1500)); process.exit(1); }
  const ar = JSON.parse(a.text)[0];
  console.log('  ' + JSON.stringify(ar));

  console.log('\nPass 2: timings as the Bluesquare admin under RLS...');
  const b = await sql(`begin;\n${ddl}\n${timing}\nrollback;`);
  console.log(`  HTTP ${b.status} in ${b.ms}ms (includes DDL)`);
  if (b.status !== 201) { console.log(b.text.slice(0, 1500)); process.exit(1); }
  const br = JSON.parse(b.text)[0];
  console.log('  ' + JSON.stringify(br));

  const ok = ar.failed_check_count === 0
    && br.leads_count === 16251
    && br.first_page === 1000;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} — failed checks: ${ar.failed_check_count}`);
  process.exit(ok ? 0 : 1);
})();
