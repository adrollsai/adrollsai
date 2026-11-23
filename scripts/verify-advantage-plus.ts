/**
 * Gate: every campaign this platform launches must be publishable by Meta.
 *
 * Two live failures motivated this file, and both were invisible to the code
 * because the Graph API accepted the request:
 *
 *   1. Blue Square Infra's ad set 120247466552430424 is stuck WITH_ISSUES on
 *      "Advantage+ audience is unavailable for ads in this special ad category"
 *      (code 2909055) — a campaign in the HOUSING category that asked for
 *      Advantage+ audience cannot be published at all.
 *   2. Every ad set carried `location_types: ["home"]`, i.e. "People living in
 *      this location", which Meta removed from Ads Manager. The API still accepts
 *      it, so launches "succeeded" and then could not be edited or published in
 *      the UI.
 *
 * Run: npx tsx scripts/verify-advantage-plus.ts   (npm run verify:advantage)
 */
import fs from 'node:fs';

import {
  LOCATION_TYPES,
  OPEN_AGE_RANGE,
  PLACEMENT_FIELDS,
  ageAndGenderTargeting,
  applyAdvantageTargeting,
  attributionSpecFor,
  buildCampaignPayload,
  buildGeoLocations,
  creativeEnhancements,
  describeAdvantagePlan,
  detectSpecialAdCategories,
  resolveAdvantagePlan,
} from '../lib/ads/advantage-plus';
import {
  META_GRAPH_URL,
  META_GRAPH_VERSION,
  META_GRAPH_VERSION_HISTORY,
} from '../lib/ads/graph-version';
import {
  describePreflightFailure,
  validateAdSet,
  validateCampaign,
  validateOnly,
} from '../lib/ads/preflight';
import {
  CONNECTION_ALERT_DEDUPE_HOURS,
  CONNECTION_ALERT_TYPE,
  accountStatusLabel,
  diagnoseConnection,
} from '../lib/ads/token-health';
import {
  DUPLICATE_WINDOW_MS,
  duplicateLaunchMessage,
  duplicateRetargetingMessage,
  findDuplicateLaunch,
  findDuplicateRetargetingCampaign,
  launchFingerprint,
} from '../lib/ads/launch-idempotency';
import {
  checkCreative,
  readImageSize,
} from '../lib/ads/creative-checks';
import {
  normaliseStatus,
  summariseAdSet,
  summariseCampaign,
} from '../lib/ads/learning-phase';
import {
  ALERT_DEDUPE_HOURS,
  ALERT_TYPE,
  alertBody,
  alertTitle,
  alertUrl,
  collectBlockingIssues,
  describeCounts,
  groupByAccount,
  isBlockingStatus,
  issueSignature,
} from '../lib/ads/ad-review-monitor';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    return;
  }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected ${e}, got ${a}`);
};

const genderFn = (value: unknown) => {
  const v = String(value || '').toLowerCase();
  if (v === 'male') return [1];
  if (v === 'female') return [2];
  return null;
};

// ---------------------------------------------------------------------------
// 1. Location types: the removed option must never be sent, on any path
// ---------------------------------------------------------------------------
eq('LOCATION_TYPES is the surviving Meta combination', [...LOCATION_TYPES], ['home', 'recent']);

const noGeo = buildGeoLocations({});
eq('no locations at all falls back to a country', noGeo.geo_locations.countries, ['IN']);
eq('…and still uses the surviving location types', noGeo.geo_locations.location_types, ['home', 'recent']);
check('…and says nothing is wrong', noGeo.warnings.length === 0, JSON.stringify(noGeo.warnings));

const cityGeo = buildGeoLocations({ locations: [{ type: 'city', key: '1021145', radius: 25 }] });
eq('a city keeps its radius', (cityGeo.geo_locations.cities as any[])[0].radius, 25);
check('a city never ships alongside a country', cityGeo.geo_locations.countries === undefined);
eq('a city keeps the surviving location types', cityGeo.geo_locations.location_types, ['home', 'recent']);

const clampedLow = buildGeoLocations({ locations: [{ type: 'city', key: '1', radius: 3 }] });
eq('a radius below Meta’s floor is raised to 17km', (clampedLow.geo_locations.cities as any[])[0].radius, 17);
const clampedHigh = buildGeoLocations({ locations: [{ type: 'city', key: '1', radius: 900 }] });
eq('a radius above Meta’s ceiling is capped at 80km', (clampedHigh.geo_locations.cities as any[])[0].radius, 80);

const mixed = buildGeoLocations({
  locations: [
    { type: 'city', key: '1021145' },
    { type: 'country', country_code: 'IN' },
  ],
});
check('a country next to a city is dropped, not sent', mixed.geo_locations.countries === undefined);
check('…and the drop is explained (Meta error 1487756)', mixed.warnings.some((w) => w.includes('1487756')), JSON.stringify(mixed.warnings));

const badPin = buildGeoLocations({ pins: [{ latitude: 999, longitude: 10 }] });
eq('an impossible pin is ignored', badPin.geo_locations.custom_locations, undefined);
check('…and the pin is reported', badPin.warnings.length === 1, JSON.stringify(badPin.warnings));

const pinGeo = buildGeoLocations({ pins: [{ lat: 30.7333, lng: 76.7794, radius: 20 }] });
eq('a map pin becomes a custom location', (pinGeo.geo_locations.custom_locations as any[])[0].latitude, 30.7333);
eq('…with the surviving location types', pinGeo.geo_locations.location_types, ['home', 'recent']);

// every geo shape that can be produced carries the surviving types
for (const [label, geo] of [
  ['none', noGeo],
  ['city', cityGeo],
  ['pin', pinGeo],
  ['mixed', mixed],
] as const) {
  eq(`geo ${label}: never ["home"] alone`, (geo.geo_locations.location_types as string[]).includes('recent'), true);
}

// ---------------------------------------------------------------------------
// 2. Special ad category detection
// ---------------------------------------------------------------------------
eq('a property business is HOUSING', detectSpecialAdCategories({ industry: 'Real Estate' }).categories, ['HOUSING']);
eq('a builder is HOUSING', detectSpecialAdCategories({ industry: 'Property Developer' }).categories, ['HOUSING']);
eq('a recruiter is EMPLOYMENT', detectSpecialAdCategories({ industry: 'recruitment agency' }).categories, ['EMPLOYMENT']);
eq('a lender is CREDIT', detectSpecialAdCategories({ industry: 'home loans and mortgage' }).categories, ['CREDIT']);
eq('a dental clinic is in no special category', detectSpecialAdCategories({ industry: 'Dental Clinic' }).categories, []);
eq('an empty profile declares nothing', detectSpecialAdCategories({}).categories, []);
eq(
  'an explicit choice wins over detection',
  detectSpecialAdCategories({ industry: 'Dental Clinic', explicit: 'HOUSING' }).categories,
  ['HOUSING']
);
eq('NONE means no category', detectSpecialAdCategories({ explicit: 'NONE' }).categories, []);
eq('detection is reported back for the log', detectSpecialAdCategories({ industry: 'Real Estate' }).detectedFrom.length, 1);

// ---------------------------------------------------------------------------
// 3. The Advantage+ plan
// ---------------------------------------------------------------------------
const prospecting = resolveAdvantagePlan({ objective: 'OUTCOME_LEADS', industry: 'Real Estate' });
check('prospecting for a property business turns Advantage+ audience OFF', prospecting.advantageAudience === false);
eq('…because HOUSING is declared', prospecting.specialAdCategories, ['HOUSING']);
check('…and the reason names Meta’s own error', prospecting.reasons.some((r) => r.includes('2909055')), JSON.stringify(prospecting.reasons));
check('…and placements stay automated', prospecting.advantagePlacements === true);
check('…so it is not reported as a full Advantage+ campaign', prospecting.advantageState === null);

const generic = resolveAdvantagePlan({ objective: 'OUTCOME_LEADS', industry: 'Dental Clinic' });
check('a non-special vertical gets Advantage+ audience', generic.advantageAudience === true);
check('…and Advantage+ placements', generic.advantagePlacements === true);
check('…so Meta will report an Advantage+ campaign', generic.advantagePlus === true);
eq('…named for the objective', generic.advantageState, 'ADVANTAGE_PLUS_LEADS');
eq('…and no special category is declared', generic.specialAdCategories, []);

const sales = resolveAdvantagePlan({ objective: 'OUTCOME_SALES', industry: 'Dental Clinic' });
eq('sales campaigns report the sales Advantage+ state', sales.advantageState, 'ADVANTAGE_PLUS_SALES');

const retargeting = resolveAdvantagePlan({ objective: 'OUTCOME_LEADS', hasCustomAudience: true });
check('retargeting keeps Advantage+ audience off', retargeting.advantageAudience === false);
eq('…and pins audience expansion to 0', retargeting.relaxation, { custom_audience: 0, lookalike: 0, detailed_targeting: 0 });
check('…and says why', retargeting.reasons.some((r) => r.includes('saved audience')), JSON.stringify(retargeting.reasons));

const requestedButForbidden = resolveAdvantagePlan({
  objective: 'OUTCOME_LEADS',
  specialAdCategories: 'HOUSING',
  wantsAdvantageAudience: true,
});
check('asking for Advantage+ audience inside HOUSING is blocked, not obeyed', requestedButForbidden.advantageAudience === false);
check('…and the blocker is surfaced to the client', requestedButForbidden.blockers.some((b) => b.includes('2909055')));

const suggestions = resolveAdvantagePlan({
  objective: 'OUTCOME_LEADS',
  industry: 'Dental Clinic',
  hasAgeOrGender: true,
  hasDetailedTargeting: true,
});
eq('age/gender/interests become suggestions', suggestions.individualSetting, { age: 1, gender: 1, detailed_targeting: 1 });

const manualPlacements = resolveAdvantagePlan({
  objective: 'OUTCOME_LEADS',
  industry: 'Dental Clinic',
  wantsAdvantagePlacements: false,
});
check('a caller can keep manual placements', manualPlacements.advantagePlacements === false);
check('…which means no Advantage+ state', manualPlacements.advantageState === null);

// ---------------------------------------------------------------------------
// 4. Age and gender under a special ad category
// ---------------------------------------------------------------------------
const housingAges = ageAndGenderTargeting(prospecting, 30, 45, 'male', genderFn);
eq('HOUSING opens the age range to Meta’s own window', [housingAges.age_min, housingAges.age_max], [OPEN_AGE_RANGE.min, OPEN_AGE_RANGE.max]);
check('HOUSING drops gender targeting', housingAges.genders === null);

const manualAges = ageAndGenderTargeting(
  resolveAdvantagePlan({ objective: 'OUTCOME_LEADS', industry: 'Dental Clinic', wantsAdvantageAudience: false }),
  30,
  45,
  'male',
  genderFn
);
eq('a manual campaign keeps the chosen ages', [manualAges.age_min, manualAges.age_max], [30, 45]);
eq('…and the chosen gender', manualAges.genders, [1]);
const defaultAges = ageAndGenderTargeting(
  resolveAdvantagePlan({ objective: 'OUTCOME_LEADS', industry: 'Dental Clinic', wantsAdvantageAudience: false }),
  undefined,
  undefined,
  'all',
  genderFn
);
eq('unset ages open the whole window', [defaultAges.age_min, defaultAges.age_max], [18, 65]);
check('"all" sends no gender restriction', defaultAges.genders === null);

// Meta error 1870189: with Advantage+ audience on, the age ceiling may not be below 65.
const advAges = ageAndGenderTargeting(
  resolveAdvantagePlan({ objective: 'OUTCOME_LEADS', industry: 'Dental Clinic', hasAgeOrGender: true }),
  25,
  55,
  'male',
  genderFn
);
eq('Advantage+ audience raises the age ceiling to 65', [advAges.age_min, advAges.age_max], [25, 65]);
eq('…and keeps the picked gender', advAges.genders, [1]);

// ---------------------------------------------------------------------------
// 5. Payloads
// ---------------------------------------------------------------------------
const campaign = buildCampaignPayload({ name: 'Test', plan: generic, dailyBudget: 500, accessToken: 't' });
eq('the budget is at campaign level, in minor units', campaign.daily_budget, 50000);
eq('…with the cheapest bid strategy', campaign.bid_strategy, 'LOWEST_COST_WITHOUT_CAP');
eq('…and the objective from the plan', campaign.objective, 'OUTCOME_LEADS');
eq('a generic campaign declares no special category', campaign.special_ad_categories, []);
eq('the access token rides along', campaign.access_token, 't');

const housingCampaign = buildCampaignPayload({ name: 'Housing', plan: prospecting, dailyBudget: 200, accessToken: 't' });
eq('a property campaign declares HOUSING', housingCampaign.special_ad_categories, ['HOUSING']);
eq('…and still keeps the budget at campaign level', housingCampaign.daily_budget, 20000);

const advTargeting = applyAdvantageTargeting(
  { geo_locations: { countries: ['IN'] }, publisher_platforms: ['facebook'], device_platforms: ['mobile'], age_min: 18 },
  generic
);
for (const field of PLACEMENT_FIELDS) {
  check(`Advantage+ placements strip ${field}`, advTargeting[field] === undefined, JSON.stringify(advTargeting[field]));
}
eq('Advantage+ audience is switched on', advTargeting.targeting_automation.advantage_audience, 1);
eq('…and the geo keeps the surviving location types', advTargeting.geo_locations.location_types, ['home', 'recent']);
eq('…and the age survives', advTargeting.age_min, 18);

const housingTargeting = applyAdvantageTargeting({ geo_locations: { countries: ['IN'] } }, prospecting);
eq('a HOUSING ad set switches Advantage+ audience off', housingTargeting.targeting_automation.advantage_audience, 0);
eq('…and pins expansion to 0', housingTargeting.targeting_relaxation_types, { custom_audience: 0, lookalike: 0 });

const manualTargeting = applyAdvantageTargeting({ geo_locations: { countries: ['IN'] } }, manualPlacements);
eq('manual placements are restored when the lever is off', manualTargeting.publisher_platforms, ['facebook', 'instagram']);

// Meta error 1487079: an age_range cannot survive Advantage+ audience being switched off.
const withAgeRange = applyAdvantageTargeting(
  { geo_locations: { countries: ['IN'] }, age_range: [30, 65], age_min: 25 },
  prospecting
);
check('turning Advantage+ audience off drops age_range', withAgeRange.age_range === undefined, JSON.stringify(withAgeRange.age_range));
eq('…while keeping the plain age bounds', withAgeRange.age_min, 25);
const keptRange = applyAdvantageTargeting({ geo_locations: { countries: ['IN'] }, age_range: [30, 65] }, generic);
eq('Advantage+ on keeps age_range untouched', keptRange.age_range, [30, 65]);

// ---------------------------------------------------------------------------
// 6. What the client is told
// ---------------------------------------------------------------------------
const genericLine = describeAdvantagePlan(generic);
check('the summary names the Advantage+ campaign type', genericLine.includes('ADVANTAGE PLUS LEADS'), genericLine);
check('…the audience lever', genericLine.includes('Advantage+ audience ON'), genericLine);
check('…the placement lever', genericLine.includes('Advantage+ placements ON'), genericLine);
const housingLine = describeAdvantagePlan(prospecting);
check('a HOUSING summary says the audience is off', housingLine.includes('Advantage+ audience off'), housingLine);
check('…and names the category', housingLine.includes('HOUSING'), housingLine);

// ---------------------------------------------------------------------------
// 7. The invariant that caused the live failure
// ---------------------------------------------------------------------------
for (const plan of [prospecting, generic, retargeting, requestedButForbidden, suggestions, manualPlacements]) {
  const t = applyAdvantageTargeting({ geo_locations: { countries: ['IN'] }, publisher_platforms: ['facebook'] }, plan);
  const types = t.geo_locations.location_types as string[];
  check(`never "home" alone for ${describeAdvantagePlan(plan)}`, !(types.length === 1 && types[0] === 'home'), JSON.stringify(types));
  const forbidden = plan.specialAdCategories.length > 0 && t.targeting_automation.advantage_audience === 1;
  check(`never Advantage+ audience inside a special category for ${describeAdvantagePlan(plan)}`, !forbidden);
}

// ---------------------------------------------------------------------------
// 8. One Graph version for the ads surface
// ---------------------------------------------------------------------------
eq('the launcher builds its URLs from one version constant', META_GRAPH_URL, `https://graph.facebook.com/${META_GRAPH_VERSION}`);
check('the version is not a retired one', META_GRAPH_VERSION >= 'v22.0', META_GRAPH_VERSION);
check('the history records what was in use before', META_GRAPH_VERSION_HISTORY.length >= 2);
check(
  'the processor imports the constant rather than pinning a string',
  /from '@\/lib\/ads\/graph-version'/.test(fs.readFileSync('utils/campaign-processor.ts', 'utf8'))
);
check(
  'no ads route still pins its own version',
  !/graph\.facebook\.com\/v\d\d\.0/.test(fs.readFileSync('utils/campaign-processor.ts', 'utf8'))
);

// ---------------------------------------------------------------------------
// 9. Attribution asked for explicitly
// ---------------------------------------------------------------------------
eq('a lead campaign asks for 1-day click', attributionSpecFor('OUTCOME_LEADS'), [
  { event_type: 'CLICK_THROUGH', window_days: 1 },
]);
eq('a messaging campaign does too', attributionSpecFor('OUTCOME_ENGAGEMENT'), [
  { event_type: 'CLICK_THROUGH', window_days: 1 },
]);
check('a sales campaign keeps Meta default', attributionSpecFor('OUTCOME_SALES') === null);
check(
  'no lead-style window longer than a day is ever sent (Meta rejects it)',
  (attributionSpecFor('OUTCOME_LEADS') || []).every((s) => s.window_days <= 1)
);

// ---------------------------------------------------------------------------
// 10. Advantage+ creative, in the shape v22+ accepts
// ---------------------------------------------------------------------------
const enhancements = creativeEnhancements() as any;
const featureSpec = enhancements.creative_features_spec;
check('enhancements ride in degrees_of_freedom_spec', Boolean(enhancements.creative_features_spec));
check(
  'the deprecated standard_enhancements key is never sent (v22+ rejects it, 3858504)',
  featureSpec.standard_enhancements === undefined
);
eq('the catalog bundle is enrolled instead', featureSpec.STANDARD_ENHANCEMENTS_CATALOG, { enroll_status: 'OPT_IN' });

// ---------------------------------------------------------------------------
// 11. Pre-flight: ask before creating
// ---------------------------------------------------------------------------
const fakeOk = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;
const okResult = await validateOnly('act_1/campaigns', { name: 'x', access_token: 'secret' }, 'token', fakeOk);
check('a clean payload passes pre-flight', okResult.ok === true);
check('the access token never lands in the recorded payload', okResult.sent.access_token === undefined);

const fakeBad = (async () =>
  new Response(
    JSON.stringify({
      error: { code: 100, error_subcode: 2446375, error_user_title: 'Budget is too small', error_user_msg: "This campaign's budget is too small." },
    }),
    { status: 400 }
  )) as unknown as typeof fetch;
const badResult = await validateOnly('act_1/campaigns', { daily_budget: '500' }, 'token', fakeBad);
check('a rejected payload fails pre-flight', badResult.ok === false);
eq('the subcode is preserved', badResult.error?.subcode, 2446375);
const failureLine = describePreflightFailure(badResult, 'campaign');
check('the failure sentence names the object', failureLine.includes('campaign'), failureLine);
check('…and carries Meta’s own words', failureLine.includes('budget is too small'), failureLine);
check('…and the code', failureLine.includes('2446375'), failureLine);

const fakeNetwork = (async () => {
  throw new Error('ECONNRESET');
}) as unknown as typeof fetch;
const netResult = await validateAdSet('act_1/adsets', { name: 'x' }, 'token', fakeNetwork);
check('a network failure is reported as a failure, not as "fine"', netResult.ok === false);
check('…and says so', String(netResult.error?.message).includes('Could not reach Meta'), String(netResult.error?.message));

// The launcher must use it, and must use it for both objects.
const processor = fs.readFileSync('utils/campaign-processor.ts', 'utf8');
check('the launcher pre-flights the campaign', processor.includes('validateCampaign('));
check('the launcher pre-flights the ad set', processor.includes('validateAdSet('));
check('the pre-flight runs BEFORE the campaign is created', processor.indexOf('validateCampaign(') < processor.indexOf('campaigns`, {'));
check('a failed ad-set pre-flight archives the empty campaign', /adSetPreflight[\s\S]{0,600}ARCHIVED/.test(processor));

// ---------------------------------------------------------------------------
// 12. Ad-review monitoring
// ---------------------------------------------------------------------------
check('WITH_ISSUES is a blocking status', isBlockingStatus('WITH_ISSUES'));
check('DISAPPROVED is a blocking status', isBlockingStatus('DISAPPROVED'));
check('ACTIVE is not', !isBlockingStatus('ACTIVE'));
check('an empty status is not', !isBlockingStatus(undefined));

const objects = [
  {
    edge: 'adsets' as const,
    id: 'as1',
    name: 'Anmol Plotting Whatsapp ad set',
    effective_status: 'WITH_ISSUES',
    issues_info: [
      {
        error_code: 2909055,
        error_summary: 'Advantage+ audience is not available',
        error_message: 'Advantage+ audience is unavailable for ads in this special ad category.',
      },
    ],
  },
  {
    edge: 'ads' as const,
    id: 'ad1',
    name: 'AI Optimized Ad - Image',
    effective_status: 'DISAPPROVED',
    issues_info: [{ error_code: 1487891, error_summary: 'Invalid creative for objective' }],
  },
  {
    edge: 'campaigns' as const,
    id: 'c-active',
    name: 'Healthy campaign',
    effective_status: 'ACTIVE',
    // An advisory issue on a healthy object must NOT alert.
    issues_info: [{ error_code: 1, error_summary: 'Routine suggestion' }],
  },
  { edge: 'campaigns' as const, id: 'c-silent', name: 'Blocked, no detail', effective_status: 'WITH_ISSUES' },
];

const issueList = collectBlockingIssues(objects);
eq('only blocked objects are collected', issueList.length, 3);
check('a healthy object with advice is ignored', !issueList.some((i) => i.id === 'c-active'));
check('a blocked object with no detail still surfaces', issueList.some((i) => i.id === 'c-silent'));
eq('the first issue carries Meta’s code', issueList[0].code, '2909055');
eq('issue keys are stable per object+code', issueList[0].key, 'adsets:as1:2909055');
eq('duplicate rows collapse', collectBlockingIssues([objects[0], objects[0]]).length, 1);

const title = alertTitle(issueList);
check('the alert title names the object', title.includes('ad set'), title);
check('…and is short enough for a notification', title.length <= 90, `${title.length} chars`);
const body = alertBody(issueList);
check('the body carries the summary', body.includes('Advantage+ audience is not available'), body);
check('…the code', body.includes('2909055'), body);
check('…and counts the rest', /ad\b/.test(body), body);
check('the deep link points at the ads dashboard', alertUrl() === '/dashboard/ads');
eq('the notification type is the ads failure category', ALERT_TYPE, 'campaign_failure');
check('the de-dupe window is measured in hours', ALERT_DEDUPE_HOURS >= 1 && ALERT_DEDUPE_HOURS <= 24);
eq('the signature ignores order', issueSignature([issueList[1], issueList[0]]), issueSignature([issueList[0], issueList[1]]));
check('the signature changes when a new problem appears', issueSignature(issueList) !== issueSignature([issueList[0]]));
eq('counts read like prose', describeCounts([issueList[0], issueList[1]]), '1 ad set and 1 ad');

const grouped = groupByAccount(issueList, (edge, id) => (id === 'as1' ? 'acct-a' : 'acct-b'));
eq('issues are grouped per account', grouped.size, 2);
eq('…without losing any', [...grouped.values()].flat().length, 3);

const cronRoute = fs.readFileSync('app/api/cron/meta-ad-issues/route.ts', 'utf8');
check('the watchdog cron exists and reads issues_info', cronRoute.includes('issues_info'));
check('…asks Meta only for blocked objects', cronRoute.includes("'WITH_ISSUES', 'DISAPPROVED'"));
check('…de-duplicates before notifying', cronRoute.includes('recentlyAlerted'));
check(
  '…checks the connection before reading the objects',
  cronRoute.indexOf('await probeConnection(') < cronRoute.indexOf('await fetchIssues('),
  `probe at ${cronRoute.indexOf('await probeConnection(')}, fetch at ${cronRoute.indexOf('await fetchIssues(')}`
);
check('…and is registered in vercel.json', fs.readFileSync('vercel.json', 'utf8').includes('/api/cron/meta-ad-issues'));

// ---------------------------------------------------------------------------
// 13. Token health: the owner is told what is wrong, in words they can act on
// ---------------------------------------------------------------------------
const invalidated = diagnoseConnection({
  ok: false,
  code: 190,
  subcode: 460,
  message: 'Error validating access token: The session has been invalidated because the user changed their password.',
});
eq('an invalidated session is a token problem', invalidated.verdict, 'token_invalid');
check('…which needs action', invalidated.needsAction === true);
check('…says reconnect', /reconnect/i.test(invalidated.body), invalidated.body);
check('…and says existing campaigns keep running', /keep running/i.test(invalidated.body), invalidated.body);
check('…with a stable de-dupe key', invalidated.key === 'token_invalid');

const expired = diagnoseConnection({ ok: false, code: 190, message: 'Session has expired' });
eq('an expired token is its own verdict', expired.verdict, 'token_expired');

const perms = diagnoseConnection({ ok: false, code: 200, message: 'Permissions error' });
eq('a permission failure is named as one', perms.verdict, 'missing_permission');
check('…and points at ads access', /ads access|Business admin/i.test(perms.body), perms.body);

const ineligible = diagnoseConnection({ ok: true, accountStatus: 2 });
eq('a disabled ad account is caught on a healthy token', ineligible.verdict, 'account_ineligible');
check('…naming the status', /disabled/i.test(ineligible.title), ineligible.title);
const unsettled = diagnoseConnection({ ok: true, accountStatus: 3 });
eq('an unsettled balance is caught too', unsettled.verdict, 'account_unsettled');
const active = diagnoseConnection({ ok: true, accountStatus: 1 });
eq('a healthy account needs nothing', active.verdict, 'healthy');
check('…and produces no message', active.title === '' && active.needsAction === false);

const unreachable = diagnoseConnection({ ok: false, message: 'ECONNRESET', httpStatus: 502 });
eq('a network failure is not mistaken for a bad token', unreachable.verdict, 'unreachable');
check('…and says it is probably temporary', /temporary/i.test(unreachable.body), unreachable.body);

const launcherRoute = fs.readFileSync('app/api/meta-ads/launch-campaign/route.ts', 'utf8');
check('the launcher checks the connection before launching', launcherRoute.includes('diagnoseConnection'));
check('…and refunds the credit when it refuses', /diagnoseConnection[\s\S]{0,1200}refundLimit/.test(launcherRoute));

// ---------------------------------------------------------------------------
// 14. Double-launch guard
// ---------------------------------------------------------------------------
const baseFingerprint = launchFingerprint({
  targetUserId: 'user-1',
  campaignName: 'Diwali Launch',
  campaignType: 'instant_form',
  campaignGoal: 'leads',
  dailyBudget: 500,
  pageId: 'page-1',
  adAccountId: 'act_1',
  creativeKeys: ['asset-b', 'asset-a'],
  locations: '[{"key":"1021145"}]',
});
const sameLaunch = launchFingerprint({
  targetUserId: 'user-1',
  campaignName: 'diwali launch ',
  campaignType: 'instant_form',
  campaignGoal: 'leads',
  dailyBudget: '500.00',
  pageId: 'page-1',
  adAccountId: 'act_1',
  // same creatives, different order
  creativeKeys: ['asset-a', 'asset-b'],
  locations: '[{"key":"1021145"}]',
});
check('the same launch fingerprints the same', baseFingerprint === sameLaunch, `${baseFingerprint} vs ${sameLaunch}`);
check(
  'a different budget is a different launch',
  baseFingerprint !==
    launchFingerprint({
      targetUserId: 'user-1',
      campaignName: 'Diwali Launch',
      campaignType: 'instant_form',
      campaignGoal: 'leads',
      dailyBudget: 800,
      pageId: 'page-1',
      adAccountId: 'act_1',
      creativeKeys: ['asset-a', 'asset-b'],
    })
);
check(
  'one more creative is a different launch',
  baseFingerprint !==
    launchFingerprint({
      targetUserId: 'user-1',
      campaignName: 'Diwali Launch',
      campaignType: 'instant_form',
      campaignGoal: 'leads',
      dailyBudget: 500,
      pageId: 'page-1',
      adAccountId: 'act_1',
      creativeKeys: ['asset-a', 'asset-b', 'asset-c'],
    })
);
check(
  'another tenant never collides',
  baseFingerprint !==
    launchFingerprint({
      targetUserId: 'user-2',
      campaignName: 'Diwali Launch',
      campaignType: 'instant_form',
      campaignGoal: 'leads',
      dailyBudget: 500,
      pageId: 'page-1',
      adAccountId: 'act_1',
      creativeKeys: ['asset-a', 'asset-b'],
    })
);

const now = Date.parse('2026-11-23T10:00:00Z');
const recent = [
  { jobId: 'job-new', fingerprint: baseFingerprint, createdAt: '2026-11-23T09:58:00Z', status: 'processing' },
];
check('a launch two minutes ago is a duplicate', findDuplicateLaunch(baseFingerprint, recent, now)?.jobId === 'job-new');
const old = [{ jobId: 'job-old', fingerprint: baseFingerprint, createdAt: '2026-11-23T09:00:00Z', status: 'completed' }];
check('a launch an hour ago is not', findDuplicateLaunch(baseFingerprint, old, now) === null);
const failed = [{ jobId: 'job-failed', fingerprint: baseFingerprint, createdAt: '2026-11-23T09:59:00Z', status: 'failed' }];
check('a failed attempt does not block the retry', findDuplicateLaunch(baseFingerprint, failed, now) === null);
const otherTenant = [{ jobId: 'j2', fingerprint: 'different', createdAt: '2026-11-23T09:59:00Z', status: 'pending' }];
check('an unrelated launch is not', findDuplicateLaunch(baseFingerprint, otherTenant, now) === null);
check('the duplicate message names the existing job', duplicateLaunchMessage('abcdef123456').includes('abcdef12'));
check('…and explains how to launch a separate campaign', /budget|creative|locations/i.test(duplicateLaunchMessage('abcdef123456')));

check('the launcher computes a fingerprint before inserting the job', /launchFingerprint\(/.test(launcherRoute));
check('…stores it on the job payload', launcherRoute.includes('_fingerprint'));
check('…and refuses the duplicate', /duplicateJobId[\s\S]{0,400}duplicate: true/.test(launcherRoute));

// ---------------------------------------------------------------------------
// 15. Nothing on the ads + Facebook surface pins its own Graph version
// ---------------------------------------------------------------------------
const versionSweepFiles: string[] = [];
const walkTs = (dir: string) => {
  for (const name of fs.readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (fs.statSync(full).isDirectory()) walkTs(full);
    else if (full.endsWith('.ts')) versionSweepFiles.push(full);
  }
};
walkTs('app/api/meta-ads');
versionSweepFiles.push(
  'utils/campaign-processor.ts',
  'lib/agent/mcp/meta-ads-mcp.ts',
  'lib/agent/mcp/meta-graph.ts',
  'app/api/agent/route.ts',
  'app/api/analytics/ai/route.ts',
  'app/api/background-worker/route.ts',
  'app/api/cron/analyze-campaigns/route.ts',
  'app/api/cron/meta-warmup/route.ts',
  'app/api/facebook/pages/route.ts',
  'app/api/facebook/forms/route.ts'
);
const offenders = versionSweepFiles.filter((file) => {
  if (!fs.existsSync(file)) return false;
  return /graph\.facebook\.com\/v\d\d\.0/.test(fs.readFileSync(file, 'utf8'));
});
eq('no ads or Facebook route pins its own Graph version', offenders, []);
// WhatsApp keeps its own version on purpose: different product, different track.
const waStillVersioned = fs.readFileSync('app/api/cron/whatsapp-followup/route.ts', 'utf8').includes('graph.facebook.com/v');
check('…while the WhatsApp surface stays on its own version deliberately', waStillVersioned);

// ---------------------------------------------------------------------------
// 16. Creative pre-checks: read the header before Meta sees the file
// ---------------------------------------------------------------------------
const pngOf = (w: number, h: number) => {
  const buf = new Uint8Array(32);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(buf.buffer).setUint32(16, w, false);
  new DataView(buf.buffer).setUint32(20, h, false);
  return buf;
};
const jpegOf = (w: number, h: number) => {
  const buf = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const view = new DataView(buf.buffer);
  view.setUint16(7, h, false);
  view.setUint16(9, w, false);
  return buf;
};
const gifOf = (w: number, h: number) => {
  const buf = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0x00, 0x00, 0x00, 0x3b]);
  const view = new DataView(buf.buffer);
  view.setUint16(6, w, true);
  view.setUint16(8, h, true);
  return buf;
};
const webpOf = (w: number, h: number) => {
  const buf = new Uint8Array(40);
  buf.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0);
  const wm = w - 1;
  const hm = h - 1;
  buf[24] = wm & 0xff;
  buf[25] = (wm >> 8) & 0xff;
  buf[26] = (wm >> 16) & 0xff;
  buf[27] = hm & 0xff;
  buf[28] = (hm >> 8) & 0xff;
  buf[29] = (hm >> 16) & 0xff;
  return buf;
};

const jpegSize = readImageSize(jpegOf(1080, 1350));
eq('reads a JPEG header', jpegSize && { format: jpegSize.format, width: jpegSize.width, height: jpegSize.height }, {
  format: 'jpeg',
  width: 1080,
  height: 1350,
});
const gifSize = readImageSize(gifOf(600, 600));
eq('reads a GIF header', gifSize && { format: gifSize.format, width: gifSize.width, height: gifSize.height }, {
  format: 'gif',
  width: 600,
  height: 600,
});
const webpSize = readImageSize(webpOf(1080, 1920));
eq('reads a WebP (VP8X) header', webpSize && { format: webpSize.format, width: webpSize.width, height: webpSize.height }, {
  format: 'webp',
  width: 1080,
  height: 1920,
});
const pngSize = readImageSize(pngOf(1200, 628));
eq('reads a PNG header', pngSize && { format: pngSize.format, width: pngSize.width, height: pngSize.height }, {
  format: 'png',
  width: 1200,
  height: 628,
});
check('a video is not mistaken for an image', readImageSize(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])) === null);
check('truncated bytes are not mistaken for an image', readImageSize(new Uint8Array([0x89, 0x50])) === null);

const goodFeed = checkCreative({ kind: 'image', width: 1080, height: 1080, bytes: 400_000 });
eq('a 1080 square is clean', goodFeed.level, 'ok');
check('…and is not blocked', goodFeed.blocked === false);
check('…and names its placements', goodFeed.placements.includes('feed (square)'), JSON.stringify(goodFeed.placements));

const wide = checkCreative({ kind: 'image', width: 2000, height: 500, bytes: 400_000 });
eq('a 4:1 banner warns rather than blocks', wide.level, 'warning');
check('…saying the sides will be cropped', wide.issues.some((i) => i.code === 'too_wide'), JSON.stringify(wide.issues));
const tiny = checkCreative({ kind: 'image', width: 150, height: 150 });
eq('a 150px image is blocked', tiny.blocked, true);
check('…because no placement can serve it', tiny.issues.some((i) => i.code === 'unusable'), JSON.stringify(tiny.issues));
const small = checkCreative({ kind: 'image', width: 320, height: 320 });
eq('a 320px image only warns', small.level, 'warning');
check('…and is not blocked', small.blocked === false);
const heavy = checkCreative({ kind: 'image', width: 1080, height: 1080, bytes: 40 * 1024 * 1024 });
eq('a 40MB image is blocked', heavy.blocked, true);
const story = checkCreative({ kind: 'image', width: 1080, height: 1920 });
check('a 9:16 creative is recognised for stories', story.placements.some((p) => p.includes('stories')), JSON.stringify(story.placements));
const unknown = checkCreative({ kind: 'image', sizeUnknown: true });
eq('unreadable dimensions never block a launch', unknown.blocked, false);
check('…but are reported', unknown.level === 'warning' && unknown.issues[0].code === 'size_unknown');
const videoCheck = checkCreative({ kind: 'video', width: 1080, height: 1920, bytes: 5_000_000 });
check('a 9:16 video is fine', videoCheck.blocked === false);
check('…and is recognised as story-shaped', videoCheck.placements.some((p) => p.includes('stories')), JSON.stringify(videoCheck.placements));

// The launcher must actually use it, before the upload.
const processorSource = fs.readFileSync('utils/campaign-processor.ts', 'utf8');
check('the launcher inspects each image before uploading', processorSource.includes('inspectRemoteImage('));
check('…before the adimages upload', processorSource.indexOf('inspectRemoteImage(') < processorSource.indexOf('/adimages'));
check('…and refuses a creative Meta is certain to reject', /check\.blocked[\s\S]{0,200}throw new Error/.test(processorSource));
check('…and reports the ones that only serve in fewer placements', processorSource.includes('creativeWarnings'));

// ---------------------------------------------------------------------------
// 17. Learning phase: is the number stable enough to act on?
// ---------------------------------------------------------------------------
eq('IN_LEARNING is provisional', summariseAdSet({ id: 'a', learning_stage_info: { status: 'IN_LEARNING' } }).provisional, true);
check(
  '…and says editing restarts the clock',
  /restarts the learning phase/i.test(summariseAdSet({ id: 'a', learning_stage_info: { status: 'IN_LEARNING' } }).advice)
);
const limited = summariseAdSet({ id: 'a', learning_stage_info: { status: 'LEARNING_LIMITED' } });
eq('LEARNING_LIMITED is its own verdict', limited.status, 'LEARNING_LIMITED');
check('…with advice about budget/audience, not more edits', /raise the budget|widen the audience/i.test(limited.advice), limited.advice);
const done = summariseAdSet({ id: 'a', learning_stage_info: { status: 'SUCCESS', conversions: 50 } });
eq('SUCCESS is not provisional', done.provisional, false);
eq('…and keeps Meta’s conversion count', done.conversions, 50);
eq('a missing stage is UNKNOWN and still provisional', summariseAdSet({ id: 'a' }).status, 'UNKNOWN');
eq('an unknown string is normalised to UNKNOWN', normaliseStatus('something-else'), 'UNKNOWN');
eq('a hyphenated value still parses', normaliseStatus('in-learning'), 'IN_LEARNING');

const campaignLearning = summariseCampaign([
  { id: 'a1', name: 'Set A', learning_stage_info: { status: 'SUCCESS' } },
  { id: 'a2', name: 'Set B', learning_stage_info: { status: 'IN_LEARNING' } },
]);
eq('one learning ad set makes the campaign provisional', campaignLearning.campaign.provisional, true);
eq('…and the counts add up', campaignLearning.counts.inLearning, 1);
eq('…and the campaign says how many', campaignLearning.adSets.length, 2);
const allLimited = summariseCampaign([
  { id: 'x', learning_stage_info: { status: 'LEARNING_LIMITED' } },
  { id: 'y', learning_stage_info: { status: 'LEARNING_LIMITED' } },
]);
eq('all-limited is reported as learning-limited', allLimited.campaign.status, 'LEARNING_LIMITED');
const emptyCampaign = summariseCampaign([]);
eq('a campaign with no ad sets is unknown, not an error', emptyCampaign.campaign.status, 'UNKNOWN');
check(
  'the learning endpoint exists and reads learning_stage_info',
  fs.existsSync('app/api/meta-ads/learning-status/route.ts') &&
    fs.readFileSync('app/api/meta-ads/learning-status/route.ts', 'utf8').includes('learning_stage_info')
);

// ---------------------------------------------------------------------------
// 18. Retargeting launches get the same duplicate guard
// ---------------------------------------------------------------------------
const retargetingRows = [
  { id: '1201', name: 'Acme - Retargeting (Retargetting) - Villa - 2026-11-23 - 1234', created_time: '2026-11-23T10:00:00+0530', daily_budget: '50000' },
  { id: '1200', name: 'Acme - Retargeting (Retargetting) - Other - 2026-11-20 - 9999', created_time: '2026-11-20T10:00:00+0530', daily_budget: '50000' },
];
const dup = findDuplicateRetargetingCampaign(retargetingRows, {
  namePrefix: 'Acme - Retargeting (Retargetting)',
  dailyBudgetMinor: 50000,
  now: Date.parse('2026-11-23T04:35:00Z'),
  windowMs: 10 * 60 * 1000,
});
eq('a retargeting campaign created minutes ago is a duplicate', dup?.id, '1201');
const notDupBudget = findDuplicateRetargetingCampaign(retargetingRows, {
  namePrefix: 'Acme - Retargeting (Retargetting)',
  dailyBudgetMinor: 90000,
  now: Date.parse('2026-11-23T04:35:00Z'),
});
check('a different budget is a new campaign', notDupBudget === null);
const notDupTime = findDuplicateRetargetingCampaign(retargetingRows, {
  namePrefix: 'Acme - Retargeting (Retargetting)',
  dailyBudgetMinor: 50000,
  now: Date.parse('2026-11-23T09:00:00Z'),
});
check('an old campaign is not a duplicate', notDupTime === null);
check('a different business never matches', findDuplicateRetargetingCampaign(retargetingRows, { namePrefix: 'Other Co - Retargeting', dailyBudgetMinor: 50000 }) === null);
check('an empty prefix matches nothing', findDuplicateRetargetingCampaign(retargetingRows, { namePrefix: '  ', dailyBudgetMinor: 50000 }) === null);
check('the retargeting message names the campaign', duplicateRetargetingMessage('120344').includes('120344'));
const remarketingSource = fs.readFileSync('app/api/meta-ads/launch-remarketing/route.ts', 'utf8');
check('the retargeting launcher checks before creating', remarketingSource.includes('findDuplicateRetargetingCampaign'));
check('…and refunds the credit when it refuses', /duplicate[\s\S]{0,400}refundLimit/.test(remarketingSource));

console.log(`\nverify:advantage — ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ location types, special ad categories, Advantage+ levers and payloads all agree with Meta’s publish rules');
