/**
 * Put every real business on the CEO's daily routine.
 *
 * WHAT THIS DOES
 * Finds every profile without an enabled routine and gives it the same conservative default the
 * product gives an owner who clicks "Start it" — one plan a day at 07:00 in their own timezone,
 * "always ask before spending", a 200-credit daily ceiling. Businesses that already have one are
 * left exactly as they are.
 *
 * WHAT IT DELIBERATELY SKIPS
 * Turning the CEO on for an account that cannot run is not help, it is noise: a routine that fails
 * every morning, and two emails a day that nobody asked for. So placeholder ids, blank business
 * names, demo/test accounts and accounts with no credits are reported and skipped rather than
 * enrolled. The list is printed in full so the decision stays visible.
 *
 * Safe to run repeatedly: it only ever fills a gap.
 *
 *   npx tsx scripts/ceo-enable-all.ts            # dry run, writes nothing
 *   npx tsx scripts/ceo-enable-all.ts --apply    # actually enables and creates
 */
import { createClient } from '@supabase/supabase-js';
import { defaultRoutineIntent } from '../lib/agent/routines';
import { nextRunAt, DEFAULT_RUN_HOUR, DEFAULT_TIMEZONE } from '../lib/agent/routine-schedule';

const APPLY = process.argv.includes('--apply');

/** Profiles that are not businesses: seeded placeholders and explicit test rows. */
const PLACEHOLDER_ID = /^([0-9])\1{7}-/i;
const TESTY_NAME = /\b(test|demo|new user|old data|dummy|sample|example)\b/i;

function skipReason(profile: any): string | null {
  const name = String(profile.business_name || '').trim();
  if (PLACEHOLDER_ID.test(profile.id)) return 'placeholder account';
  if (!name) return 'no business name';
  if (TESTY_NAME.test(name)) return `test/demo account (“${name}”)`;
  if (Number(profile.credits) <= 0) return `no credits (“${name}”)`;
  return null;
}

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const [{ data: profiles, error: profileErr }, { data: routines, error: routineErr }] = await Promise.all([
    db.from('profiles').select('id, business_name, credits, industry, timezone'),
    db.from('business_routines').select('id, user_id, enabled, timezone, run_at_hour'),
  ]);
  if (profileErr) throw new Error(`profiles: ${profileErr.message}`);
  if (routineErr) throw new Error(`business_routines: ${routineErr.message}`);

  const byUser = new Map<string, any>((routines || []).map((r) => [r.user_id, r]));
  const alreadyOn: string[] = [];
  const toEnable: any[] = [];
  const toCreate: any[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const profile of profiles || []) {
    const existing = byUser.get(profile.id);
    if (existing?.enabled) {
      alreadyOn.push(String(profile.business_name || profile.id).trim());
      continue;
    }
    if (existing) {
      toEnable.push(profile);
      continue;
    }
    const reason = skipReason(profile);
    if (reason) skipped.push({ name: String(profile.business_name || '(no name)').trim(), reason });
    else toCreate.push(profile);
  }

  console.log(`\nalready on         ${alreadyOn.length}`);
  console.log(`disabled → enable  ${toEnable.length}`);
  console.log(`missing  → create  ${toCreate.length}`);
  console.log(`skipped            ${skipped.length}`);

  if (skipped.length) {
    console.log('\nnot enrolled, and why:');
    for (const s of skipped) console.log(`   ${s.name} — ${s.reason}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to enroll ${toEnable.length + toCreate.length} account(s).`);
    console.log(`would create for: ${toCreate.map((p) => String(p.business_name || '').trim()).join(', ') || '(none)'}`);
    return;
  }

  const now = new Date();
  let enabled = 0;
  let created = 0;
  const failures: string[] = [];

  for (const profile of toEnable) {
    const existing = byUser.get(profile.id);
    const timezone = existing?.timezone || profile.timezone || DEFAULT_TIMEZONE;
    const firstRun = nextRunAt(now, {
      cadence: 'daily',
      run_at_hour: Number(existing?.run_at_hour ?? DEFAULT_RUN_HOUR),
      timezone,
    }).toISOString();
    const { error } = await db
      .from('business_routines')
      .update({ enabled: true, next_run_at: firstRun, updated_at: now.toISOString() })
      .eq('id', existing.id);
    if (error) failures.push(`${profile.business_name}: ${error.message}`);
    else enabled++;
  }

  for (const profile of toCreate) {
    const timezone = profile.timezone || DEFAULT_TIMEZONE;
    const firstRun = nextRunAt(now, { cadence: 'daily', run_at_hour: DEFAULT_RUN_HOUR, timezone }).toISOString();
    const { error } = await db.from('business_routines').insert({
      user_id: profile.id,
      name: 'Daily marketing',
      // The same intent an owner gets when they click Start: written for THIS business, with its
      // industry vocabulary, not a generic string with the name pasted in.
      intent: defaultRoutineIntent(profile.business_name || 'the business', profile.industry || null),
      cadence: 'daily',
      run_at_hour: DEFAULT_RUN_HOUR,
      timezone,
      daily_credit_cap: 200,
      approval_policy: 'always',
      // Tomorrow morning, never right now: enabling the CEO must not spend a credit or send an
      // email in the same minute the switch is flipped.
      next_run_at: firstRun,
      enabled: true,
    });
    if (error) failures.push(`${profile.business_name}: ${error.message}`);
    else created++;
  }

  console.log(`\nenabled ${enabled}, created ${created}${failures.length ? `, failed ${failures.length}` : ''}`);
  for (const failure of failures) console.log(`   FAILED ${failure}`);

  const { count } = await db
    .from('business_routines')
    .select('id', { count: 'exact', head: true })
    .eq('enabled', true);
  console.log(`routines enabled platform-wide: ${count}`);
  if (failures.length) process.exitCode = 1;
})();
