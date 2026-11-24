/**
 * Dry run: exactly what tomorrow's 09:00 brief will tell the agent, without enqueuing anything.
 * Reads only. Spends nothing. Changes nothing.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { composeRoutineBrief } from '../lib/automation/routine-composer';
import { getActivePlaybook } from '../lib/automation/ceo';
import { availableCredits } from '../lib/automation/billing';
import { supabaseMetricsReader } from '../lib/agent/ceo-metrics';
import { weekRecap } from '../lib/agent/weekly-recap';
import { loadAccountPerformance } from '../lib/ads/account-performance';
import { resolveCountry, upcomingFestivals } from '../utils/festival-helper';

const raw = fs.readFileSync('.env.local', 'utf8');
const env = (n: string) => raw.match(new RegExp('^' + n + '=(.*)$', 'm'))![1].trim().replace(/^["']|["']$/g, '');
const db = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const wanted = process.argv.find((a) => a.startsWith('--user='))?.slice(7) || 'Procolor';
const { data: profiles } = await db.from('profiles').select('id, business_name, industry, credits, address, currency, client_features').ilike('business_name', `%${wanted}%`).limit(3);
const profile = profiles?.[0];
if (!profile) throw new Error(`no profile matching ${wanted}`);

const { data: routine } = await db.from('business_routines').select('*').eq('user_id', profile.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
if (!routine) throw new Error('no routine row');

const now = new Date();
const period = new Intl.DateTimeFormat('en-CA', { timeZone: routine.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const playbook = await getActivePlaybook(db, profile.id);
const available = await availableCredits(db, profile.id);
const [performance, recap] = await Promise.all([
  loadAccountPerformance(db, profile.id, { datePreset: 'last_7d', level: 'ad' }).catch(() => null),
  weekRecap(supabaseMetricsReader(db, profile.id), now, routine.timezone).catch(() => null),
]);
const country = resolveCountry({
  clientFeaturesCountry: (profile as any)?.client_features?.country,
  address: (profile as any)?.address,
  currency: (profile as any)?.currency,
});

const compiled = composeRoutineBrief({
  businessName: profile.business_name,
  industry: profile.industry,
  playbook,
  routine: {
    name: routine.name,
    intent: routine.intent,
    cadence: routine.cadence,
    approval_policy: routine.approval_policy,
    daily_credit_cap: routine.daily_credit_cap,
    channels: routine.channels || [],
    timezone: routine.timezone,
  },
  todaysDate: period,
  now,
  creditsLeft: profile.credits,
  availableCredits: available,
  pendingApprovals: 0,
  festivals: upcomingFestivals(country.code, now, 1),
  lastWeekNotes: recap?.text ?? null,
  creativeLearnings: performance?.learnings ?? null,
  adPerformance: performance
    ? {
        measured: performance.measured,
        currency: performance.currency,
        spendPaise: performance.spendPaise,
        results: performance.results,
        costPerResultPaise: performance.costPerResultPaise,
        previousCostPerResultPaise: performance.previousCostPerResultPaise,
      }
    : null,
});

console.log(`${profile.business_name} — brief for ${period} (${routine.timezone})`);
console.log(`routine enabled=${routine.enabled}  approval=${routine.approval_policy}  cap=${routine.daily_credit_cap}`);
console.log(`word count: ${compiled.text.split(/\s+/).length}, playbook routine: ${compiled.usedPlaybookRoutine}`);
console.log(`ads measured: ${performance?.measured ?? false}${performance?.error ? ` (${performance.error})` : ''}`);
console.log(`week recap missing: ${recap?.missing.join(', ') || 'nothing'}`);
console.log('');
const lines = compiled.text.split('\n');
const grab = (start: string, count: number) => {
  const at = lines.findIndex((line) => line.includes(start));
  if (at === -1) return [`  [absent] ${start}`];
  return lines.slice(at, at + count);
};
console.log('── LAST WEEK ─────────────────────────────────────────────');
console.log(grab('LAST WEEK, MEASURED', 5).join('\n'));
console.log('');
console.log('── WHAT THE ADS DID ─────────────────────────────────────');
console.log(grab('WHAT THE ADS HAVE ACTUALLY DONE', 8).join('\n'));
console.log('');
console.log('── MONEY / APPROVAL ─────────────────────────────────────');
console.log(grab('THE APPROVAL GATE', 4).join('\n'));
console.log(grab('MONEY RULES', 4).join('\n'));
