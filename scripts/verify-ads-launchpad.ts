/**
 * Is the ads launchpad honest about what it will build?
 *
 * Three things this locks down, because each of them was quietly wrong:
 *   1. The instant form used to ask Name + Phone + EMAIL and skip City. The default is now
 *      Name + WhatsApp Number + City, it is a choice the client can change, and the field
 *      list survives the trip from the modal to Meta.
 *   2. The campaign goal (objective + ad-set optimisation) was re-derived in the processor
 *      and unreachable from the UI, so "optimise for conversions" could not be picked.
 *   3. The gender dropdown was collected, sent, and never applied.
 *
 * Half of this file checks the pure planner with fixtures; the other half reads the source
 * to prove the planner is actually wired to the three places that matter (modal, route,
 * processor). A correct plan that nobody calls is the failure mode these wiring checks exist
 * for.
 *
 *   npx esbuild scripts/verify-ads-launchpad.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-ads.mjs && node .tmp-ads.mjs
 */
import fs from 'node:fs';

import {
  DEFAULT_LEAD_FORM_FIELDS,
  LEAD_FORM_FIELDS,
  buildStandardQuestions,
  describeLeadFormFields,
  genderTargeting,
  goalForCampaignType,
  leadFormField,
  normaliseConversionEvent,
  normaliseLeadFormFields,
  resolveCampaignPlan,
} from '../lib/ads/campaign-plan';
// The gender decision now lives in a pure helper, because a special ad category and Advantage+
// audience each override it. The wiring check below proves it is called; the behaviour block after
// it proves the helper is right, which a source grep never could.
import {
  SPECIAL_AD_CATEGORIES,
  ageAndGenderTargeting,
  detectSpecialAdCategories,
  OPEN_AGE_RANGE,
  type AdvantagePlan,
} from '../lib/ads/advantage-plus';
import { classifyMetaError, describeMetaError } from '../lib/ads/graph-error';

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

const read = (p: string) => fs.readFileSync(p, 'utf8');
const modal = read('app/dashboard/ads/page.tsx');
const route = read('app/api/meta-ads/launch-campaign/route.ts');
const remarketing = read('app/api/meta-ads/launch-remarketing/route.ts');
const processor = read('utils/campaign-processor.ts');

// ---------------------------------------------------------------------------
console.log('▸ THE DEFAULT FORM ASKS FOR WHAT THE CRM NEEDS');
const defaults = normaliseLeadFormFields(DEFAULT_LEAD_FORM_FIELDS);
check('the default is exactly three fields', defaults.length === 3, defaults.join(', '));
check('it asks for the full name', defaults.includes('FULL_NAME'));
check('it asks for the phone/WhatsApp number', defaults.includes('PHONE'));
check('it asks for the city', defaults.includes('CITY'));
check('and it does NOT ask for an email', !defaults.includes('EMAIL'), 'email was the biggest drop-off on an Indian instant form');
check(
  'the phone field is presented as the WhatsApp number',
  leadFormField('PHONE')?.label === 'WhatsApp Number',
  `UI label "${leadFormField('PHONE')?.label}" vs Meta's "${leadFormField('PHONE')?.metaLabel}"`,
);
check(
  'the UI is honest that Meta calls it "Phone number"',
  /Phone number/i.test(leadFormField('PHONE')?.metaLabel || ''),
  leadFormField('PHONE')?.hint?.slice(0, 60),
);

console.log('\n▸ THE FIELD LIST IS THE CLIENT’S, AND IT IS SAFE');
check('an empty choice falls back to the defaults', normaliseLeadFormFields([]).join(',') === defaults.join(','));
check('a null choice falls back too', normaliseLeadFormFields(null).join(',') === defaults.join(','));
check('unknown ids are dropped', normaliseLeadFormFields(['FULL_NAME', 'NIYAH', 'CITY']).join(',') === 'FULL_NAME,CITY');
check('duplicates are dropped', normaliseLeadFormFields(['CITY', 'CITY', 'PHONE']).join(',') === 'CITY,PHONE');
check('lowercase ids are accepted', normaliseLeadFormFields(['phone', 'city']).join(',') === 'PHONE,CITY');
check('the list is capped', normaliseLeadFormFields(LEAD_FORM_FIELDS.map((f) => f.id)).length <= 8);
check('re-ordering is preserved', normaliseLeadFormFields(['CITY', 'FULL_NAME']).join(',') === 'CITY,FULL_NAME');

const questions = buildStandardQuestions(DEFAULT_LEAD_FORM_FIELDS);
check('every Meta question carries a type and a key', questions.every((q) => !!q.type && !!q.key));
check(
  'the Meta payload is the canonical one',
  JSON.stringify(questions) ===
    JSON.stringify([
      { type: 'FULL_NAME', key: 'full_name' },
      { type: 'PHONE', key: 'phone_number' },
      { type: 'CITY', key: 'city' },
    ]),
  JSON.stringify(questions),
);
check('the form name states the real fields', /Full Name, WhatsApp Number, City/.test(describeLeadFormFields(DEFAULT_LEAD_FORM_FIELDS)), describeLeadFormFields(DEFAULT_LEAD_FORM_FIELDS));

// ---------------------------------------------------------------------------
console.log('\n▸ THE GOAL DECIDES OBJECTIVE, DESTINATION AND OPTIMISATION');
const leads = resolveCampaignPlan({ campaignType: 'instant_form', campaignGoal: 'leads' });
check('Leads → OUTCOME_LEADS on an instant form', leads.objective === 'OUTCOME_LEADS' && leads.destinationType === 'ON_AD');
check('Leads optimises for lead volume', leads.optimizationGoal === 'LEAD_GENERATION');
check('Leads requires a lead form', leads.requiresLeadForm === true);

const quality = resolveCampaignPlan({ campaignType: 'instant_form', campaignGoal: 'quality_leads' });
check('High-intent leads optimises for quality', quality.optimizationGoal === 'QUALITY_LEAD');
check('it stays on the instant form', quality.destinationType === 'ON_AD' && quality.requiresLeadForm === true);
check(
  'the legacy optimizeForConversions flag still means "quality"',
  resolveCampaignPlan({ campaignType: 'instant_form', optimizeForConversions: true }).goal === 'quality_leads',
);

const conv = resolveCampaignPlan({ campaignType: 'website_conversion', campaignGoal: 'conversions', conversionEvent: 'PURCHASE' });
check('Conversions → a website destination', conv.destinationType === 'WEBSITE');
check('Conversions optimises for offsite conversions', conv.optimizationGoal === 'OFFSITE_CONVERSIONS');
check('the chosen conversion event is carried', conv.conversionEvent === 'PURCHASE', String(conv.conversionEvent));
check('Conversions requires a pixel', conv.requiresPixel === true);
check('Conversions does not create a lead form', conv.requiresLeadForm === false);
check(
  'an unknown conversion event falls back to LEAD',
  resolveCampaignPlan({ campaignType: 'website_conversion', conversionEvent: 'BUY_STUFF' }).conversionEvent === 'LEAD',
);
check('no conversion event means LEAD', normaliseConversionEvent(undefined) === 'LEAD');
check('lowercase events are normalised', normaliseConversionEvent('schedule') === 'SCHEDULE');

const wa = resolveCampaignPlan({ campaignType: 'whatsapp_chat' });
check('WhatsApp → OUTCOME_ENGAGEMENT', wa.objective === 'OUTCOME_ENGAGEMENT');
check('WhatsApp → a WHATSAPP destination optimising replies', wa.destinationType === 'WHATSAPP' && wa.optimizationGoal === 'REPLIES');
check('WhatsApp needs a number and no form', wa.requiresWhatsAppNumber === true && wa.requiresLeadForm === false);

console.log('\n▸ IMPOSSIBLE COMBINATIONS CANNOT BE ASKED FOR');
check(
  'a conversions goal with an instant-form destination still resolves to a website campaign',
  resolveCampaignPlan({ campaignType: 'instant_form', campaignGoal: 'conversions' }).destinationType === 'WEBSITE',
);
check(
  'a whatsapp goal wins over a form destination',
  resolveCampaignPlan({ campaignType: 'instant_form', campaignGoal: 'whatsapp' }).destinationType === 'WHATSAPP',
);
check('an unknown campaign type behaves as an instant form', resolveCampaignPlan({ campaignType: 'wat' }).destinationType === 'ON_AD');
check('a missing campaign type behaves as an instant form', resolveCampaignPlan({}).destinationType === 'ON_AD');
check('goalForCampaignType mirrors the plan', goalForCampaignType('website_conversion') === 'conversions');

// ---------------------------------------------------------------------------
console.log('\n▸ GENDER IS A REAL SETTING, NOT DECORATION');
check('Male → Meta 1', JSON.stringify(genderTargeting('Male')) === '[1]');
check('Female → Meta 2', JSON.stringify(genderTargeting('Female')) === '[2]');
check('All → no restriction', genderTargeting('All') === null);
check('garbage → no restriction', genderTargeting('nonbinary-ish') === null);

// ---------------------------------------------------------------------------
console.log('\n▸ WIRED: THE MODAL');
check('the modal imports the shared planner', /from '@\/lib\/ads\/campaign-plan'/.test(modal));
check('it renders the goal picker', /CAMPAIGN_GOALS\.map/.test(modal));
check('it renders the conversion-event picker', /CONVERSION_EVENTS\.map/.test(modal));
check('it renders the editable field chips', /LEAD_FORM_FIELDS\.map/.test(modal));
check('a field can be toggled', /toggleFormField/.test(modal));
check('and reset to the default', /setFormFields\(\[\.\.\.DEFAULT_LEAD_FORM_FIELDS\]\)/.test(modal));
check('the old hardcoded field sentence is gone', !/Full Name, Phone, Email, City/.test(modal), 'it claimed a default that was not editable');
check('the goal is sent with the launch', /formPayload\.append\('campaignGoal'/.test(modal));
check('the conversion event is sent with the launch', /formPayload\.append\('conversionEvent'/.test(modal));
check('the chosen fields ride in the form config', /standardFields: formFields/.test(modal));
check('quality leads drives the legacy flag', /campaignGoal === 'quality_leads'\)\.toString\(\)/.test(modal));
check('the goal selects the destination', /setCampaignType\(def\.campaignType\)/.test(modal));
check('a conversions launch without a pixel stops in the modal', /campaignType === 'website_conversion' && !pixelId/.test(modal));
check('an audience-only launch no longer demands a location', /audienceOnly/.test(modal), 'the remarketing toggle contradicted itself');

console.log('\n▸ WIRED: THE ROUTE');
check('the route reads the goal', /formData\.get\('campaignGoal'\)/.test(route));
check('the route reads the conversion event', /formData\.get\('conversionEvent'\)/.test(route));
check('the route reads the gender that it used to drop', /formData\.get\('gender'\)/.test(route));
check('the route resolves the plan', /resolveCampaignPlan\(/.test(route));
check('the plan decides the destination the job carries', /campaignType: effectiveCampaignType/.test(route));
check('a conversions launch without a pixel is refused server-side', /plan\.requiresPixel && !finalPixelId/.test(route));
check('a whatsapp launch without a number is refused server-side', /plan\.requiresWhatsAppNumber/.test(route));
check('the goal and event reach the job payload', /campaignGoal,/.test(route) && /conversionEvent,/.test(route));

console.log('\n▸ WIRED: THE PROCESSOR');
check('the processor resolves the same plan', /resolveCampaignPlan\(/.test(processor));
check('the campaign objective comes from the plan', /objective: plan\.objective/.test(processor));
check('the ad set destination comes from the plan', /destination_type = plan\.destinationType/.test(processor));
check('the optimisation goal comes from the plan', /optimization_goal = plan\.optimizationGoal/.test(processor));
check('the conversion event reaches the pixel optimisation', /custom_event_type: plan\.conversionEvent \|\| 'LEAD'/.test(processor));
check('the standard questions are built from the client’s choice', /buildStandardQuestions\(/.test(processor));
check('the old hardcoded Name/Email/Phone block is gone', !/\{ type: "FULL_NAME", key: "full_name" \},\s*\n\s*\{ type: "PHONE", key: "phone_number" \},\s*\n\s*\{ type: "EMAIL", key: "email" \}/.test(processor));
check(
  'gender is applied to the ad set targeting',
  // It used to grep for `targetingConfig.genders = genders`, which broke the moment the decision
  // moved into the pure helper below — even though gender was still applied. The check now follows
  // the code: the helper is called, its result is assigned, and an empty result DELETES the field
  // rather than leaving a stale one on a reused config object.
  /ageAndGenderTargeting\(advantage, ageMin, ageMax/.test(processor) &&
    /targetingConfig\.genders = ageGender\.genders/.test(processor) &&
    /delete targetingConfig\.genders/.test(processor),
);
check('the form name describes the real fields', /describeLeadFormFields\(/.test(processor));
check(
  'custom questions cannot duplicate a standard field',
  /const seenTypes = new Set\(standardTypes\)/.test(processor),
  'a duplicate question type is rejected by Meta after the campaign exists',
);

console.log('\n▸ BEHAVIOUR: WHO THE AD ACTUALLY REACHES');
// Two live Meta rules decide the audience, and getting either wrong is invisible until the money is
// spent: a special ad category may not narrow by age or gender at all, and Advantage+ audience
// refuses a maximum age below 65 (error 1870189). Both are asserted here against the exported pure
// helper, so a future refactor that breaks the audience fails a test instead of failing quietly in
// an ad account.
const openPlan = { specialAdCategories: [], advantageAudience: false } as unknown as AdvantagePlan;
const housingPlan = { specialAdCategories: ['HOUSING'], advantageAudience: false } as unknown as AdvantagePlan;
const advantagePlan = { specialAdCategories: [], advantageAudience: true } as unknown as AdvantagePlan;

check(
  'a normal campaign keeps the requested age range and gender',
  (() => {
    const r = ageAndGenderTargeting(openPlan, 25, 40, 'Male', genderTargeting);
    return r.age_min === 25 && r.age_max === 40 && JSON.stringify(r.genders) === '[1]';
  })(),
  JSON.stringify(ageAndGenderTargeting(openPlan, 25, 40, 'Male', genderTargeting)),
);
check(
  '"All" means no gender restriction, so the field is not sent',
  ageAndGenderTargeting(openPlan, 25, 40, 'All', genderTargeting).genders === null,
  'null, not []',
);
check(
  'a HOUSING campaign cannot be narrowed by age or gender, so it opens to 18–65 and drops genders',
  (() => {
    const r = ageAndGenderTargeting(housingPlan, 25, 40, 'Male', genderTargeting);
    return r.age_min === OPEN_AGE_RANGE.min && r.age_max === OPEN_AGE_RANGE.max && r.genders === null;
  })(),
  'the requested 25–40 Male is not applied, because Meta would refuse the ad set',
);
check(
  'Advantage+ audience raises the ceiling to 65, because Meta refuses anything lower',
  ageAndGenderTargeting(advantagePlan, 25, 40, 'Male', genderTargeting).age_max === 65,
  'error 1870189 avoided; the advertiser ceiling survives as a suggestion instead',
);
check(
  'an out-of-bounds age range is clamped into 18–65 rather than sent as asked',
  (() => {
    const r = ageAndGenderTargeting(openPlan, 10, 90, 'All', genderTargeting);
    return r.age_min === 18 && r.age_max === 65;
  })(),
  JSON.stringify(ageAndGenderTargeting(openPlan, 10, 90, 'All', genderTargeting)),
);
check(
  'a missing age range falls back to the full window instead of throwing',
  (() => {
    const r = ageAndGenderTargeting(openPlan, undefined, null, 'Female', genderTargeting);
    return r.age_min === 18 && r.age_max === 65 && JSON.stringify(r.genders) === '[2]';
  })(),
  'defaults applied',
);

console.log('\n▸ WIRED: RETARGETING USES THE SAME RULES');
check('the retargeting route resolves the plan', /resolveCampaignPlan\(/.test(remarketing));
check('its lead form uses the same standard fields', /buildStandardQuestions\(formConfig\?\.standardFields\)/.test(remarketing));
check('its campaign objective comes from the plan', /objective: plan\.objective/.test(remarketing));
check('its conversion event is no longer hardcoded', !/const customEventType = 'LEAD';/.test(remarketing));
check('the old Email field is gone from its form', !/\{ type: "EMAIL", key: "email" \}/.test(remarketing));

// ---------------------------------------------------------------------------
// Meta retired the CREDIT special ad category, and we kept sending it.
//
// Measured on a live client: "The credit special ad category is no longer available.
// Choose financial products and services instead. (code 100/…)". Every campaign that
// declared CREDIT was rejected, so the account could not launch anything at all — and
// the same rejection was shown to the owner in the dashboard.
//
// These assertions hold the wire payload to a name Meta accepts today, and hold the
// error text to something an agent can act on instead of a bare "Invalid parameter".
console.log('\n▸ the special ad category Meta actually accepts');
check('CREDIT is no longer a category we send', !SPECIAL_AD_CATEGORIES.includes('CREDIT' as any), SPECIAL_AD_CATEGORIES.join(','));
check(
  'FINANCIAL_PRODUCTS_SERVICES is',
  SPECIAL_AD_CATEGORIES.includes('FINANCIAL_PRODUCTS_SERVICES'),
  SPECIAL_AD_CATEGORIES.join(',')
);
check(
  'a saved CREDIT launch is rewritten, not rejected',
  detectSpecialAdCategories({ explicit: ['CREDIT'] }).categories.join(',') === 'FINANCIAL_PRODUCTS_SERVICES',
  detectSpecialAdCategories({ explicit: ['CREDIT'] }).categories.join(',')
);
check(
  'a loans business is detected as a financial product, not a credit category',
  detectSpecialAdCategories({ industry: 'home loans and EMI' }).categories.join(',') === 'FINANCIAL_PRODUCTS_SERVICES',
  detectSpecialAdCategories({ industry: 'home loans and EMI' }).categories.join(',')
);
check('HOUSING still detects for property', detectSpecialAdCategories({ industry: 'real estate' }).categories.includes('HOUSING'));
check('EMPLOYMENT still detects for hiring', detectSpecialAdCategories({ industry: 'hiring' }).categories.includes('EMPLOYMENT'));

console.log('\n▸ a Meta error says which field and why');
const blame = describeMetaError({
  error: {
    message: 'Invalid parameter',
    code: 100,
    error_subcode: 2490408,
    error_user_title: 'Campaign not created',
    error_user_msg: 'The credit special ad category is no longer available.',
    error_data: { blame_field_specs: [{ field: 'special_ad_categories' }] },
    fbtrace_id: 'AbCdEf',
  },
});
check('it keeps the field name', Boolean(blame && blame.includes('special_ad_categories')), String(blame));
check('it keeps Meta’s own explanation', Boolean(blame && blame.includes('no longer available')), String(blame));
check('it keeps the subcode and trace', Boolean(blame && blame.includes('2490408') && blame.includes('AbCdEf')), String(blame));
check(
  'a bare "Invalid parameter" is never all we return',
  String(blame) !== 'Meta rejected the request: Invalid parameter',
  String(blame)
);
check('no graph error means no message', describeMetaError({ id: '123' }) === null);
check('a #190 token error is permanent and a permissions gap', (() => {
  const verdict = classifyMetaError({ error: { code: 190, message: 'This method must be called with a Page Access Token' } });
  return verdict.reason === 'permissions' && verdict.permanent;
})());
check('a rate limit is retryable', classifyMetaError({ error: { code: 4, message: 'Application request limit reached' } }).permanent === false);
check('a parameter error is not retryable', classifyMetaError({ error: { code: 100, message: 'Invalid parameter' } }).permanent === true);

console.log('\n▸ an instant form never posts a question Meta will refuse');
check(
  'a custom question takes its wording from label, question, text or title',
  /q\.label \?\? q\.question \?\? q\.text \?\? q\.title/.test(processor)
);
check(
  'a question with no wording is dropped, not posted blank',
  /if \(!label\) return null/.test(processor) && /\.filter\(Boolean\)/.test(processor)
);
check(
  'a choice question needs two options or is asked as free text',
  /validOptions\.length >= 2/.test(processor)
);
check(
  'its failure names the field Meta blamed',
  /describeMetaError\(formCreateData/.test(processor)
);

// ---------------------------------------------------------------------------
console.log('\n================================================================');
if (fail === 0) {
  console.log(`${pass} passed, 0 failed`);
  process.exit(0);
} else {
  console.log(`${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
