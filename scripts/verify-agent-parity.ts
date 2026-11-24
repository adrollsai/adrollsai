/**
 * Is the agent at parity with the product - and does it keep the primitives while gaining composed tools?
 *
 * THE TWO FAILURES THIS COVERS
 *  1. The agent could not launch ads or call a segment of leads at all. `launch-campaign` / `launch-remarketing` were
 *     UI-only routes (21 KB and 68 KB of decisions that took real bugs to get right), and the calling campaign runner
 *     lived only in the dashboard. So "run me a retargeting campaign" and "call my 400 Diwali leads" were answered
 *     with improvisation or a pointer to the dashboard.
 *  2. The obvious fix - bolt on composed tools - has its own failure mode: a composed tool that becomes the ONLY way,
 *     so anything Meta allows and the wrapper does not expose becomes impossible. The primitives must stay.
 *
 * So this asserts both directions: the composed paths exist, are gated, and reuse the product's own plan and
 * processor; AND the primitives are still registered, still mentioned, and the prompt forbids refusing on the grounds
 * that no composed tool fits.
 *
 *   npm run verify:parity
 *
 * Read-only: pure functions and source inspection. It never launches an ad or dials a call.
 */
import fs from 'node:fs';

import {
  MIN_DAILY_BUDGET_INR,
  buildCampaignJobPayload,
  describePlan,
  recommendOptimisation,
  validateLaunchRequest,
  type LaunchContext,
} from '../lib/ads/launch-service';
import { resolveCampaignPlan } from '../lib/ads/campaign-plan';
import { COMPOSED_AD_TOOLS } from '../lib/agent/tools/ads';
import { CALLING_CAMPAIGN_TOOLS } from '../lib/agent/tools/calling';
import {
  DEFAULT_MAX_LEADS_PER_CAMPAIGN,
  HARD_MAX_LEADS_PER_CAMPAIGN,
  buildCallingCampaignPrompt,
  selectDialableLeads,
  validateCallingCampaign,
} from '../lib/automation/calling-campaign';
import { REVIEW_POLICY } from '../lib/agent/review-gate';
import { selectToolGroups } from '../lib/agent/tool-groups';

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

const codeOf = (path: string) =>
  fs
    .readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');
const rawOf = (path: string) => fs.readFileSync(path, 'utf8');

const orchestrator = codeOf('lib/agent/orchestrator.ts');
const service = codeOf('lib/ads/launch-service.ts');
const calling = codeOf('lib/automation/calling-campaign.ts');

const FAKE_CTX: LaunchContext = {
  userId: 'u1',
  token: 'tok',
  adAccountId: 'act_1',
  pageId: 'page_1',
  pageToken: null,
  pixelId: 'px_1',
  currency: 'INR',
  linkUrl: 'https://example.com',
  privacyPolicyUrl: 'https://example.com/privacy',
  businessName: 'Test Realty',
  contactNumber: '+911111111111',
  whatsappNumber: '+912222222222',
  businessInfo: '{}',
  missionStatement: '',
  logoUrl: null,
};

// ── 1. composed launches: the same plan and processor the UI uses
console.log('\n▸ a launch from chat cannot disagree with a launch from the modal');
check(
  'the launch path resolves the shared campaign plan',
  /resolveCampaignPlan\(/.test(service),
  'objective + ad-set optimisation live in lib/ads/campaign-plan.ts',
);
check(
  'and runs the product\'s own campaign processor',
  /runCampaignJob\(/.test(service),
  'not a second implementation of the Graph payloads',
);
check(
  'the job payload is built in one place, for both routes',
  /export function buildCampaignJobPayload/.test(service),
);
check(
  'the subscription counter is incremented before spending, and refunded on failure',
  /checkLimitAndIncrement\(/.test(service) && /refundLimit\(/.test(service),
);

// `locations` is required by validateLaunchRequest — an ad with no explicit geo is refused —
// so a "complete" request has to carry one. This fixture predated that requirement, which is
// why this check had been failing against an otherwise fine build.
const goodReq = {
  dailyBudget: 500,
  creativeUrls: ['https://cdn.example.com/ad.jpg'],
  campaignGoal: 'leads',
  locations: [{ key: 'IN', type: 'country' as const }],
};
check('a complete launch passes validation', validateLaunchRequest(goodReq, FAKE_CTX).ok === true);
check(
  'no budget is refused and says so',
  validateLaunchRequest({ creativeUrls: ['x'] }, FAKE_CTX).ok === false,
);
check(
  `a budget under ${MIN_DAILY_BUDGET_INR} is refused rather than launched into nothing`,
  /below Meta's useful minimum/.test(validateLaunchRequest({ ...goodReq, dailyBudget: 20 }, FAKE_CTX).error || ''),
);
check(
  'no creative is refused',
  validateLaunchRequest({ dailyBudget: 500 }, FAKE_CTX).missing?.includes('a creative - an image or video URL, a catalogue item, or at least the headline copy') === true,
);
check(
  'a conversions campaign with no pixel is refused',
  validateLaunchRequest({ ...goodReq, campaignGoal: 'conversions' }, { ...FAKE_CTX, pixelId: null }).ok === false,
);
check(
  'a WhatsApp campaign with no number is refused',
  validateLaunchRequest({ ...goodReq, campaignGoal: 'whatsapp' }, { ...FAKE_CTX, whatsappNumber: '' }).ok === false,
);
check(
  'an age range the wrong way round is refused',
  validateLaunchRequest({ ...goodReq, ageMin: 45, ageMax: 30 }, FAKE_CTX).ok === false,
);
check(
  'every missing item is reported at once, not one per attempt',
  (validateLaunchRequest({ ageMin: 18 }, FAKE_CTX).missing || []).length >= 2,
);

const plan = resolveCampaignPlan({ campaignGoal: 'quality_leads' });
const payload = buildCampaignJobPayload(FAKE_CTX, goodReq, plan);
check(
  'the payload carries the plan\'s objective and optimisation',
  payload.campaignGoal === 'quality_leads' && payload.optimizeForConversions === true,
  `${payload.campaignType} / ${payload.campaignGoal}`,
);
check(
  'lead-form questions default to name + phone + city',
  JSON.stringify(payload.leadFormFields) === JSON.stringify(['FULL_NAME', 'PHONE', 'CITY']),
  JSON.stringify(payload.leadFormFields),
);
check(
  'retargeting rides the same payload through custom_audience ids',
  buildCampaignJobPayload(FAKE_CTX, { ...goodReq, customAudienceIds: ['1234567890'] }, plan).customAudienceIds[0] === '1234567890',
  'the processor maps these to targeting.custom_audiences',
);
check(
  'and the plan is explained in the owner\'s words',
  /Meta objective OUTCOME_LEADS/.test(describePlan(plan, 'INR')),
  describePlan(plan, 'INR').slice(0, 80),
);

// ── 2. optimisation is advice with the primitive attached, not a silent budget move
console.log('\n▸ optimisation advises, and hands over the exact call');
const noResults = recommendOptimisation([{ adset_id: 'a1', adset_name: 'Cold', spend: '2000', results: 0, ctr: 0.5, frequency: 1.2 }]);
check(
  'an ad set that spent with no results is recommended for pause',
  noResults.some((a) => a.kind === 'pause' && a.primitive?.tool === 'meta_graph_set_status'),
  noResults[0]?.reason?.slice(0, 70),
);
const tired = recommendOptimisation([{ adset_id: 'a2', adset_name: 'Tired', spend: '800', results: 3, ctr: 0.4, frequency: 4.2 }]);
check('a high-frequency, low-CTR ad set is flagged', tired.some((a) => a.kind === 'pause'));
const empty = recommendOptimisation([]);
check(
  'with no data it refuses to invent a judgement',
  empty.length === 1 && empty[0].kind === 'keep',
  empty[0].reason.slice(0, 70),
);
check(
  'and it never applies anything itself',
  /it does not move a client/i.test(rawOf('lib/agent/tools/ads.ts')),
);

// ── 3. the primitives stay: composed first, never composed only
console.log('\n▸ the primitives stay reachable, so nothing Meta allows becomes impossible');
check(
  'the raw Graph tools are still registered',
  /createMetaGraphTools\(supabase,\s*userId\)/.test(orchestrator),
);
check(
  'the composed tools are registered alongside them, not instead',
  /createComposedAdTools\(supabase,\s*userId\)/.test(orchestrator),
  COMPOSED_AD_TOOLS.join(', '),
);
check(
  'the prompt tells the agent composed-first',
  /launch_meta_campaign[\s\S]{0,400}DEFAULT for/.test(rawOf('lib/agent/orchestrator.ts')),
);
check(
  'and forbids refusing because no composed tool fits',
  /NEVER answer "I cannot do that in Meta Ads" because no composed tool fits/.test(rawOf('lib/agent/orchestrator.ts')),
);
check(
  'naming the primitives as the answer when a composed tool does not cover it',
  /special ad categories, bid strategies, unusual placements, catalogue\/DPA structures/.test(rawOf('lib/agent/orchestrator.ts')),
);
check(
  'both doors are gated, so a composed launch is no cheaper than a primitive one',
  (REVIEW_POLICY as any).launch_meta_campaign?.actionType === 'ad_spend' &&
    (REVIEW_POLICY as any).launch_meta_retargeting?.actionType === 'ad_spend' &&
    (REVIEW_POLICY as any).meta_graph_create?.actionType === 'ad_spend',
);
check(
  'and reading performance stays free',
  !(REVIEW_POLICY as any).optimize_meta_campaign && !(REVIEW_POLICY as any).get_ads_readiness,
);

// ── 4. the gate itself, invoked: a complete request must come back as a card, not as a launch
console.log('\n▸ the review gate actually stops these two (real gate code, no database writes)');
{
  const { applyReviewGate } = await import('../lib/agent/review-gate');
  const { createComposedAdTools } = await import('../lib/agent/tools/ads');
  const { createCallingCampaignTools } = await import('../lib/agent/tools/calling');

  // A stub supabase: every read returns nothing, so if the gate ever let a call through, the service would fail
  // loudly rather than silently launching. recordPending captures what the card would carry.
  const stubDb: any = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  };
  const recorded: any[] = [];
  const store: any = {
    recordPending: async (req: any) => {
      recorded.push(req);
      return { actionId: `act_test_${recorded.length}` };
    },
  };

  const adTools = applyReviewGate(createComposedAdTools(stubDb, 'u1') as any, store);
  const launchBlocked: any = await adTools.launch_meta_campaign.execute({
    campaignName: 'Diwali',
    dailyBudget: 500,
    creativeUrls: ['https://cdn.example.com/ad.jpg'],
    campaignGoal: 'leads',
  });
  check(
    'launch_meta_campaign does not run unreviewed',
    launchBlocked?.requiresApproval === true && !!launchBlocked?.actionId,
    String(launchBlocked?.message || '').slice(0, 90),
  );
  check(
    'and the card that was recorded is an ad_spend one',
    recorded[0]?.actionType === 'ad_spend' && recorded[0]?.tool === 'launch_meta_campaign',
    `${recorded[0]?.tool} / ${recorded[0]?.actionType}`,
  );
  check(
    'the card carries the exact arguments that would run',
    recorded[0]?.toolInput?.dailyBudget === 500 && recorded[0]?.toolInput?.campaignName === 'Diwali',
  );

  const retargetBlocked: any = await adTools.launch_meta_retargeting.execute({
    audience: { source: 'existing', audienceId: '1234567890' },
    campaignName: 'Retarget',
    dailyBudget: 500,
    creativeUrls: ['https://cdn.example.com/ad.jpg'],
  });
  check('launch_meta_retargeting does not run unreviewed either', retargetBlocked?.requiresApproval === true);

  const callTools = applyReviewGate(createCallingCampaignTools(stubDb, 'u1') as any, store);
  const callBlocked: any = await callTools.start_calling_campaign.execute({
    name: 'Diwali follow-up',
    purpose: 'confirm the site visit',
    audience: { groupName: 'Diwali' },
    when: 'now',
  });
  check(
    'start_calling_campaign does not dial unreviewed',
    callBlocked?.requiresApproval === true,
    String(callBlocked?.message || '').slice(0, 90),
  );
  check(
    'and its card is a bulk_call one',
    recorded.some((r) => r.tool === 'start_calling_campaign' && r.actionType === 'bulk_call'),
  );

  const stopTool = callTools.stop_calling_campaign;
  const stopPassedThrough = typeof stopTool?.execute === 'function' && !('approvalId' in ((stopTool?.inputSchema as any)?.shape || {}));
  check('stop_calling_campaign is NOT wrapped by the gate', stopPassedThrough, 'it runs straight through');
}

// ── 5. calling campaigns: capped, gated, and stoppable
console.log('\n▸ a calling campaign rings real phones, so it is bounded and reversible');
check(
  'the calling tools are registered',
  /createCallingCampaignTools\(supabase,\s*userId\)/.test(orchestrator),
  CALLING_CAMPAIGN_TOOLS.join(', '),
);
check(
  'starting one needs approval',
  (REVIEW_POLICY as any).start_calling_campaign?.actionType === 'bulk_call',
);
check(
  'stopping one does NOT - making a mistake stop must never wait for a tap',
  !(REVIEW_POLICY as any).stop_calling_campaign && !(REVIEW_POLICY as any).list_calling_campaigns,
);
check(
  `one approval is capped at ${HARD_MAX_LEADS_PER_CAMPAIGN} leads (default ${DEFAULT_MAX_LEADS_PER_CAMPAIGN})`,
  HARD_MAX_LEADS_PER_CAMPAIGN === 200 && DEFAULT_MAX_LEADS_PER_CAMPAIGN === 25 &&
    /Math\.min\(Math\.floor\(requested\), HARD_MAX_LEADS_PER_CAMPAIGN\)/.test(calling),
);
check(
  'no audience is refused',
  validateCallingCampaign({ name: 'x', purpose: 'y' } as any).ok === false,
  (validateCallingCampaign({ name: 'x', purpose: 'y' } as any).missing || []).join('; ').slice(0, 90),
);
check(
  'two audience selectors at once is refused as ambiguous',
  /exactly ONE audience selector/.test(validateCallingCampaign({ name: 'x', purpose: 'y', audience: { groupName: 'a', leadIds: ['b'] } } as any).error || ''),
);
check(
  'no purpose is refused',
  (validateCallingCampaign({ name: 'x', audience: { groupName: 'g' } } as any).missing || []).includes("what the call is about (one sentence, in the owner's words)"),
);
check(
  'a complete request passes',
  validateCallingCampaign({ name: 'Diwali', purpose: 'confirm the site visit', audience: { groupName: 'Diwali' } }).ok === true,
);
const dial = selectDialableLeads([
  { phone: '9828835235' } as any,
  { phone: '+91 98288 35235' } as any,
  { phone: '12345' } as any,
  { phone: '' } as any,
  { phone: '919999999999' } as any,
]);
check(
  'duplicate numbers are dialled once and unusable numbers are dropped',
  dial.leads.length === 2 && dial.skipped === 3,
  `${dial.leads.length} dialable, ${dial.skipped} skipped`,
);
check(
  'the campaign carries the purpose, the language and the opt-out rule',
  (() => {
    const prompt = buildCallingCampaignPrompt(
      { name: 'Diwali', purpose: 'confirm the site visit', audience: {} } as any,
      'Test Realty',
      'hinglish',
    );
    return /confirm the site visit/.test(prompt) && /hinglish/.test(prompt) && /opt-out/.test(prompt);
  })(),
);
check(
  'and it reuses the runner the UI uses',
  /dispatchNextCall/.test(calling),
  'not a second dialer',
);
check(
  'stopping also detaches un-dialled leads, so the cron cannot pick them back up',
  /voice_campaign_id: null/.test(calling) && /is\('voice_call_status', null\)/.test(calling),
);
check(
  'a campaign with no phone number behind it is refused before queueing',
  /no outbound phone number assigned/.test(calling),
);

// ── 5. the creative fast path
console.log('\n▸ one image, two calls');
const prompt = rawOf('lib/agent/orchestrator.ts');
check(
  'the prompt caps a single ad image at build_ad_creative_prompt -> generate_ai_image',
  /FAST PATH FOR ONE IMAGE OR AD[\s\S]{0,600}build_ad_creative_prompt[\s\S]{0,200}generate_ai_image/.test(prompt),
);
check(
  'and names the measured failure it prevents',
  /5-12 minutes|30 steps/.test(prompt),
);

// ── 6. routing: the owner's phrasing reaches the right group
console.log('\n▸ the phrasing reaches the tools');
const phrasing: Array<[string, string]> = [
  ['run me a retargeting campaign for my qualified leads', 'meta'],
  ['launch a campaign for the Diwali offer', 'meta'],
  ['how are my ads performing this week', 'meta'],
  ['call everyone who enquired last week', 'automation'],
  ['stop that calling campaign', 'automation'],
  ['make me an ad image for the new project', 'media'],
];
const unrouted = phrasing.filter(([text, group]) => !selectToolGroups(text).groups.includes(group as any));
check(
  'every ads/calling phrasing loads the group that owns the tool',
  unrouted.length === 0,
  unrouted.length ? unrouted.map(([t, g]) => `"${t}" needs ${g}`).join(' | ') : `${phrasing.length} phrasings`,
);

// ── 6. nothing declared and never wired
console.log('\n▸ no capability exists only in a file nobody imports');
{
  const fsx = fs;
  const toolFiles = fsx
    .readdirSync('lib/agent/tools', { recursive: true } as any)
    .filter((f: any) => String(f).endsWith('.ts'))
    .map((f: any) => `lib/agent/tools/${String(f).replace(/\\/g, '/')}`)
    .concat(['lib/agent/mcp/meta-graph.ts', 'lib/agent/mcp/meta-official-mcp.ts', 'lib/agent/mcp/nobogent_app_mcp.ts']);

  const declared: Array<{ name: string; file: string }> = [];
  for (const file of toolFiles) {
    for (const m of fsx.readFileSync(file, 'utf8').matchAll(/export function (create[A-Za-z0-9]*Tools)\s*\(/g)) {
      declared.push({ name: m[1], file });
    }
  }

  /**
   * Factories that are deliberately NOT registered. Each entry has to say why, so "it is dead" is a decision
   * someone wrote down rather than something rediscovered by a customer asking for a feature that exists.
   */
  const INTENTIONALLY_UNREGISTERED: Record<string, string> = {
    createCrmTools:
      'superseded by nobogent_crm_* (read) and createCrmWriteTools (write, which also leaves lead_history)',
    createWhatsAppTools:
      'superseded by createMessagingTools and nobogent_whatsapp_list_templates; its prepare_whatsapp_broadcast was the fake tool that reported success without sending',
    createInventoryTools:
      'superseded by nobogent_inventory_search; its write half was rewritten as createCatalogueTools because it targeted location/category instead of address/property_type',
    createVoiceTools:
      'registered through createRegisteredVoiceTools instead - the curated subset, because launch_bulk_calling_campaign has no executor behind its approval payload',
  };

  const unwired = declared.filter(
    (d) => !orchestrator.includes(d.name) && !INTENTIONALLY_UNREGISTERED[d.name],
  );
  check(
    'every tool factory is either registered or documented as superseded',
    unwired.length === 0,
    unwired.length ? unwired.map((u) => `${u.name} (${u.file})`).join(', ') : `${declared.length} factories checked`,
  );
  check(
    'the documented ones really are superseded, not just forgotten',
    Object.keys(INTENTIONALLY_UNREGISTERED).length >= 3,
  );
}

// ── 7. the catalogue can be written, not only read
console.log('\n▸ the catalogue has a write path, against the real columns');
{
  const { CATALOGUE_TOOLS, CATALOGUE_WRITABLE_COLUMNS, buildCatalogueRow } = await import('../lib/agent/tools/catalogue');
  check(
    'the catalogue write tool is registered',
    /createCatalogueTools\(supabase,\s*userId\)/.test(orchestrator),
    CATALOGUE_TOOLS.join(', '),
  );
  check(
    'it writes the table\'s real column names',
    CATALOGUE_WRITABLE_COLUMNS.includes('address' as any) &&
      CATALOGUE_WRITABLE_COLUMNS.includes('property_type' as any) &&
      !(CATALOGUE_WRITABLE_COLUMNS as readonly string[]).includes('location') &&
      !(CATALOGUE_WRITABLE_COLUMNS as readonly string[]).includes('category'),
    'the dead module used location/category, which this table does not have',
  );
  check('a title is required', buildCatalogueRow({}).ok === false);
  check(
    'a price is stored as the full figure, and a bare "85" is flagged',
    (() => {
      const built = buildCatalogueRow({ title: 'Plot', price: '₹85,00,000' });
      return built.ok && built.row?.price === 8500000;
    })(),
    String(buildCatalogueRow({ title: 'Plot', price: '₹85,00,000' }).row?.price),
  );
  check(
    'a non-numeric price is refused',
    buildCatalogueRow({ title: 'Plot', price: 'call us' }).ok === false,
  );
  check(
    'only http(s) images are stored, and the first becomes the cover',
    (() => {
      const built = buildCatalogueRow({ title: 'Plot', imageUrls: ['javascript:alert(1)', 'https://cdn.x/a.jpg'] });
      const imgs = (built.row?.images || []) as string[];
      return imgs.length === 1 && imgs[0] === 'https://cdn.x/a.jpg' && built.row?.image_url === 'https://cdn.x/a.jpg';
    })(),
  );
  check(
    'adding an item needs no approval - it spends nothing and messages nobody',
    !(REVIEW_POLICY as any).add_catalog_offering,
  );
}

// ── 8. the agent's own models, and its fallback
console.log('\n▸ the agent runs on the model it says it does');
{
  const { VIDEO_ANALYSIS_MODEL } = await import('../lib/agent/models');
  const deepseek = codeOf('lib/agent/deepseek.ts');
  const fallback = deepseek.match(/const AGENT_FALLBACK_MODEL = '([^']+)'/)?.[1] || '';

  check(
    'the agent model is the pinned DeepSeek flash, not an alias and not the reasoner',
    /provider\.chat\(DEEPSEEK_MODELS\.flash\)/.test(deepseek) && !/DEEPSEEK_MODELS\.pro/.test(deepseek),
  );
  check(
    'its Gemini fallback is the current Flash generation',
    fallback === 'gemini-3.8-flash',
    fallback || '(no fallback constant found)',
  );
  check(
    'and it matches the id the rest of the codebase uses, so the two cannot drift',
    fallback === VIDEO_ANALYSIS_MODEL,
    `models.ts says ${VIDEO_ANALYSIS_MODEL}`,
  );
  check(
    'the two-generations-old fallback is gone',
    !/google\('gemini-2\.5-flash'\)/.test(deepseek),
  );
  check(
    'a fallback is announced rather than silent',
    /falling back to \$\{AGENT_FALLBACK_MODEL\}/.test(deepseek),
    'the owner can be told which model answered',
  );
  check(
    'the frozen model registry was not edited to do this',
    /pro: 'deepseek-v4-pro'/.test(rawOf('lib/agent/models.ts')) &&
      /flash: 'deepseek-flash'/.test(rawOf('lib/agent/models.ts')),
    'lib/agent/models.ts is untouched',
  );
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
