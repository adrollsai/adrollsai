/**
 * Is the daily job actually making this business better? One table, no adjectives.
 *
 * WHY THIS EXISTS
 * "It improves your business daily, based on the numbers" is the promise. Until now there was no
 * instrument that could confirm or refute it, so the promise was a design intention with a
 * marketing department attached. This prints, per business, the four things that decide whether
 * the promise is being kept:
 *
 *   DAYS RUN      did the job actually run, and did it finish? (the loop is worthless if it dies)
 *   ENQUIRIES     this week against the week before
 *   ₹ PER ENQUIRY what the ads cost per enquiry, this week against the week before
 *   PUBLISHED     what went out, because an engine that makes nothing and reports well is a diary
 *
 * and then one verdict derived from those, in the same words to every reader: improving, flat,
 * behind, or not measurable. The verdict uses *both* halves — enquiries up AND cost per enquiry
 * down or flat — because volume bought with dearer enquiries is not improvement.
 *
 * It also names jobs that are switched on but have not run in 48 hours, which is the silent
 * failure mode that made the first version of this loop look alive while producing nothing.
 *
 * READ-ONLY. It spends no credits and changes nothing.
 *
 *   npm run scorecard:engine
 *   npm run scorecard:engine -- --user=Procolor
 *   npm run scorecard:engine -- --days=28 --json
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { supabaseMetricsReader } from '../lib/agent/ceo-metrics';
import { weekRecap, rupeesPlain, type WeekRecap } from '../lib/agent/weekly-recap';

const arg = (name: string, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const match = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!match) throw new Error(`missing ${name} in .env.local`);
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const days = Math.max(7, Number(arg('days', '14')) || 14);
const filter = arg('user', '').toLowerCase();
const since = new Date(Date.now() - days * 86_400_000).toISOString();

type Verdict = 'improving' | 'flat' | 'behind' | 'not measurable' | 'not running';

interface Row {
  business: string;
  userId: string;
  enabled: boolean;
  daysRun: number;
  daysExpected: number;
  briefsDone: number;
  briefsDead: number;
  recap: WeekRecap | null;
  verdict: Verdict;
  reason: string;
  lastRunAt: string | null;
  waitingOnYou: number;
}

function verdictFor(recap: WeekRecap | null, enabled: boolean, daysRun: number, daysExpected: number): { verdict: Verdict; reason: string } {
  if (!enabled) return { verdict: 'not running', reason: 'switched off' };
  if (daysRun === 0) return { verdict: 'not running', reason: `no run in ${daysExpected} day(s)` };
  if (!recap) return { verdict: 'not measurable', reason: 'numbers could not be read' };

  const moreEnquiries = recap.leads.now > recap.leads.before;
  const sameEnquiries = recap.leads.now === recap.leads.before;
  const cheaper = recap.ads.costPerEnquiryPaise !== null && recap.ads.beforeCostPaise !== null
    && recap.ads.costPerEnquiryPaise < recap.ads.beforeCostPaise;
  const dearer = recap.ads.costPerEnquiryPaise !== null && recap.ads.beforeCostPaise !== null
    && recap.ads.costPerEnquiryPaise > recap.ads.beforeCostPaise;

  if (moreEnquiries && !dearer) {
    return { verdict: 'improving', reason: cheaper ? 'more enquiries, cheaper each' : 'more enquiries at the same price' };
  }
  if (moreEnquiries && dearer) {
    return { verdict: 'flat', reason: 'more enquiries, but each one costs more' };
  }
  if (sameEnquiries && cheaper) return { verdict: 'improving', reason: 'same enquiries, cheaper each' };
  if (sameEnquiries) return { verdict: 'flat', reason: 'same enquiries at the same price' };
  if (recap.leads.now < recap.leads.before && !cheaper) {
    return { verdict: 'behind', reason: 'fewer enquiries and not cheaper' };
  }
  return { verdict: 'behind', reason: 'fewer enquiries' };
}

async function main() {
  const { data: routines } = await supabase.from('business_routines').select('*').order('created_at', { ascending: true });
  const byUser = new Map<string, any>();
  for (const routine of routines || []) {
    // One routine per business: the oldest row wins, exactly as the product treats it.
    if (!byUser.has(routine.user_id)) byUser.set(routine.user_id, routine);
  }

  const ids = [...byUser.keys()];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, business_name')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const nameOf = new Map((profiles || []).map((p: any) => [p.id, p.business_name || '(unnamed)']));

  const rows: Row[] = [];
  for (const [userId, routine] of byUser) {
    const business = nameOf.get(userId) || '(unnamed)';
    if (filter && !`${business} ${userId}`.toLowerCase().includes(filter)) continue;

    const { data: runs } = await supabase
      .from('routine_runs')
      .select('period_key, status, run_id, created_at')
      .eq('user_id', userId)
      .gte('created_at', since);

    const daysRun = new Set((runs || []).map((r) => r.period_key)).size;
    const runIds = (runs || []).map((r) => r.run_id).filter(Boolean) as string[];
    let briefsDone = 0;
    let briefsDead = 0;
    if (runIds.length) {
      const { data: harnessRuns } = await supabase.from('harness_runs').select('id, status').in('id', runIds);
      for (const run of harnessRuns || []) {
        if (['completed', 'succeeded', 'done'].includes(String(run.status))) briefsDone += 1;
        if (['dead', 'failed', 'error'].includes(String(run.status))) briefsDead += 1;
      }
    }

    const { count: waitingOnYou } = await supabase
      .from('agent_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending');

    const recap = await weekRecap(supabaseMetricsReader(supabase, userId), new Date(), routine.timezone || 'Asia/Kolkata').catch(() => null);
    // No second Meta read here: `weekRecap` -> `reader.ads()` already goes through
    // `loadAccountPerformance`, so the scorecard and the daily report cannot disagree about the
    // money by construction rather than by a second query.

    const daysExpected = Math.min(days, 7 * 2);
    const { verdict, reason } = verdictFor(recap, Boolean(routine.enabled), daysRun, daysExpected);

    rows.push({
      business,
      userId,
      enabled: Boolean(routine.enabled),
      daysRun,
      daysExpected,
      briefsDone,
      briefsDead,
      recap,
      verdict,
      reason,
      lastRunAt: routine.last_run_at ?? null,
      waitingOnYou: waitingOnYou ?? 0,
    });
  }

  if (flag('json')) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (!rows.length) {
    console.log('No business has a daily marketing job yet. Nothing to score — that is the finding.');
    return;
  }

  const pad = (text: string, width: number) => String(text).padEnd(width).slice(0, width);
  const padL = (text: string, width: number) => String(text).padStart(width).slice(0, width);

  console.log('');
  console.log(`DAILY MARKETING SCORECARD — last ${days} days, read ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  console.log('');
  console.log(
    `${pad('BUSINESS', 30)}${pad('JOB', 6)}${padL('DAYS', 6)}${padL('BRIEFS', 8)}${padL('ENQUIRIES', 12)}${padL('₹/ENQUIRY', 20)}${padL('OUT', 5)}${padL('YOU', 5)}  VERDICT`
  );
  console.log('─'.repeat(110));

  for (const row of rows) {
    const enquiries = row.recap ? `${row.recap.leads.now} vs ${row.recap.leads.before}` : '—';
    const cost = row.recap && row.recap.ads.costPerEnquiryPaise !== null
      ? `${rupeesPlain(row.recap.ads.costPerEnquiryPaise)} vs ${row.recap.ads.beforeCostPaise ? rupeesPlain(row.recap.ads.beforeCostPaise) : '—'}`
      : row.recap?.ads.measured === false ? 'not read' : '—';
    console.log(
      `${pad(row.business, 30)}${pad(row.enabled ? 'on' : 'off', 6)}` +
        `${padL(`${row.daysRun}/${row.daysExpected}`, 6)}` +
        `${padL(`${row.briefsDone}${row.briefsDead ? `/${row.briefsDead}✗` : ''}`, 8)}` +
        `${padL(enquiries, 12)}${padL(cost, 20)}` +
        `${padL(String(row.recap?.content.published ?? 0), 5)}${padL(String(row.waitingOnYou), 5)}  ${row.verdict.toUpperCase()} — ${row.reason}`
    );
  }

  console.log('');
  console.log('DAYS    how many days in the window had a daily job claimed; BRIEFS done/failed');
  console.log('ENQUIRIES / ₹ PER ENQUIRY  this week vs the week before. YOU = waiting on your approval.');
  console.log('');

  const improving = rows.filter((row) => row.verdict === 'improving').length;
  const behind = rows.filter((row) => row.verdict === 'behind').length;
  const stalled = rows.filter((row) => row.enabled && row.daysRun === 0);
  const unmeasurable = rows.filter((row) => row.verdict === 'not measurable');

  console.log(`${rows.length} business(es): ${improving} improving, ${behind} behind, ${stalled.length} switched on but not running.`);
  if (stalled.length) {
    console.log(`  SWITCHED ON BUT NOT RUNNING: ${stalled.map((row) => row.business).join(', ')} — the cron is not claiming these.`);
  }
  if (unmeasurable.length) {
    console.log(`  NOT MEASURABLE: ${unmeasurable.map((row) => row.business).join(', ')} — no Meta connection, so no proof either way.`);
  }
  console.log('');
  console.log('A verdict of improving needs BOTH more enquiries and a cost per enquiry that did not rise.');
  console.log('Volume bought with dearer enquiries is not improvement, and this table will not call it one.');
}

await main();
