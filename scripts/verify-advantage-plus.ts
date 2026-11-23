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
import {
  LOCATION_TYPES,
  OPEN_AGE_RANGE,
  PLACEMENT_FIELDS,
  ageAndGenderTargeting,
  applyAdvantageTargeting,
  buildCampaignPayload,
  buildGeoLocations,
  describeAdvantagePlan,
  detectSpecialAdCategories,
  resolveAdvantagePlan,
} from '../lib/ads/advantage-plus';

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

console.log(`\nverify:advantage — ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFAILURES:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ location types, special ad categories, Advantage+ levers and payloads all agree with Meta’s publish rules');
