/**
 * Does the festival-greeting automation either work correctly or stay silent?
 *
 * What was wrong, and what these checks hold down:
 *   1. The calendar was year-blind. `getFestivalForToday` matched month + day only, so the
 *      2026 Diwali entry would have fired again on 8 November 2027 — a greeting on the
 *      wrong day, sent under the client's name.
 *   2. The cron was never scheduled and never ran: zero festival assets exist in the
 *      database. It is a complete pipeline behind a switch that was never wired.
 *   3. It obeyed no switch and no budget: no `tenant_automations` check and no spend cap,
 *      so scheduling it as it stood would have generated a paid image for every profile
 *      on every festival, including tenants who had turned automation off.
 *   4. Country came from a free-text address and defaulted to India, so a Dubai client
 *      with no country field received Indian festivals.
 *
 *   npx esbuild scripts/verify-festival-automation.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-festival.mjs --log-level=warning && node .tmp-festival.mjs
 */
import fs from 'node:fs';

import {
  FESTIVAL_CALENDAR_YEAR,
  FESTIVALS_2026,
  buildFestivalCreativePrompt,
  calendarForYear,
  festivalContextNote,
  getFestivalForToday,
  nextFestivalAfter,
  resolveCountry,
  upcomingFestivals,
} from '../utils/festival-helper';
import {
  DEFAULT_FESTIVAL_TENANTS,
  festivalAutomationConfig,
  isFestivalAutomationEnabled,
  parseFestivalAllowlist,
} from '../lib/automation/festival-allowlist';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};
const note = (text: string) => console.log(`\n▸ ${text}`);

const read = (p: string) => fs.readFileSync(p, 'utf8');
const route = read('app/api/cron/auto-generate/festival/route.ts');
const helper = read('utils/festival-helper.ts');
const vercel = JSON.parse(read('vercel.json'));

// ---------------------------------------------------------------------------
note('THE CALENDAR CANNOT FIRE ON THE WRONG DAY');
const diwali2026 = getFestivalForToday('India', new Date(2026, 10, 8));
check('Diwali is found on its real 2026 date', diwali2026?.id === 'in-diwali', String(diwali2026?.name));
const diwali2027 = getFestivalForToday('India', new Date(2027, 10, 8));
check('and NOT a year later, when Diwali has moved', diwali2027 === null, 'month+day matching alone was the bug');
check('a year with no calendar is silent rather than wrong', calendarForYear(2027) === null);
check('the known calendar is 2026', FESTIVAL_CALENDAR_YEAR === 2026 && !!calendarForYear(2026));
check(
  'the silence is explainable in a log',
  /has not been entered yet/.test(festivalContextNote('India', new Date(2027, 10, 8))),
  festivalContextNote('India', new Date(2027, 10, 8)),
);

note('THE RIGHT COUNTRY GETS THE RIGHT FESTIVAL');
const thanksUS = getFestivalForToday('US', new Date(2026, 10, 26));
check('a US client gets Thanksgiving', thanksUS?.id === 'us-thanksgiving', String(thanksUS?.name));
check('an Indian client gets nothing that day', getFestivalForToday('India', new Date(2026, 10, 26)) === null);
const xmasIN = getFestivalForToday('India', new Date(2026, 11, 25));
check('a country with no entry falls back to the GLOBAL festival', xmasIN?.id === 'global-christmas', String(xmasIN?.name));
const gurpurab = getFestivalForToday('India', new Date(2026, 10, 24));
check('a country-specific entry wins over nothing else that day', gurpurab?.id === 'in-guru-nanak-jayanti', String(gurpurab?.name));
check('an unknown country still reads the GLOBAL calendar', getFestivalForToday('ZZ', new Date(2026, 11, 25))?.id === 'global-christmas');

note('COUNTRY COMES FROM A SIGNAL THAT IS ACTUALLY FILLED IN');
check(
  'an explicit country field wins',
  resolveCountry({ clientFeaturesCountry: 'United States', currency: 'INR' }).code === 'US',
  resolveCountry({ clientFeaturesCountry: 'United States', currency: 'INR' }).from,
);
check('the account currency is the fallback', resolveCountry({ currency: 'AED' }).code === 'AE', 'only 2 of 106 profiles had a country field');
check('currency US → US', resolveCountry({ currency: 'USD' }).code === 'US');
check('currency GBP → GB', resolveCountry({ currency: 'GBP' }).code === 'GB');
check(
  'a named country in the address is believed',
  resolveCountry({ address: '406 Al Moosa Tower 1, Sheikh Zayed Road, Dubai' }).code === 'AE',
  resolveCountry({ address: '406 Al Moosa Tower 1, Sheikh Zayed Road, Dubai' }).from,
);
check(
  'a plain Indian street address does not invent a country',
  resolveCountry({ address: 'SCO 121-122, Sector 14, New Chandigarh, Punjab' }).from === 'default',
  'it used to be classified by pattern-matching the address text',
);
check('nothing at all means India, as before', resolveCountry({}).code === 'IN');

note('THE AGENT CAN SEE THE CALENDAR');
check('today + tomorrow are listed', upcomingFestivals('India', new Date(2026, 10, 8), 1).some((n) => /Diwali/.test(n)));
check('tomorrow is labelled as tomorrow', upcomingFestivals('India', new Date(2026, 10, 7), 1).some((n) => /tomorrow/.test(n)), upcomingFestivals('India', new Date(2026, 10, 7), 1).join(', '));
check('an empty day is an empty list, not null', Array.isArray(upcomingFestivals('India', new Date(2026, 6, 1), 1)));
check('an unknown year yields no festivals', upcomingFestivals('India', new Date(2030, 10, 8), 1).length === 0);
const next = nextFestivalAfter('India', new Date(2026, 10, 19));
check('the next festival is computable for an operator', next?.festival.id === 'in-guru-nanak-jayanti' && next?.daysAway === 5, next ? `${next.festival.name} in ${next.daysAway} days` : 'none');

note('THE GREETING IS A BRAND GREETING, NOT A PROPERTY AD');
const prompt = buildFestivalCreativePrompt({
  festival: FESTIVALS_2026.find((f) => f.id === 'in-diwali')!,
  businessName: 'Bioque Estates International',
  contactNumber: '+91 98765 43210',
});
check('the prompt names the business', prompt.includes('Bioque Estates International'));
check('the prompt names the festival', /Diwali/.test(prompt));
check('the prompt forbids featuring inventory', /Do NOT feature any specific product or property inventory/.test(prompt));
check('the prompt carries the contact line', prompt.includes('+91 98765 43210'));

// ---------------------------------------------------------------------------
note('WIRED: THE CRON OBEYS THE TENANT AND THE BUDGET');
check('it reads tenant_automations', /from\('tenant_automations'\)/.test(route));
check('and skips a tenant who turned automation off', /disabled_by_tenant/.test(route));
check('it asks the spend guard before generating', /canSpend\(supabaseAdmin, profile\.id, 'creative'/.test(route));
check('it refuses to spend when the guard cannot be read', /spend_guard_unavailable/.test(route));
check('it ledgers the spend afterwards', /recordSpend\(supabaseAdmin, profile\.id, 'creative'/.test(route));
check('it uses the resolved country, not the raw address', /resolveCountry\(/.test(route) && !/client_features\?\.country \|\| profile\.address/.test(route));
check('it dedupes per festival per day', /contains\('metadata', \{ festival_id: activeFestival\.id \}\)/.test(route));
check('it reports what it skipped and why', /skippedCount/.test(route) && /skipped,/.test(route));
check('a paid image is still an approval, never an auto-post', /status: 'pending_approval'/.test(route));
check('it still sends Approve/Edit to the owner on WhatsApp', /isFestival: true/.test(route) && /dispatchCreativeToAdmin\(/.test(route));

note('WIRED: THE YEAR GUARD IS IN THE HELPER, NOT IN THE CALLER');
check('the helper owns the year check', /calendarForYear\(date\.getFullYear\(\)\)/.test(helper));
check('the old unguarded lookup is gone', !/f\.country === countryCode && f\.month === month && f\.day === day/.test(helper));

note('THE AGENT ROUTINE IS TOLD ABOUT FESTIVALS');
const routines = read('lib/agent/routines.ts');
check('the routine brief carries the calendar', /festivals: upcomingFestivals\(/.test(routines), 'the brief asked the agent to check a calendar nobody gave it');
check('the routine resolves the country the same way', /resolveCountry\(/.test(routines));

// ---------------------------------------------------------------------------
note('ONLY THE NAMED ACTIVE ACCOUNTS ARE BILLED');
check(
  'the pilot list is the owner’s ten accounts',
  DEFAULT_FESTIVAL_TENANTS.length === 10,
  DEFAULT_FESTIVAL_TENANTS.map((t) => t.label).join(', '),
);
for (const expected of ['Homcom Realtors', 'Bioque Estates', 'Pro Estate', 'Pro Color', 'GNR Homes', 'Bluesquareinfra', 'Khushi Ram Realtors', 'Red Rose City', 'Umang Associates']) {
  check(`  ${expected} is on the list`, DEFAULT_FESTIVAL_TENANTS.some((t) => t.label === expected));
}
check(
  'Raj Abhijna is on the list',
  DEFAULT_FESTIVAL_TENANTS.some((t) => /Raj Abhijna/i.test(t.label)),
  'labelled with Amritha Vana so the operator recognises it',
);
check(
  'every entry has a real user id',
  DEFAULT_FESTIVAL_TENANTS.every((t) => /^[0-9a-f-]{36}$/i.test(t.userId)),
  'a name-only entry would silently stop matching after a rename',
);
check(
  'a listed account is eligible by id',
  isFestivalAutomationEnabled({ userId: '68b55a31-a16d-454d-a20f-11adabf590b0', businessName: 'Bioque Estates International' }).enabled,
);
check(
  'a renamed listed account is still eligible by name',
  isFestivalAutomationEnabled({ userId: 'someone-new', businessName: 'homcom realtors pvt ltd' }).reason === 'listed_by_name',
);
check(
  'an unlisted tenant is refused, with a reason',
  (() => {
    const r = isFestivalAutomationEnabled({ userId: 'abc', businessName: 'Some Other Client' });
    return !r.enabled && r.reason === 'not_in_festival_allowlist';
  })(),
  'all 106 tenants have automation on, so "enabled" cannot mean "bill everyone"',
);
check('FESTIVAL_AUTOMATION_ALL=true opens it to everyone', isFestivalAutomationEnabled({ userId: 'x' }, DEFAULT_FESTIVAL_TENANTS, { all: true }).enabled);
check('ids are matched case-insensitively', isFestivalAutomationEnabled({ userId: '68B55A31-A16D-454D-A20F-11ADABF590B0' }).enabled);
check(
  'a short name fragment in env is ignored, not matched loosely',
  parseFestivalAllowlist('raj, umang').length === 1,
  'a 3-character fragment would match half the database',
);
check('an empty env keeps the pilot list', festivalAutomationConfig({}).source === 'default');
check('env ids replace the list', festivalAutomationConfig({ FESTIVAL_AUTOMATION_TENANTS: 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f' }).source === 'env_allowlist');
check('env all wins', festivalAutomationConfig({ FESTIVAL_AUTOMATION_ALL: 'true' }).all === true);
check(
  'a targeted single-tenant run always goes ahead',
  /all: festivalConfig\.all \|\| !!targetUserId/.test(route),
  'an operator asking for one client on purpose is not the automation',
);

// ---------------------------------------------------------------------------
note('SCHEDULING');
interface VercelCron { path: string; schedule: string }
const crons: VercelCron[] = Array.isArray(vercel.crons) ? (vercel.crons as VercelCron[]) : [];
const cronEntry = crons.find((c) => String(c.path).includes('festival'));
check('the festival cron is scheduled', !!cronEntry, cronEntry ? `${cronEntry.path} @ ${cronEntry.schedule}` : 'not in vercel.json');
const dailyCreative = crons.some((c) => String(c.path) === '/api/cron/auto-generate');
check('the daily-creative dispatcher is still scheduled', dailyCreative);
check(
  'it runs once a day, in the morning',
  !!cronEntry && /^\d{1,2} \d{1,2} \* \* \*$/.test(String(cronEntry.schedule)),
  'a festival is an all-day event; more than one run a day would only re-check the dedupe',
);
check('the route is wired to the allowlist module', /isFestivalAutomationEnabled\(/.test(route) && /festivalAutomationConfig\(/.test(route));
check('the response states who is allowed and who was skipped', /allowlist: \{/.test(route) && /not_in_festival_allowlist|skippedCount/.test(route));

// ---------------------------------------------------------------------------
note('THE QUERY THAT KILLED IT CANNOT COME BACK');
//
// The route selected `notification_email` from profiles. That column does not exist, so
// PostgREST rejected the whole select and the route 500'd before generating anything —
// the reason no festival creative has ever existed. Asserted against the column list in
// the source, because that is what the query is built from.
const profileSelect = /from\('profiles'\)\s*\n?\s*\.select\('([^']+)'\)/.exec(route.slice(route.indexOf('1. Fetch active profiles')))?.[1] || '';
check('the route selects an explicit column list', profileSelect.length > 0, profileSelect.slice(0, 70));
check(
  'and never selects notification_email from profiles',
  !/notification_email/.test(profileSelect),
  'it is not a column; it lives inside business_info',
);
check(
  'the notification address comes from the resolver that knows that',
  /resolveNotificationRecipients\(/.test(route) && /resolveNotificationRecipients\(profile\)\.toEmail/.test(route),
);

console.log('\n================================================================');
if (fail === 0) {
  console.log(`${pass} passed, 0 failed`);
  process.exit(0);
} else {
  console.log(`${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
