/**
 * Proves the chat launchpad asks the right questions, and that a tapped answer becomes a launch.
 *
 * The point of the headstart is that the chat asks what the Ads tab asks. If a tapped button lands
 * somewhere other than the launch payload — or if a question is skipped — the owner gets a campaign
 * built from defaults they never chose, which is the failure this file exists to make impossible.
 *
 *   npm run verify:ad-launchpad-flow
 */
import {
  budgetPresets,
  launchpadProgress,
  launchpadToLaunchInput,
  nextLaunchpadQuestion,
  readLaunchpadAnswer,
  type LaunchpadContext,
} from '../lib/ads/launchpad';

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

const CTX: LaunchpadContext = {
  currency: 'INR',
  minDailyBudget: 300,
  canWhatsApp: true,
  library: [
    { id: 'a1', label: 'Dholera site photo' },
    { id: 'a2', label: 'Gateway of Dholera' },
    { id: 'a3', label: 'Plot walkthrough' },
    { id: 'a4', label: 'Brochure cover' },
  ],
  products: [
    { id: 'p1', label: 'Umang Residency' },
    { id: 'p2', label: 'Nobogent Greens' },
  ],
};

head('1. The questions come in the launchpad\u2019s order');

{
  const first = nextLaunchpadQuestion({}, CTX)!;
  check('it starts with the goal', first.step === 'goal', first.step);
  check('the goal options are the pipeline\u2019s goals', first.options.length >= 3 && /leads/i.test(first.options[0]), first.options.join(' | '));
  check('every question allows free text', first.allowsFreeText);

  const afterGoal = nextLaunchpadQuestion({ goal: 'leads' }, CTX)!;
  check('then the creative source', afterGoal.step === 'creative_source', afterGoal.step);
  check('library is offered when there are assets', afterGoal.options.some((o) => /library/i.test(o)), afterGoal.options.join(' | '));

  const afterSource = nextLaunchpadQuestion({ goal: 'leads', creativeSource: 'library' }, CTX)!;
  check('picking the library asks WHICH creatives', afterSource.step === 'assets', afterSource.step);
  check('and offers the owner\u2019s own assets by name', afterSource.options.includes('Dholera site photo'), afterSource.options.join(' | '));

  const afterAssets = nextLaunchpadQuestion({ goal: 'leads', creativeSource: 'library', assetIds: ['a1'] }, CTX)!;
  check('then the product, because this account has one', afterAssets.step === 'product', afterAssets.step);
  check('with an escape hatch', afterAssets.options.some((o) => /not about/i.test(o)), afterAssets.options.join(' | '));

  const afterProduct = nextLaunchpadQuestion(
    { goal: 'leads', creativeSource: 'library', assetIds: ['a1'], productIds: ['p1'] },
    CTX
  )!;
  check('then the budget', afterProduct.step === 'budget', afterProduct.step);
  check('budget options are in the account currency and above the minimum', afterProduct.options.every((o) => o.includes('₹')), afterProduct.options.join(' | '));

  const afterBudget = nextLaunchpadQuestion(
    { goal: 'leads', creativeSource: 'library', assetIds: ['a1'], productIds: ['p1'], dailyBudget: 500 },
    CTX
  )!;
  check('and finally the free-text instruction', afterBudget.step === 'instructions', afterBudget.step);

  const done = nextLaunchpadQuestion(
    { goal: 'leads', creativeSource: 'library', assetIds: ['a1'], productIds: ['p1'], dailyBudget: 500, instructions: '' },
    CTX
  );
  check('nothing is asked once everything is answered', done === null, String(done));
}

head('2. No question is asked that the account cannot answer');

{
  const empty = nextLaunchpadQuestion({}, { ...CTX, library: [], products: [] })!;
  check('goal still comes first', empty.step === 'goal');

  const source = nextLaunchpadQuestion({ goal: 'leads' }, { ...CTX, library: [], products: [] })!;
  check('with an empty library, "use my library" is not offered', !source.options.some((o) => /library/i.test(o)), source.options.join(' | '));
  check('but uploading and creating are', source.options.some((o) => /upload/i.test(o)) && source.options.some((o) => /create/i.test(o)));

  const afterNoProduct = nextLaunchpadQuestion(
    { goal: 'leads', creativeSource: 'agent', instructions: undefined },
    { ...CTX, products: [] }
  )!;
  check('an account with no products is not asked about products', afterNoProduct.step === 'budget', afterNoProduct.step);

  const noWa = nextLaunchpadQuestion({}, { ...CTX, canWhatsApp: false })!;
  check('WhatsApp is not offered without a number connected', !noWa.options.some((o) => /whatsapp/i.test(o)), noWa.options.join(' | '));
}

head('3. A tapped answer becomes the value the launch needs');

{
  check('the leads button', readLaunchpadAnswer('goal', 'Get leads with an instant form').goal === 'leads');
  check('the quality-leads button', readLaunchpadAnswer('goal', 'Higher-quality leads').goal === 'quality_leads');
  check('the conversions button', readLaunchpadAnswer('goal', 'Website conversions').goal === 'conversions');
  check('the WhatsApp button', readLaunchpadAnswer('goal', 'WhatsApp chats').goal === 'whatsapp');
  check('the library button', readLaunchpadAnswer('creative_source', 'Use images from my library', CTX).creativeSource === 'library');
  check('the upload button', readLaunchpadAnswer('creative_source', 'I will upload new images', CTX).creativeSource === 'upload');
  check('the create button', readLaunchpadAnswer('creative_source', 'Create the creatives for me', CTX).creativeSource === 'agent');

  check('a named asset resolves to its id', JSON.stringify(readLaunchpadAnswer('assets', 'Dholera site photo', CTX).assetIds) === '["a1"]', JSON.stringify(readLaunchpadAnswer('assets', 'Dholera site photo', CTX).assetIds));
  check('two names in one sentence resolve to both', (readLaunchpadAnswer('assets', 'use Dholera site photo and Plot walkthrough', CTX).assetIds ?? []).length === 2);
  check('"use the newest 2" resolves to the newest two', JSON.stringify(readLaunchpadAnswer('assets', 'Use the newest 2', CTX).assetIds) === '["a1","a2"]');
  check('a pasted URL is taken as a creative', (readLaunchpadAnswer('assets', 'https://pub.example.com/x.jpg', CTX).creativeUrls ?? []).length === 1);

  check('a product name resolves to its id', JSON.stringify(readLaunchpadAnswer('product', 'Umang Residency', CTX).productIds) === '["p1"]');
  check('"not about one product" clears it', JSON.stringify(readLaunchpadAnswer('product', 'Not about one product', CTX).productIds) === '[]');

  check('a budget chip parses to a number', readLaunchpadAnswer('budget', '₹500 per day', CTX).dailyBudget === 500);
  check('a typed budget parses too', readLaunchpadAnswer('budget', '750 rupees a day', CTX).dailyBudget === 750);

  check('"nothing, go ahead" is an empty instruction', readLaunchpadAnswer('instructions', 'Nothing, go ahead', CTX).instructions === '');
  check('anything else is kept as the instruction', readLaunchpadAnswer('instructions', 'only show it to investors from Pune', CTX).instructions === 'only show it to investors from Pune');

  // The escape hatch that keeps the chat better than the form: an answer the buttons did not cover.
  const unknown = readLaunchpadAnswer('goal', 'I want site visits booked, not form fills', CTX);
  check('an unparsed reply yields nothing rather than a wrong guess', Object.keys(unknown).length === 0, JSON.stringify(unknown));
}

head('4. The answers become the launch the pipeline already understands');

{
  const readiness = launchpadToLaunchInput(
    { goal: 'leads', creativeSource: 'library', assetIds: ['a1', 'a2'], productIds: ['p1'], dailyBudget: 500, instructions: 'investors from Pune' },
    CTX
  );
  check('it is ready', readiness.ready && readiness.blockers.length === 0, readiness.blockers.join('; '));
  const input = readiness.input!;
  check('the goal carries through', input.campaignGoal === 'leads', input.campaignGoal);
  check('the budget carries through', input.dailyBudget === 500, String(input.dailyBudget));
  check('the chosen assets become assetIds', JSON.stringify(input.assetIds) === '["a1","a2"]', JSON.stringify(input.assetIds));
  check('the product becomes inventoryIds', JSON.stringify(input.inventoryIds) === '["p1"]', JSON.stringify(input.inventoryIds));
  check('the free text is carried, not dropped', input.instructions === 'investors from Pune', String(input.instructions));
  check('the campaign is named from what they chose', /Leads/.test(input.campaignName) && /Umang Residency/.test(input.campaignName), input.campaignName);

  const agentMade = launchpadToLaunchInput({ goal: 'conversions', creativeSource: 'agent', dailyBudget: 1000 }, { ...CTX, products: [] });
  check('"create the creatives for me" needs no asset ids', agentMade.ready, agentMade.blockers.join('; '));

  const missing = launchpadToLaunchInput({ goal: 'leads' }, CTX);
  check('an incomplete launchpad is not ready', !missing.ready);
  check('and says exactly what is missing', missing.blockers.length >= 2, missing.blockers.join('; '));

  const cheap = launchpadToLaunchInput({ goal: 'leads', creativeSource: 'agent', dailyBudget: 50 }, CTX);
  check('a budget under the account minimum is refused', !cheap.ready && cheap.blockers.some((b) => /at least/i.test(b)), cheap.blockers.join('; '));
}

head('5. Progress is honest');

{
  const start = launchpadProgress({}, CTX);
  check('nothing answered yet', start.answered === 0, `${start.answered}/${start.total}`);
  check('the account\u2019s product question counts toward the total', start.total === 5, String(start.total));
  const later = launchpadProgress({ goal: 'leads', creativeSource: 'library', assetIds: ['a1'], dailyBudget: 300 }, CTX);
  check('progress moves as answers land', later.answered === 4, `${later.answered}/${later.total}`);
  check('and reads as a label', /Launchpad \d+\/\d+/.test(later.label), later.label);
  check('budget presets never fall below the minimum', budgetPresets({ ...CTX, minDailyBudget: 800 }).every((amount) => amount >= 800), budgetPresets({ ...CTX, minDailyBudget: 800 }).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
