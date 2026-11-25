/**
 * Proves every pipeline is a real boilerplate: it asks the app's questions, and it ends in a composed
 * tool that exists.
 *
 * The failure this guards against is the one the owner described — an agent that "figures things out
 * each time in a new session". A spec that points at a renamed tool, or that forgets a required
 * argument, would look fine in the registry and fail at the moment of use, which is the worst place to
 * find out: after the owner has answered six questions.
 *
 *   npm run verify:pipelines
 */
import { PIPELINES, PIPELINE_IDS, findPipeline, pipelineFromAnswer, pipelineMenu } from '../lib/agent/pipelines/registry';
import type { PipelineContext } from '../lib/agent/pipelines/types';
import { createComposedAdTools } from '../lib/agent/tools/ads';
import { createAdLaunchpadTools } from '../lib/agent/tools/ad-launchpad';
import { createCallingCampaignTools } from '../lib/agent/tools/calling';
import { createAudienceTools } from '../lib/agent/tools/audiences';
import { createCatalogueTools } from '../lib/agent/tools/catalogue';
import { createMessagingTools } from '../lib/agent/tools/messaging';

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

/** A context that looks like a real account with a library, products and saved audiences. */
const CTX: PipelineContext = {
  currency: 'INR',
  minDailyBudget: 300,
  assets: [
    { id: 'a1', label: 'Dholera site photo', kind: 'image', url: 'https://cdn/x1.jpg' },
    { id: 'a2', label: 'Gateway tower', kind: 'image', url: 'https://cdn/x2.jpg' },
  ],
  products: [{ id: 'p1', label: 'Umang Residency' }],
  audienceGroups: [{ id: 'g1', name: 'Diwali 3BHK buyers' }, { id: 'g2', name: 'Site visit done' }],
  voices: ['Aoede', 'Kore', 'Charon', 'Fenrir', 'Puck'],
};

/** Every tool name the app actually registers with the agent. */
const registered = new Set<string>(
  [
    createComposedAdTools({} as any, 'u'),
    createAdLaunchpadTools({} as any, 'u'),
    createCallingCampaignTools({} as any, 'u'),
    createAudienceTools({} as any, 'u'),
    createCatalogueTools({} as any, 'u'),
    createMessagingTools({} as any, 'u'),
  ].flatMap((bundle) => Object.keys(bundle as Record<string, unknown>))
);

/** Walk a pipeline the way a conversation would, and return the completed call. */
function runPipeline(
  id: string,
  script: Array<{ answer: string }>,
  ctx: PipelineContext = CTX
): { call?: { tool: string; args: any }; blockers?: string[]; asked: string[] } {
  const spec = findPipeline(id)!;
  const answers: Record<string, any> = { __answered: {} };
  const asked: string[] = [];

  for (const turn of script) {
    const question = spec.nextQuestion(answers, ctx);
    if (!question) break;
    asked.push(question.step);
    const parsed = spec.parse(question.step, turn.answer, ctx);
    if (parsed) Object.assign(answers, parsed);
    else answers.instructions = [answers.instructions, turn.answer].filter(Boolean).join('. ');
    answers.__answered[question.step] = true;
  }

  const remaining = spec.nextQuestion(answers, ctx);
  if (remaining) asked.push(remaining.step);
  const completion = spec.complete(answers, ctx);
  return completion.ready ? { call: completion.call, asked } : { blockers: completion.blockers, asked };
}

head('1. Every pipeline points at a tool that exists');

{
  check('there is a menu of pipelines', PIPELINES.length >= 6, `${PIPELINES.length} pipelines: ${PIPELINE_IDS.join(', ')}`);
  for (const pipeline of PIPELINES) {
    check(
      `${pipeline.id} → ${pipeline.targetTool} is a registered tool`,
      registered.has(pipeline.targetTool),
      registered.has(pipeline.targetTool) ? 'found' : `not found among ${registered.size} tools`
    );
    check(`${pipeline.id} has a title and a summary`, pipeline.title.length > 3 && pipeline.summary.length > 8);
  }
  check('every menu entry has a label', pipelineMenu().every((entry) => entry.label.length > 3));
}

head('2. WhatsApp template: the screen\u2019s questions, in its order');

{
  const result = runPipeline('whatsapp_template', [
    { answer: 'A marketing offer' },
    { answer: 'diwali offer 2026' },
    { answer: 'Hi {{1}}, our Diwali offer is live. Book a site visit this week.' },
    { answer: 'A text header' },
    { answer: 'Diwali offer' },
    { answer: 'No footer' },
  ]);
  check('it completes', Boolean(result.call), result.blockers?.join('; ') ?? 'complete');
  check('the order is category → name → body → header', result.asked.slice(0, 4).join(',') === 'category,name,body,header', result.asked.join(','));
  check('it ends in whatsapp_create_template', result.call?.tool === 'whatsapp_create_template', String(result.call?.tool));
  check('the category maps to MARKETING', result.call?.args.category === 'MARKETING', String(result.call?.args.category));
  check('the name is a Meta-safe slug', /^[a-z0-9_]+$/.test(result.call?.args.name ?? ''), String(result.call?.args.name));
  check('the body carries through', String(result.call?.args.bodyText).includes('Diwali'), String(result.call?.args.bodyText).slice(0, 40));
  check('the text header carries through', result.call?.args.headerText === 'Diwali offer', String(result.call?.args.headerText));
  check('no footer means no footer arg', result.call?.args.footerText === undefined);

  const utility = runPipeline('whatsapp_template', [
    { answer: 'An account or service update' },
    { answer: 'Name it for me' },
    { answer: 'Your booking for {{1}} is confirmed.' },
    { answer: 'No header' },
    { answer: 'Nothing' },
  ]);
  check('a utility template maps to UTILITY', utility.call?.args.category === 'UTILITY', String(utility.call?.args.category));
  check('"name it for me" derives a name from the copy', /^[a-z0-9_]+_v1$/.test(utility.call?.args.name ?? ''), String(utility.call?.args.name));

  const imageHeader = runPipeline('whatsapp_template', [
    { answer: 'A marketing offer' },
    { answer: 'offer_v1' },
    { answer: 'This week only: {{1}} off.' },
    { answer: 'An image header' },
    { answer: 'Gateway tower' },
    { answer: 'No footer' },
  ]);
  check('an image header resolves the library picture to its URL', imageHeader.call?.args.headerImageUrl === 'https://cdn/x2.jpg', String(imageHeader.call?.args.headerImageUrl));

  const missingBody = runPipeline('whatsapp_template', [{ answer: 'A marketing offer' }, { answer: 'x_v1' }]);
  check('a template with no body is refused, not sent', (missingBody.blockers ?? []).length > 0, (missingBody.blockers ?? []).join('; '));
}

head('3. Calling campaign: a saved audience, a purpose, a voice, a limit');

{
  const result = runPipeline('calling_campaign', [
    { answer: 'Diwali 3BHK buyers' },
    { answer: 'Follow up on their enquiry' },
    { answer: 'Kore' },
    { answer: 'Now' },
    { answer: '50 leads' },
  ]);
  check('it completes', Boolean(result.call), result.blockers?.join('; ') ?? 'complete');
  check('it ends in start_calling_campaign', result.call?.tool === 'start_calling_campaign', String(result.call?.tool));
  check('the saved group is passed by name', result.call?.args.groupName === 'Diwali 3BHK buyers', String(result.call?.args.groupName));
  check('the voice is honoured', result.call?.args.voiceName === 'Kore', String(result.call?.args.voiceName));
  check('the cap is honoured', result.call?.args.maxLeads === 50, String(result.call?.args.maxLeads));
  check('it has a recognisable name', /^Calling · /.test(result.call?.args.name ?? ''), String(result.call?.args.name));

  const wholeBook = runPipeline('calling_campaign', [
    { answer: 'Dial the whole lead book' },
    { answer: 'Tell them about the current offer' },
    { answer: 'Aoede' },
    { answer: 'In the morning' },
    { answer: '100' },
  ]);
  check('dialling everyone is still allowed', wholeBook.call?.args.groupName === undefined);
  check('but the cap still applies', wholeBook.call?.args.maxLeads === 100, String(wholeBook.call?.args.maxLeads));

  check('no purpose means no call', (runPipeline('calling_campaign', [{ answer: 'Dial the whole lead book' }]).blockers ?? []).length > 0);
}

head('4. Custom audience: a name and a real filter');

{
  const result = runPipeline('custom_audience', [
    { answer: 'Diwali buyers' },
    { answer: 'The campaign they came from' },
    { answer: 'Skycity Video Campaign' },
  ]);
  check('it completes', Boolean(result.call), result.blockers?.join('; ') ?? 'complete');
  check('it ends in create_audience_group', result.call?.tool === 'create_audience_group', String(result.call?.tool));
  check('the campaign becomes a filter', JSON.stringify(result.call?.args.filters) === '{"campaigns":["Skycity Video Campaign"]}', JSON.stringify(result.call?.args.filters));

  const stage = runPipeline('custom_audience', [
    { answer: 'Site visit done' },
    { answer: 'The pipeline stage they are at' },
    { answer: 'Site Visit' },
  ]);
  check('a stage becomes a filter', JSON.stringify(stage.call?.args.filters) === '{"pipelineStages":["Site Visit"]}', JSON.stringify(stage.call?.args.filters));

  const everyone = runPipeline('custom_audience', [{ answer: 'All leads' }, { answer: 'Every lead with a phone number' }]);
  check('"everyone" saves no filter at all', everyone.call?.args.filters === undefined && everyone.call?.tool === 'create_audience_group');
}

head('5. Retargeting: the source decides which audience argument is used');

{
  const crm = runPipeline('retargeting_campaign', [
    { answer: 'Leads in my CRM' },
    { answer: 'Site visit done' },
    { answer: '₹500 per day' },
  ]);
  check('it ends in launch_meta_retargeting', crm.call?.tool === 'launch_meta_retargeting', String(crm.call?.tool));
  check('crm_leads passes the group name', crm.call?.args.source === 'crm_leads' && crm.call?.args.audienceGroupName === 'Site visit done', JSON.stringify(crm.call?.args));

  const existing = runPipeline('retargeting_campaign', [
    { answer: 'An audience I already have' },
    { answer: '120210000000000001' },
    { answer: '500' },
  ]);
  check('an existing audience passes audienceId', existing.call?.args.audienceId === '120210000000000001', String(existing.call?.args.audienceId));

  const lookalike = runPipeline('retargeting_campaign', [
    { answer: 'A lookalike of my best leads' },
    { answer: '120210000000000002' },
    { answer: '300' },
  ]);
  check('a lookalike passes originAudienceId', lookalike.call?.args.originAudienceId === '120210000000000002', String(lookalike.call?.args.originAudienceId));

  const phones = runPipeline('retargeting_campaign', [
    { answer: 'A list of phone numbers' },
    { answer: '+91 98765 43210, +91 98765 43211' },
    { answer: '300' },
  ]);
  check('a phone list is parsed into numbers', JSON.stringify(phones.call?.args.phones) === '["919876543210","919876543211"]', JSON.stringify(phones.call?.args.phones));

  const tooCheap = runPipeline('retargeting_campaign', [{ answer: 'Leads in my CRM' }, { answer: 'Site visit done' }, { answer: '₹50 per day' }]);
  check('a budget under the account minimum is refused', (tooCheap.blockers ?? []).length > 0, (tooCheap.blockers ?? []).join('; '));

  const noBudget = runPipeline('retargeting_campaign', [{ answer: 'Leads in my CRM' }, { answer: 'Site visit done' }]);
  check('so is a retargeting campaign with no budget', (noBudget.blockers ?? []).length > 0);
}

head('6. Inventory product: price is a real figure');

{
  const result = runPipeline('inventory_product', [
    { answer: 'Umang Residency Phase 2' },
    { answer: '85 lakh' },
    { answer: 'Dholera, Gujarat' },
    { answer: 'Apartment' },
    { answer: 'Dholera site photo' },
    { answer: 'Nothing else' },
  ]);
  check('it completes', Boolean(result.call), result.blockers?.join('; ') ?? 'complete');
  check('it ends in add_catalog_offering', result.call?.tool === 'add_catalog_offering', String(result.call?.tool));
  check('85 lakh becomes 8500000, not 85', result.call?.args.price === '8500000', String(result.call?.args.price));
  check('the location carries through', result.call?.args.address === 'Dholera, Gujarat', String(result.call?.args.address));
  check('the library picture becomes the image', JSON.stringify(result.call?.args.imageUrls) === '["https://cdn/x1.jpg"]', JSON.stringify(result.call?.args.imageUrls));

  const crores = runPipeline('inventory_product', [{ answer: 'Tower A' }, { answer: '1.5 crore' }, { answer: 'Pune' }, { answer: 'Villa' }, { answer: 'None for now' }, { answer: 'Nothing else' }]);
  check('1.5 crore becomes 15000000', crores.call?.args.price === '15000000', String(crores.call?.args.price));
  check('"none for now" means no images', crores.call?.args.imageUrls === undefined);

  const noPrice = runPipeline('inventory_product', [{ answer: 'Tower B' }]);
  check('a product with no price is refused', (noPrice.blockers ?? []).length > 0, (noPrice.blockers ?? []).join('; '));
}

head('7. The ad launch still runs through the launchpad');

{
  const result = runPipeline('ad_launch', [
    { answer: 'Get leads with an instant form' },
    { answer: 'Use images from my library' },
    { answer: 'Dholera site photo' },
    { answer: 'Umang Residency' },
    { answer: '₹500 per day' },
    { answer: 'Nothing, go ahead' },
  ]);
  check('it completes', Boolean(result.call), result.blockers?.join('; ') ?? 'complete');
  check('it ends in launch_meta_campaign', result.call?.tool === 'launch_meta_campaign', String(result.call?.tool));
  check('the chosen asset is passed as an id', JSON.stringify(result.call?.args.assetIds) === '["a1"]', JSON.stringify(result.call?.args.assetIds));
  check('the budget is a number', result.call?.args.dailyBudget === 500, String(result.call?.args.dailyBudget));
}

head('8. A fresh session can find the right pipeline from what the owner said');

{
  check('an id resolves', findPipeline('whatsapp_template')?.id === 'whatsapp_template');
  check('a title resolves', findPipeline('create a whatsapp template')?.id === 'whatsapp_template');
  check('"call my leads" lands on the calling pipeline', pipelineFromAnswer('call my leads')?.id === 'calling_campaign', String(pipelineFromAnswer('call my leads')?.id));
  check('"add a property" lands on inventory', pipelineFromAnswer('add a property to the catalogue')?.id === 'inventory_product', String(pipelineFromAnswer('add a property to the catalogue')?.id));
  check('"retarget my qualified leads" lands on retargeting', pipelineFromAnswer('retarget my qualified leads')?.id === 'retargeting_campaign', String(pipelineFromAnswer('retarget my qualified leads')?.id));
  check('nonsense resolves to nothing rather than the wrong pipeline', findPipeline('make me a coffee') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
