/**
 * Is the weekly WhatsApp template variable-free, industry-agnostic, and does it carry all 3 buttons?
 *
 * The owner's rule: the weekly re-engagement must work for a film academy, a clinic and a property
 * business alike — no body variables, and the three quick replies are mandatory because a tap is how
 * the conversation continues.
 *
 * Read from SOURCE rather than from Meta, because there is no approved template to query until the
 * seeder has run against a live WABA — and a template that is wrong on paper never gets that far.
 *
 *   npx esbuild scripts/verify-weekly-template.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-weekly-tpl.mjs && node .tmp-weekly-tpl.mjs
 */
import fs from 'node:fs';

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

const seeder = fs.readFileSync('utils/whatsapp/template-seeder.ts', 'utf8');
const cron = fs.readFileSync('app/api/cron/whatsapp-followup/route.ts', 'utf8');

/** The v2 payload object only, so assertions cannot match the v1 body or the next template. */
const payloadStart = seeder.indexOf('const weeklyV2Payload = {');
const payloadEnd = payloadStart === -1 ? -1 : seeder.indexOf('};', payloadStart);
const v2 = payloadStart === -1 ? '' : seeder.slice(payloadStart, payloadEnd > payloadStart ? payloadEnd + 2 : payloadStart + 2600);

console.log('▸ the v2 template exists');
check('the seeder registers nobogent_weekly_checkin_v2', payloadStart !== -1);
check('and it registers a template with that exact name', /name: 'nobogent_weekly_checkin_v2'/.test(v2));
check('it is en_US, like the rest', /language: 'en_US'/.test(v2));

console.log('\n▸ NO VARIABLES');
const bodyMatch = /text:\s*\n?\s*'([\s\S]*?)'\s*\+?\s*\n?\s*'([\s\S]*?)'/.exec(v2) ?? /text:\s*'([\s\S]*?)'/.exec(v2);
const bodyText = bodyMatch ? (bodyMatch[1] + (bodyMatch[2] ?? '')) : '';
check('the body contains no {{n}} placeholder', !/\{\{\s*\d+\s*\}\}/.test(v2), bodyText.slice(0, 80) || '(no body found)');
check('and no example body_text array is needed', !/body_text:/.test(v2), 'a variable-free template needs none');

console.log('\n▸ INDUSTRY-AGNOSTIC COPY');
const VERTICAL_WORDS = /\b(propert(?:y|ies)|listing|real estate|apartment|villa|flat|plot|project|site visit|floor plan|rera)\b/i;
check('it says nothing property-specific', !VERTICAL_WORDS.test(bodyText), bodyText.slice(0, 100));
check(
  'it does not promise "options", which reads as inventory',
  !/\blatest options\b/i.test(bodyText),
  'the v1 wording',
);
check('the copy is a complete sentence rather than a stub', bodyText.trim().length > 80, `${bodyText.trim().length} chars`);

console.log('\n▸ THE THREE BUTTONS ARE MANDATORY');
const buttons = [...v2.matchAll(/type: 'QUICK_REPLY', text: '([^']+)'/g)].map((m) => m[1]);
check('exactly three quick replies', buttons.length === 3, buttons.join(' | '));
check(
  'the three texts are the ones the webhook routes on',
  buttons[0] === 'View Offerings' && buttons[1] === 'Talk to Expert' && buttons[2] === 'Book an Appointment',
  buttons.join(' | '),
);
check(
  'the immutable action ids are untouched',
  /view_properties/.test(seeder) && /talk_expert/.test(seeder) && /book_appointment/.test(seeder),
  'view_properties | talk_expert | book_appointment',
);

console.log('\n▸ THE CRON SENDS IT CORRECTLY');
check('the weekly cron sends v2', /name: 'nobogent_weekly_checkin_v2'/.test(cron), 'not the v1 name');
check('the cron no longer sends v1', !/name: 'nobogent_weekly_checkin'/.test(cron.replace(/nobogent_weekly_checkin_v2/g, '')));
check(
  'it passes NO components, because a variable-free template rejects an empty parameters array',
  !/components:\s*\[/.test(cron.slice(cron.indexOf('nobogent_weekly_checkin_v2'), cron.indexOf('nobogent_weekly_checkin_v2') + 900)),
  'the key must be omitted entirely',
);
check(
  'the inbox log mirrors the static body instead of interpolating names',
  /A quick weekly check-in from our team/.test(cron),
  'what the lead sees and what we log must match',
);

console.log('\n▸ LOST / NI LEADS ARE STILL EXCLUDED');
check(
  'the query still excludes Lost / Lost-NI / Not Interested',
  /Lost\/NI/.test(cron) && /Not Interested/.test(cron),
  'the audience rule is unchanged by the template swap',
);
check('and there is still an in-code guard as well', /isLostOrNotInterested/.test(cron));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
