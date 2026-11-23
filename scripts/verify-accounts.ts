/**
 * "For GNR Homes" has to work.
 *
 * WHAT HAPPENED
 * The owner (super admin) asked for GNR Homes' leads from its latest campaign. The agent could not find
 * the account. GNR HOMES is an independent client — role admin, no parent, no agency — so it is not in
 * the caller's subtree, and `query_account_data` only offered me / org / all. There was no way to look an
 * account up by NAME, and no way to point a read AT one. For a super admin that is simply a broken
 * answer to a fair question.
 *
 * What this pins:
 *   1. the scope rule — super admin sees every account, an agency its subtree, a tenant only itself;
 *   2. name matching that survives case, spacing and an email fragment ("GNR Homes" vs "GNR HOMES");
 *   3. live: the directory finds GNR HOMES as super admin and reports its real lead count and latest
 *      campaign; a different tenant cannot see it; and query_account_data with that accountId returns
 *      exactly the database's number for that account.
 *
 *   npm run verify:accounts
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { ACCOUNT_TOOLS, accountIsVisible, accountMatches, resolveAccountScope } from '../lib/agent/tools/accounts';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

// ── 1. who sees whom
console.log('\n▸ the scope rule');
const boss = { id: 'boss', role: 'super_admin' };
const agency = { id: 'agency', role: 'agency' };
const tenant = { id: 'tenant', role: 'admin' };
const kids = [{ id: 'kid-1' }, { id: 'kid-2' }];

check('a super admin sees every account', (() => {
  const scope = resolveAccountScope(boss);
  return scope.ok && scope.mode === 'all' && scope.allowedIds === null;
})(), 'allowedIds null = no filter');

check('an agency sees itself plus its sub-accounts', (() => {
  const scope = resolveAccountScope(agency, kids);
  return scope.ok && scope.mode === 'org' && (scope.allowedIds || []).length === 3;
})());

check('a tenant with no children sees only itself', (() => {
  const scope = resolveAccountScope(tenant, []);
  return scope.ok && scope.mode === 'me' && (scope.allowedIds || []).join() === 'tenant';
})());

check('an account WITH children gets its tree even as a plain admin', (() => {
  const scope = resolveAccountScope(tenant, kids);
  return scope.mode === 'org' && (scope.allowedIds || []).length === 3;
})());

check('visibility follows that scope', (() => {
  const all = resolveAccountScope(boss);
  const mine = resolveAccountScope(tenant, []);
  return accountIsVisible(all, 'any-account') && accountIsVisible(mine, 'tenant') && !accountIsVisible(mine, 'other-tenant');
})(), 'a tenant cannot reach another tenant even by id');

// ── 2. finding an account by the way a person writes it
console.log('\n▸ "GNR Homes" finds GNR HOMES');
const gnr = { id: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', business_name: 'GNR HOMES', email: 'gnrhomes97@gmail.com', role: 'admin', parent_id: null, agency_id: null };
for (const search of ['GNR Homes', 'gnr homes', 'gnr', 'GNR', 'gnrhomes', 'gnrhomes97@gmail.com']) {
  check(`search "${search}" matches`, accountMatches(gnr, search));
}
check('a different business does not match', !accountMatches(gnr, 'Blue Square'));
check('an empty search matches everything (a plain list)', accountMatches(gnr, ''));
check('a partial id matches', accountMatches(gnr, '42d2e0c5'));

// ── 3. wired
console.log('\n▸ wired into the agent');
const orchestrator = fs.readFileSync('lib/agent/orchestrator.ts', 'utf8');
check('the account directory is registered', /createAccountTools\(supabase,\s*userId\)/.test(orchestrator), ACCOUNT_TOOLS.join(', '));
check('the prompt tells the agent to search here before refusing', /NEVER say you cannot find an account before you have searched here/.test(orchestrator));
check('and that a super admin reaches any account by id', /a super admin reaches any by id/.test(orchestrator));
check('the read primitive takes an accountId', /accountId: z/.test(fs.readFileSync('lib/agent/tools/data-query.ts', 'utf8')));

// ── 4. live: the actual account, the actual numbers
console.log('\n▸ live: the account the owner asked about');
const env = (n: string) => {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(n + '='));
  return line ? line.slice(n.length + 1).replace(/^["']|["']$/g, '').trim() : '';
};
const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const { createAccountTools } = await import('../lib/agent/tools/accounts');
const { createDataQueryTools } = await import('../lib/agent/tools/data-query');

const bossTools: any = (createAccountTools as any)(admin, 'bc63c065-9bcc-4793-bedc-f0960406425b');
const found: any = await bossTools.list_accounts.execute({ search: 'GNR Homes' });
check('a super admin finds it by name', found.ok && found.accounts.length >= 1, `${found.matched} matched, scope ${found.scope}`);
const gnrRow = (found.accounts || []).find((a: any) => /GNR/i.test(String(a.businessName)));
check('the id is the real one', gnrRow?.id === gnr.id, String(gnrRow?.id).slice(0, 8));

const { count: dbLeads } = await admin.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', gnr.id);
check('its lead count matches the database', Number(gnrRow?.leads) === Number(dbLeads), `tool ${gnrRow?.leads} vs database ${dbLeads}`);

const { data: campaigns } = await admin
  .from('campaigns')
  .select('id, name, created_at')
  .eq('user_id', gnr.id)
  .order('created_at', { ascending: false })
  .limit(1);
const latest = (campaigns || [])[0];

// GNR HOMES has NO rows in `campaigns`; its attribution lives on the leads (ad_name / campaign_id).
// So "latest campaign" must be answerable from the leads — otherwise the honest answer to the owner's
// question is "no campaigns", which is wrong.
const { data: newestAttributed } = await admin
  .from('leads')
  .select('ad_name, created_at')
  .eq('user_id', gnr.id)
  .not('ad_name', 'is', null)
  .order('created_at', { ascending: false })
  .limit(1);
const newestAd = (newestAttributed || [])[0]?.ad_name || null;

check(
  'its latest campaign is reported (from the campaigns table, or the leads when that is empty)',
  latest ? gnrRow?.latestCampaign?.id === latest.id : newestAd ? gnrRow?.latestCampaign?.name === newestAd : gnrRow?.latestCampaign === null,
  latest ? `campaigns table: ${String(latest.name).slice(0, 30)}` : newestAd ? `lead attribution: ${String(newestAd).slice(0, 44)}` : 'no attribution at all',
);

if (newestAd && !latest) {
  const { count: attributedLeads } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', gnr.id)
    .eq('ad_name', newestAd);
  check(
    'and the lead count for that campaign matches',
    Number(gnrRow?.latestCampaign?.leads) === Number(attributedLeads),
    `tool ${gnrRow?.latestCampaign?.leads} vs database ${attributedLeads}`,
  );
}

// the read primitive can now be pointed at it
const bossRead: any = (createDataQueryTools as any)(admin, 'bc63c065-9bcc-4793-bedc-f0960406425b').query_account_data;
const read: any = await bossRead.execute({ table: 'leads', operation: 'count', accountId: gnr.id });
check(
  'a super admin can read THAT account through query_account_data',
  read.ok === true && Number(read.count) === Number(dbLeads),
  `tool ${read.count} vs database ${dbLeads} — scope "${read.scopeLabel}"`,
);

// a different tenant must not reach it
const otherTenant = 'd838c956-1761-4bce-9d91-32f3abecc222';
const theirRead: any = (createDataQueryTools as any)(admin, otherTenant).query_account_data;
const denied: any = await theirRead.execute({ table: 'leads', operation: 'count', accountId: gnr.id });
check('another tenant is refused that account', denied.ok === false && /outside the scope/.test(String(denied.error)), String(denied.error).slice(0, 90));

const theirDirectory: any = (createAccountTools as any)(admin, otherTenant).list_accounts;
const theirList: any = await theirDirectory.execute({ search: 'GNR' });
check(
  'and does not see it in the directory at all',
  theirList.ok === true && !(theirList.accounts || []).some((a: any) => /GNR/i.test(String(a.businessName))),
  `scope ${theirList.scope}, ${theirList.returned} account(s)`,
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
