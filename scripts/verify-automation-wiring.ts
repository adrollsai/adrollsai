/**
 * Who does what: the automation/agent split the owner asked for, asserted rather than described.
 *
 * The owner's rule: website creation is the only onboarding job the AGENT does; everything routine —
 * daily image, 3-day video in round robin, calling unanswered fresh leads, the weekly WhatsApp
 * template, and sending creatives to admin WhatsApp for edit/approve with their copy — is plain
 * AUTOMATION, not an agent turn. An agent turn costs model tokens and can vary run to run; a cron is
 * deterministic and cheap, which is the whole point at 500 credits a tenant.
 *
 * This gate exists because I twice told the owner a job was missing when it was already wired
 * (the weekly broadcast, and the creative-approval send). Source-of-truth is the code, so the code is
 * what gets checked — with comments stripped, because a fix's own explanation must not pass its test.
 *
 *   npx esbuild scripts/verify-automation-wiring.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-auto-wiring.mjs && node .tmp-auto-wiring.mjs
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

const read = (p: string) => fs.readFileSync(p, 'utf8');
const codeOf = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const exists = (p: string) => fs.existsSync(p);
const crons = read('vercel.json');

console.log('▸ 1. DAILY IMAGE — automation, enrolled at onboarding');
check('the hourly cron exists', exists('app/api/cron/auto-generate/route.ts'));
check('it is scheduled', /\/api\/cron\/auto-generate"/.test(crons));
const ag = codeOf('app/api/cron/auto-generate/route.ts');
check('it only runs for enrolled products', /auto_generate/.test(ag), 'properties.auto_generate');
check('it advances a round robin', /round_robin_order/.test(ag), 'one creative per tenant per day');
const onboard = codeOf('app/api/onboarding/complete/route.ts');
check(
  'onboarding enrols the products, so the flow is live for a new tenant without an agent turn',
  /auto_generate:\s*true/.test(onboard),
  'auto_generate: true',
);

console.log('\n▸ 2. 3-DAY VIDEO — automation, round robin, 30s');
check('the video cron exists', exists('app/api/cron/auto-generate-video/route.ts'));
check('it is scheduled daily', /\/api\/cron\/auto-generate-video"/.test(crons));
const vid = codeOf('app/api/cron/auto-generate-video/route.ts');
check('it honours a per-tenant cadence (default 3 days)', /cadenceDays|daysSinceLastVideo/.test(vid));
check('it targets a 30-second film', /requestedDuration[\s\S]{0,40}30/.test(vid), '2 x 15s clips, stitched');
check('it advances the round robin', /round_robin/.test(vid));

console.log('\n▸ 3. CALLING UNANSWERED FRESH LEADS — automation with caps');
check('the caller cron exists', exists('app/api/cron/voice-caller/route.ts'));
check('it is scheduled every 5 minutes', /\/api\/cron\/voice-caller"[\s\S]{0,40}\*\/5/.test(crons));
const vc = codeOf('app/api/cron/voice-caller/route.ts');
check('it is capped per tenant per run', /MAX_CALLS_PER_TENANT_PER_RUN/.test(vc));
check('it has a global cap too', /MAX_CALLS_PER_RUN/.test(vc));
check('it respects a daily cap', /canSpend\([^)]*'call'/.test(vc), 'autonomy cannot ring 200 people a day');
check('it respects per-tenant call windows and cadence', /call_window_start|call_cadence/.test(vc));

console.log('\n▸ 4. WEEKLY WHATSAPP TEMPLATE — automation, LOST/NI excluded');
check('the weekly cron exists', exists('app/api/cron/whatsapp-followup/route.ts'));
check('it is scheduled', /\/api\/cron\/whatsapp-followup"/.test(crons));
const wf = codeOf('app/api/cron/whatsapp-followup/route.ts');
check('it excludes Lost / Lost-NI / Not Interested', /Lost\/NI/.test(wf) && /Not Interested/.test(wf));
check('it sends a template, not free text', /type:\s*'template'/.test(wf), 'required outside the 24h window');
check('it has the anti-duplicate spacing', /SIX_DAYS_MS/.test(wf));

console.log('\n▸ 5. CREATIVES -> ADMIN WHATSAPP FOR EDIT/APPROVE, WITH COPY');
check('the dispatcher exists', exists('utils/creative-dispatch-helper.ts'));
const disp = codeOf('utils/creative-dispatch-helper.ts');
check('it sends the creative image/video', /creativeUrl/.test(disp));
check('it sends the COPY alongside it', /caption/.test(disp), 'the social caption travels with the asset');
check(
  'it goes to the admin on WhatsApp with approve/edit buttons',
  /sendNobogentCreativeWithButtons/.test(disp),
  'Approve & Edit',
);
const worker = codeOf('app/api/cron/auto-generate/worker/route.ts');
check(
  'the DAILY job dispatches it — no separate cron needed, and no agent turn',
  /dispatchCreativeToAdmin/.test(worker),
  'wired into the same job that makes the creative',
);

console.log('\n▸ WEBSITE CREATION — the ONE agent job, by design');
const pages = read('lib/agent/tools/pages.ts');
check('the website builder is an AGENT tool', /build_website/.test(pages));
check(
  'there is no cron building websites for tenants',
  !exists('app/api/cron/build-website'),
  'the agent is the only path',
);
// There IS a website-builder cron; it must be a maintenance/repair sweep, not per-tenant authoring.
const wb = codeOf('app/api/cron/website-builder/route.ts');
check(
  'the website-builder cron does not author tenant sites behind the agent',
  !/build_website|createPageAuthoringTools/.test(wb),
  'it checks/serves, it does not write marketing sites',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
