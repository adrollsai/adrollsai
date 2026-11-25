/**
 * Proves the Saturday check-in is chosen per industry, and that it never pretends to have been sent.
 *
 * The runtime behaviour is easy to get wrong in a way nobody notices until a customer does: send a
 * template Meta has not approved and every lead silently fails; send the generic one to a specialist
 * business and the buttons say the wrong thing. Both are decided here, so both are proven here.
 *
 *   npm run verify:weekly-broadcast
 */
import {
  GENERIC_WEEKLY_TEMPLATE,
  INDUSTRY_WEEKLY_TEMPLATES,
  chooseWeeklyTemplate,
  industryKeyFor,
  weeklyCheckinPreview,
} from '../lib/automation/weekly-broadcast';

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
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);

head('1. Industries are recognised, and nothing is assumed to be property');

{
  check('a real-estate account is recognised', industryKeyFor('real_estate') === 'real_estate', industryKeyFor('real_estate'));
  check('so is a property business named loosely', industryKeyFor('Real Estate Developers') === 'real_estate');
  check('"homes" counts as property', industryKeyFor('gnr homes') === 'real_estate', industryKeyFor('gnr homes'));
  check('a film academy is education, not property', industryKeyFor('education') === 'education');
  check('so is a training institute', industryKeyFor('Training Institute') === 'education');
  check('a visa consultancy is immigration', industryKeyFor('immigration') === 'immigration');
  check('an unknown industry is generic', industryKeyFor('logistics') === 'generic', industryKeyFor('logistics'));
  check('NO industry is generic, not property', industryKeyFor(null) === 'generic', industryKeyFor(null));
  check('an empty string is generic', industryKeyFor('') === 'generic');
}

head('2. A tailored template is used only when it is approved on that number');

{
  const tailored = chooseWeeklyTemplate({
    industry: 'real_estate',
    approved: [INDUSTRY_WEEKLY_TEMPLATES.real_estate[0], GENERIC_WEEKLY_TEMPLATE],
  });
  check('a real-estate account with its own template gets it', tailored.template === INDUSTRY_WEEKLY_TEMPLATES.real_estate[0], String(tailored.template));
  check('and it is reported as tailored', tailored.source === 'industry', tailored.source);

  const approvedGenericOnly = chooseWeeklyTemplate({ industry: 'real_estate', approved: [GENERIC_WEEKLY_TEMPLATE] });
  check('without an approved property template it falls back to the generic one', approvedGenericOnly.template === GENERIC_WEEKLY_TEMPLATE, String(approvedGenericOnly.template));
  check('and says why', /no approved tailored check-in/i.test(approvedGenericOnly.reason), approvedGenericOnly.reason);

  const academy = chooseWeeklyTemplate({ industry: 'education', approved: [INDUSTRY_WEEKLY_TEMPLATES.education[0]] });
  check('a film academy with a course template gets that one', academy.template === INDUSTRY_WEEKLY_TEMPLATES.education[0], String(academy.template));

  const unknownIndustry = chooseWeeklyTemplate({ industry: 'logistics', approved: [GENERIC_WEEKLY_TEMPLATE] });
  check('an industry with no tailored template still gets a check-in', unknownIndustry.template === GENERIC_WEEKLY_TEMPLATE);
  check('reported as generic, never as tailored', unknownIndustry.source === 'generic', unknownIndustry.source);
}

head('3. Nothing approved means nothing is sent');

{
  const nothing = chooseWeeklyTemplate({ industry: 'real_estate', approved: [] });
  check('no template is returned', nothing.template === null);
  check('the reason names the template to submit', nothing.reason.includes(GENERIC_WEEKLY_TEMPLATE), nothing.reason);
  check('and it is not dressed up as a success', nothing.source === 'none', nothing.source);

  // A template that exists on Meta but is still PENDING is not approved, and must not be chosen.
  const pendingOnly = chooseWeeklyTemplate({ industry: 'real_estate', approved: ['some_other_template'] });
  check('an unrelated approved template is not used as a fallback', pendingOnly.template === null, String(pendingOnly.template));
}

head('4. The log matches what the customer receives');

{
  check('the generic preview is the approved generic body', weeklyCheckinPreview(GENERIC_WEEKLY_TEMPLATE).includes('quick weekly check-in'), weeklyCheckinPreview(GENERIC_WEEKLY_TEMPLATE).slice(0, 60));
  check('a tailored template does not pretend to know its wording', weeklyCheckinPreview('nobogent_weekly_property_checkin').includes('approved with'), weeklyCheckinPreview('nobogent_weekly_property_checkin').slice(0, 60));
  check('no template means no preview', weeklyCheckinPreview(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
