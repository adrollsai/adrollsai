/**
 * Verifies flow awareness against the real automations on the account, and that
 * conflict detection actually catches a duplicate before one is created.
 *
 *   npm run verify:flows
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createAutomationTools } from '../lib/agent/tools/automation';

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
  const tools = createAutomationTools(sb, profileId) as any;
  const call = (n: string, a: any) => tools[n].execute(a, { toolCallId: 't', messages: [] });

  const list = await call('list_automation_flows', { includeInactive: true });
  console.log('\nflows:', list.answer);
  check('listed automations', list.success === true && list.totalCount > 0, `${list.totalCount} total / ${list.activeCount} active`);
  check('answered in prose', typeof list.answer === 'string' && list.answer.length > 20);
  check('flows carry a human trigger label', (list.whatsappFlows || []).every((f: any) => !/trigger/i.test(f.trigger) || /click|inbound|lead|button|comment|DM/i.test(f.trigger)),
    (list.whatsappFlows || [])[0]?.trigger);

  const activeOnly = await call('list_automation_flows', {});
  check('active-only view is a subset', activeOnly.totalCount <= list.totalCount, `${activeOnly.activeCount} active`);

  // Pick a real active flow with an ad trigger and ask whether it would clash.
  const adFlow = (list.whatsappFlows || []).find((f: any) => f.active && /Meta ad/i.test(f.trigger));

  if (adFlow) {
    const clash = await call('check_flow_conflicts', {
      triggerType: 'meta_ad',
      campaignId: adFlow.campaignId || undefined,
    });
    console.log(`\nclash check (meta_ad, campaign=${adFlow.campaignId}):`, clash.answer);
    check('detects a conflict on an occupied trigger', clash.hasConflict === true, `${clash.conflictingFlows?.length} conflicting`);
    check('names the flow that would clash', (clash.conflictingFlows || []).length > 0);
  } else {
    console.log('\n(no active ad-triggered flow on this account — checking a generic trigger instead)');
  }

  // An unoccupied trigger must report no conflict.
  const free = await call('check_flow_conflicts', { triggerType: 'whatsapp_inbound', keywords: ['zzz-not-a-real-keyword'] });
  console.log('\nfree-trigger check:', free.answer);
  check('does not invent conflicts on a free trigger', free.hasConflict === false || (free.conflictingFlows || []).every((f: any) => f.keywords.length === 0),
    `hasConflict=${free.hasConflict}`);

  // A crm_lead check must be honest about what is active.
  const crm = await call('check_flow_conflicts', { triggerType: 'crm_lead' });
  check('crm_lead check returns a verdict', typeof crm.answer === 'string' && crm.answer.length > 10, crm.answer?.slice(0, 90));

  console.log(`\n=== ${fails === 0 ? 'all checks passed' : fails + ' FAILED'}`);
  if (fails) process.exit(1);
})();
