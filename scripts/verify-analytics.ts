/**
 * Verifies the analytics/lead tools against the real database, and — critically
 * — that the answers are sentences a human can act on.
 *
 *   node .tmp-analytics.cjs [profileId]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createReportingTools } from '../lib/agent/tools/reporting';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  const profileId = process.argv[2] || 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const tools = createReportingTools(sb, profileId) as any;
  const call = (n: string, a: any) => tools[n].execute(a, { toolCallId: 't', messages: [] });

  // ── calls: attempts vs connected ─────────────────────────────────────────
  const calls = await call('org_call_report', { period: 'all_time' });
  console.log('\ncalls all-time:', calls.answer);
  console.log('  byStatus:', JSON.stringify(calls.byStatus));
  check('reports call attempts explicitly', typeof calls.callAttempts === 'number', `attempts=${calls.callAttempts}`);
  check('attempts equals status sum', calls.callAttempts === Object.values(calls.byStatus || {}).reduce((a: number, b: any) => a + Number(b), 0));
  check(
    'statuses use human words not DB enums',
    !Object.keys(calls.byStatus || {}).some((k) => /NOT_CONNECTED|CONNECTED/.test(k)),
    Object.keys(calls.byStatus || {}).join(', ')
  );

  // ── lead funnel ──────────────────────────────────────────────────────────
  const leads = await call('org_lead_report', { period: 'all_time' });
  console.log('\nleads all-time:', leads.answer);
  check('lead report answered in a sentence', typeof leads.answer === 'string' && leads.answer.length > 20);
  check('positive <= total leads', leads.positiveLeads <= leads.totalLeads, `${leads.positiveLeads}/${leads.totalLeads}`);
  check('stage breakdown sums to total', Object.values(leads.byStage || {}).reduce((a: number, b: any) => a + Number(b), 0) === leads.totalLeads);
  check('states how positivity is defined', Boolean(leads.positiveDefinition), leads.positiveDefinition?.slice(0, 60));

  // ── AI call summaries ────────────────────────────────────────────────────
  const conv = await call('lead_conversations', { limit: 3 });
  console.log('\nconversations:', String(conv.answer).slice(0, 240));
  check('returned lead conversations', conv.success === true && conv.count > 0, `${conv.count} leads`);
  check('summaries are human text', Boolean(conv.leads?.[0]?.callSummary), String(conv.leads?.[0]?.callSummary || '').slice(0, 80));

  // ── unknown lead must not invent anything ────────────────────────────────
  const none = await call('lead_conversations', { leadId: '00000000-0000-0000-0000-000000000000' });
  check('missing lead degrades honestly', none.count === 0 && /No leads/i.test(String(none.answer)), String(none.answer).slice(0, 60));

  console.log(`\n=== ${fails === 0 ? 'all checks passed' : fails + ' FAILED'}`);
  if (fails) process.exit(1);
})();
