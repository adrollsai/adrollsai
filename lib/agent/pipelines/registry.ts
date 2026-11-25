/**
 * The registry: every repeatable workflow in the app, as a spec the agent can run.
 *
 * Each entry is a boilerplate for one screen's worth of decisions, ending in the composed tool that
 * actually does the work. Adding a workflow means adding a spec here — there is no second tool to
 * write, no extra prompt paragraph, and no chance of the chat and the screen asking different things.
 *
 * The six that exist today are the ones the product can currently do end to end. Each spec states the
 * tool it ends in, and `verify:pipelines` proves that tool is real, so a spec cannot point at
 * something that was renamed or never registered.
 */

import {
  buildPipeline,
  firstUnnegated,
  money,
  numberFrom,
  type PipelineCompletion,
  type PipelineContext,
  type PipelineQuestion,
  type PipelineSpec,
} from './types';
import {
  launchpadProgress,
  launchpadToLaunchInput,
  nextLaunchpadQuestion,
  readLaunchpadAnswer,
  type LaunchpadContext,
} from '@/lib/ads/launchpad';

/** The launchpad already exists; adapt it rather than keeping two ad interviews in step. */
function launchpadContext(ctx: PipelineContext): LaunchpadContext {
  return {
    currency: ctx.currency,
    minDailyBudget: ctx.minDailyBudget,
    canWhatsApp: true,
    library: ctx.assets.map((asset) => ({ id: asset.id, label: asset.label, kind: asset.kind, url: asset.url })),
    products: ctx.products,
  };
}

const adLaunch: PipelineSpec = {
  id: 'ad_launch',
  title: 'Launch an ad campaign',
  summary: 'goal → creative source → creative → product → daily budget → anything else',
  targetTool: 'launch_meta_campaign',
  examples: ['run a campaign', 'get me more leads', 'advertise the new project'],
  nextQuestion(answers, ctx) {
    const question = nextLaunchpadQuestion(answers as any, launchpadContext(ctx));
    if (!question) return null;
    return {
      step: question.step,
      question: question.question,
      context: [question.context, launchpadProgress(answers as any, launchpadContext(ctx)).label]
        .filter(Boolean)
        .join(' · '),
      options: question.options,
      allowsFreeText: true,
    };
  },
  parse(step, answer, ctx) {
    const parsed = readLaunchpadAnswer(step as any, answer, launchpadContext(ctx));
    return Object.keys(parsed).length ? (parsed as Record<string, any>) : null;
  },
  complete(answers, ctx): PipelineCompletion {
    const readiness = launchpadToLaunchInput(answers as any, launchpadContext(ctx));
    if (!readiness.ready || !readiness.input) return { ready: false, blockers: readiness.blockers };
    const { instructions, ...args } = readiness.input;
    return {
      ready: true,
      call: { tool: 'launch_meta_campaign', args },
      notes: instructions ? [`Honour this instruction from them: "${instructions}"`] : [],
    };
  },
};

/** "Submit a WhatsApp template for approval" — the screen's questions, in its order. */
const whatsappTemplate = buildPipeline({
  id: 'whatsapp_template',
  title: 'Create a WhatsApp template',
  summary: 'purpose → name → body copy → header → footer',
  targetTool: 'whatsapp_create_template',
  examples: ['create a template', 'make a WhatsApp template for Diwali', 'submit a message template'],
  steps: [
    {
      id: 'category',
      question: 'What is this template for?',
      context: 'Marketing templates carry offers; utility templates carry account or service updates. Meta reviews both.',
      options: () => ['A marketing offer', 'An account or service update'],
      parse: (answer) => {
        const value = firstUnnegated(answer, [
          [/utility|account|service|update|order|receipt|reminder/, 'UTILITY'],
          [/market|offer|promo|sale|discount/, 'MARKETING'],
        ]);
        return value ? { category: value } : null;
      },
    },
    {
      id: 'name',
      question: 'What should I call it?',
      context: 'Lowercase with underscores, e.g. diwali_offer_v1. This is the internal name, not the words the customer sees.',
      options: () => ['Name it for me'],
      parse: (answer) => {
        if (/name it for me/i.test(answer)) return { name: null };
        const slug = String(answer).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
        return slug ? { name: slug } : null;
      },
    },
    {
      id: 'body',
      question: 'What should the message say?',
      context: 'Use {{1}}, {{2}} where the values change per send (a name, an amount). This is the part the customer reads.',
      options: () => [],
      parse: (answer) => (String(answer).trim().length >= 4 ? { bodyText: String(answer).trim() } : null),
    },
    {
      id: 'header',
      question: 'Does it need a header?',
      context: 'A header sits above the message: plain text, or an image that makes the message look like an ad.',
      options: () => ['No header', 'A text header', 'An image header'],
      parse: (answer) => {
        const value = firstUnnegated(answer, [
          [/image|picture|photo/, 'image'],
          [/text|title/, 'text'],
          [/none|no header|without/, 'none'],
        ]);
        return value ? { headerMode: value } : null;
      },
    },
    {
      id: 'headerText',
      when: (answers) => answers.headerMode === 'text',
      question: 'What should the header say?',
      context: 'Max 60 characters — it is a line, not a paragraph.',
      options: () => [],
      parse: (answer) => (String(answer).trim() ? { headerText: String(answer).trim().slice(0, 60) } : null),
    },
    {
      id: 'headerImage',
      when: (answers) => answers.headerMode === 'image',
      question: 'Which image should be the sample?',
      context: 'Meta needs a sample picture to approve an image header. Pick one from your library.',
      options: (_answers, ctx) => ctx.assets.slice(0, 6).map((asset) => asset.label),
      parse: (answer, _answers, ctx) => {
        const asset = ctx.assets.find((entry) => String(answer).toLowerCase().includes(entry.label.toLowerCase()));
        const url = asset?.url ?? (String(answer).match(/https?:\/\/\S+/g) ?? [])[0];
        return url ? { headerImageUrl: url } : null;
      },
    },
    {
      id: 'footer',
      question: 'Anything to put in the footer?',
      context: 'A short line under the message — an opt-out, an address, a disclaimer. Optional.',
      options: () => ['No footer'],
      parse: (answer) => {
        if (/no footer|nothing|skip|none/i.test(answer)) return { footerText: null };
        return String(answer).trim() ? { footerText: String(answer).trim().slice(0, 60) } : null;
      },
    },
  ],
  complete(answers) {
    const blockers: string[] = [];
    if (!answers.bodyText) blockers.push('the message copy');
    if (blockers.length) return { ready: false, blockers };

    const derivedName =
      answers.name ||
      String(answers.bodyText)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) + '_v1';

    return {
      ready: true,
      call: {
        tool: 'whatsapp_create_template',
        args: {
          name: derivedName,
          category: answers.category ?? 'MARKETING',
          bodyText: answers.bodyText,
          ...(answers.headerText ? { headerText: answers.headerText } : {}),
          ...(answers.headerImageUrl ? { headerImageUrl: answers.headerImageUrl } : {}),
          ...(answers.footerText ? { footerText: answers.footerText } : {}),
        },
      },
      notes: ['Meta reviews a new template, so it will be PENDING at first — tell the owner that, and that only an APPROVED template can be broadcast.'],
    };
  },
});

/** "Call my leads" — the calling screen's own campaign builder. */
const callingCampaign = buildPipeline({
  id: 'calling_campaign',
  title: 'Start a voice calling campaign',
  summary: 'who to call → what to say → voice → when → how many',
  targetTool: 'start_calling_campaign',
  examples: ['call my leads', 'run a calling campaign', 'phone the Diwali enquiries'],
  steps: [
    {
      id: 'audience',
      question: 'Who should be called?',
      context: 'A saved audience group is the safe way to dial the same people twice.',
      options: (_answers, ctx) => [...ctx.audienceGroups.slice(0, 6).map((group) => group.name), 'Dial the whole lead book'],
      parse: (answer, _answers, ctx) => {
        if (/whole|everyone|all leads|lead book/i.test(answer)) return { audience: 'all' };
        const group = ctx.audienceGroups.find((entry) => String(answer).toLowerCase().includes(entry.name.toLowerCase()));
        return group ? { audience: 'group', groupName: group.name } : null;
      },
    },
    {
      id: 'purpose',
      question: 'What should the agent say it is calling about?',
      context: 'The opening line is built from this, so keep it short: "your site visit", "the November offer".',
      options: () => ['Follow up on their enquiry', 'Confirm their site visit', 'Tell them about the current offer'],
      parse: (answer) => (String(answer).trim() ? { scriptNotes: String(answer).trim() } : null),
    },
    {
      id: 'voice',
      question: 'Which voice should call?',
      options: (_answers, ctx) => ctx.voices,
      parse: (answer, _answers, ctx) => {
        const voice = ctx.voices.find((entry) => String(answer).toLowerCase().includes(entry.toLowerCase()));
        return voice ? { voiceName: voice } : null;
      },
    },
    {
      id: 'when',
      question: 'When should it start?',
      options: () => ['Now', 'In the morning', 'I will choose a time'],
      parse: (answer) => {
        const value = firstUnnegated(answer, [
          [/now|straight away|immediately/, 'now'],
          [/morning|tomorrow/, 'next morning'],
          [/choose|later|pick/, 'ask me later'],
        ]);
        return value ? { when: value } : null;
      },
    },
    {
      id: 'maxLeads',
      question: 'How many leads should it call?',
      context: 'Start small — the first calls tell you whether the script works.',
      options: () => ['25 leads', '50 leads', '100 leads'],
      parse: (answer) => {
        const count = numberFrom(answer);
        return count ? { maxLeads: Math.min(Math.max(Math.round(count), 1), 200) } : null;
      },
    },
  ],
  complete(answers) {
    if (!answers.scriptNotes) return { ready: false, blockers: ['what the call should be about'] };
    const name = `Calling · ${String(answers.scriptNotes).slice(0, 40)}`;
    return {
      ready: true,
      call: {
        tool: 'start_calling_campaign',
        args: {
          name,
          ...(answers.groupName ? { groupName: answers.groupName } : {}),
          scriptNotes: answers.scriptNotes,
          ...(answers.voiceName ? { voiceName: answers.voiceName } : {}),
          ...(answers.when ? { when: answers.when } : {}),
          ...(answers.maxLeads ? { maxLeads: answers.maxLeads } : {}),
        },
      },
      notes: answers.audience === 'all' ? ['They chose the WHOLE lead book. Say the number of leads that will be dialled before starting.'] : [],
    };
  },
});

/** "Build me an audience" — the CRM audience screen. */
const customAudience = buildPipeline({
  id: 'custom_audience',
  title: 'Create a custom audience',
  summary: 'name → who is in it → which campaign/stage → description',
  targetTool: 'create_audience_group',
  examples: ['make an audience', 'group my Diwali leads', 'build a list of 3BHK buyers'],
  steps: [
    {
      id: 'name',
      question: 'What should this audience be called?',
      context: 'The name is how you will pick it later — make it say who is in it.',
      options: () => ['Name it from my answer'],
      parse: (answer) => (String(answer).trim() ? { name: String(answer).trim().slice(0, 60) } : null),
    },
    {
      id: 'filterKind',
      question: 'What puts a lead in this audience?',
      options: () => ['The campaign they came from', 'The pipeline stage they are at', 'Every lead with a phone number'],
      parse: (answer) => {
        const value = firstUnnegated(answer, [
          [/campaign|ad\b/, 'campaign'],
          [/stage|pipeline|qualified|visit/, 'stage'],
          [/every|all|phone/, 'all'],
        ]);
        return value ? { filterKind: value } : null;
      },
    },
    {
      id: 'filterValue',
      when: (answers) => answers.filterKind === 'campaign' || answers.filterKind === 'stage',
      question: 'Which one?',
      context: 'Name it exactly as the CRM shows it, and I will match it.',
      options: () => [],
      parse: (answer) => (String(answer).trim() ? { filterValue: String(answer).trim() } : null),
    },
  ],
  complete(answers) {
    if (!answers.name) return { ready: false, blockers: ['a name for the audience'] };
    const filters =
      answers.filterKind === 'campaign' && answers.filterValue
        ? { campaigns: [answers.filterValue] }
        : answers.filterKind === 'stage' && answers.filterValue
          ? { pipelineStages: [answers.filterValue] }
          : undefined;
    return {
      ready: true,
      call: {
        tool: 'create_audience_group',
        args: { name: answers.name, ...(filters ? { filters } : {}) },
      },
      notes: [
        filters
          ? 'Call preview_audience first and tell the owner the count before saving, if they have not seen it.'
          : 'This audience is the whole lead book — say the count out loud before saving it.',
      ],
    };
  },
});

/** "Retarget the people who already know me." */
const retargetingCampaign = buildPipeline({
  id: 'retargeting_campaign',
  title: 'Launch a retargeting campaign',
  summary: 'who to retarget → which audience → daily budget',
  targetTool: 'launch_meta_retargeting',
  examples: ['retarget my qualified leads', 'run a remarketing campaign', 'advertise to my past leads'],
  steps: [
    {
      id: 'source',
      question: 'Who should see the retargeting ads?',
      options: () => ['Leads in my CRM', 'An audience I already have', 'A list of phone numbers', 'A lookalike of my best leads'],
      parse: (answer) => {
        const value = firstUnnegated(answer, [
          [/lookalike|similar/, 'lookalike'],
          [/phone|number|list/, 'phones'],
          [/already|existing|meta audience|audience i/, 'existing'],
          [/crm|my leads|pipeline|qualified/, 'crm_leads'],
        ]);
        return value ? { source: value } : null;
      },
    },
    {
      id: 'audience',
      when: (answers) => answers.source === 'crm_leads',
      question: 'Which group of leads?',
      options: (_a, ctx) => [...ctx.audienceGroups.slice(0, 6).map((group) => group.name), 'All my leads'],
      parse: (answer, _a, ctx) => {
        if (/all my leads|everyone/i.test(answer)) return { audienceGroupName: null };
        const group = ctx.audienceGroups.find((entry) => String(answer).toLowerCase().includes(entry.name.toLowerCase()));
        return group ? { audienceGroupName: group.name } : null;
      },
    },
    {
      id: 'audienceId',
      when: (answers) => answers.source === 'existing' || answers.source === 'lookalike',
      question: 'Which audience?',
      context: 'The Meta audience id, or its exact name.',
      options: () => [],
      parse: (answer) => (String(answer).trim() ? { audienceId: String(answer).trim() } : null),
    },
    {
      id: 'phones',
      when: (answers) => answers.source === 'phones',
      question: 'Paste the phone numbers.',
      context: 'With country code, one per line or comma separated. They are hashed before they leave us.',
      options: () => [],
      parse: (answer) => {
        /**
         * Numbers arrive written the way people write them: "+91 98765 43210", "98765-43210",
         * "(+91) 9876543210", comma or newline separated. Splitting on whitespace shredded every one of
         * those into fragments too short to be a phone number, and the step re-asked as if nothing had
         * been typed. Match whole numbers instead, then strip the punctuation.
         */
        const candidates = String(answer).match(/\+?\d[\d\s\-().]*\d/g) ?? [];
        const numbers = candidates
          .map((entry) => entry.replace(/\D/g, ''))
          .filter((entry) => entry.length >= 8 && entry.length <= 15);
        return numbers.length ? { phones: Array.from(new Set(numbers)) } : null;
      },
    },
    {
      id: 'dailyBudget',
      question: 'What should I spend per day on this?',
      context: 'Retargeting is usually the cheapest traffic you have — start small and scale what works.',
      options: (_a, ctx) => [300, 500, 1000].filter((amount) => amount >= ctx.minDailyBudget).map((amount) => `${money(ctx.currency, amount)} per day`),
      parse: (answer) => {
        const amount = numberFrom(answer);
        return amount ? { dailyBudget: amount } : null;
      },
    },
  ],
  complete(answers, ctx) {
    const blockers: string[] = [];
    if (!answers.source) blockers.push('who to retarget');
    if (!answers.dailyBudget) blockers.push('a daily budget');
    else if (answers.dailyBudget < ctx.minDailyBudget) blockers.push(`a budget of at least ${money(ctx.currency, ctx.minDailyBudget)}`);
    if (answers.source === 'phones' && !answers.phones?.length) blockers.push('the phone numbers');
    if ((answers.source === 'existing' || answers.source === 'lookalike') && !answers.audienceId) blockers.push('which Meta audience');
    if (blockers.length) return { ready: false, blockers };

    return {
      ready: true,
      call: {
        tool: 'launch_meta_retargeting',
        args: {
          source: answers.source,
          campaignName: `Retargeting · ${answers.audienceGroupName || answers.audienceId || 'existing leads'}`,
          dailyBudget: answers.dailyBudget,
          ...(answers.audienceGroupName ? { audienceGroupName: answers.audienceGroupName } : {}),
          ...(answers.source === 'existing' ? { audienceId: answers.audienceId } : {}),
          ...(answers.source === 'lookalike' ? { originAudienceId: answers.audienceId } : {}),
          ...(answers.phones?.length ? { phones: answers.phones } : {}),
        },
      },
    };
  },
});

/** "Add this property to the catalogue" — the inventory screen. */
const inventoryProduct = buildPipeline({
  id: 'inventory_product',
  title: 'Add a product or property',
  summary: 'title → price → location → type → description → pictures',
  targetTool: 'add_catalog_offering',
  examples: ['add a property', 'put this project in my catalogue', 'list a new product'],
  steps: [
    {
      id: 'title',
      question: 'What is it called?',
      context: 'The name as you would say it to a customer.',
      options: () => [],
      parse: (answer) => (String(answer).trim() ? { title: String(answer).trim().slice(0, 120) } : null),
    },
    {
      id: 'price',
      question: 'What does it cost?',
      context: 'The full figure, e.g. 8500000 or 85 lakh. Never a bare "85" — that reads as ₹85.',
      options: () => [],
      parse: (answer) => {
        const text = String(answer).trim();
        if (!text) return null;
        const lakhs = text.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs)/i);
        if (lakhs) return { price: String(Math.round(Number(lakhs[1]) * 100_000)) };
        const crores = text.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/i);
        if (crores) return { price: String(Math.round(Number(crores[1]) * 10_000_000)) };
        const plain = text.replace(/[^\d.]/g, '');
        return plain ? { price: plain } : { price: text };
      },
    },
    {
      id: 'address',
      question: 'Where is it?',
      options: () => [],
      parse: (answer) => (String(answer).trim() ? { address: String(answer).trim().slice(0, 200) } : null),
    },
    {
      id: 'propertyType',
      question: 'What kind of thing is it?',
      options: () => ['Apartment', 'Plot', 'Villa', 'Commercial', 'Service or package'],
      parse: (answer) => (String(answer).trim() ? { propertyType: String(answer).trim().slice(0, 60) } : null),
    },
    {
      id: 'image',
      question: 'Which pictures should it use?',
      context: 'Pick one from your library now — more can be attached later.',
      options: (_a, ctx) => [...ctx.assets.slice(0, 6).map((asset) => asset.label), 'None for now'],
      parse: (answer, _a, ctx) => {
        if (/none|no picture|later/i.test(answer)) return { imageUrls: [] };
        const asset = ctx.assets.find((entry) => String(answer).toLowerCase().includes(entry.label.toLowerCase()));
        const urls = String(answer).match(/https?:\/\/\S+/g) ?? [];
        const chosen = asset?.url ? [asset.url] : urls;
        return chosen.length ? { imageUrls: chosen } : null;
      },
    },
    {
      id: 'description',
      question: 'Anything else a customer should know?',
      context: 'Specs, highlights, what is included. Optional — say "nothing" to skip.',
      options: () => ['Nothing else'],
      parse: (answer) => {
        if (/nothing|no|skip|that.s it/i.test(answer)) return { description: null };
        return String(answer).trim() ? { description: String(answer).trim().slice(0, 1200) } : null;
      },
    },
  ],
  complete(answers) {
    const blockers: string[] = [];
    if (!answers.title) blockers.push('a name');
    if (!answers.price) blockers.push('a price');
    if (blockers.length) return { ready: false, blockers };
    return {
      ready: true,
      call: {
        tool: 'add_catalog_offering',
        args: {
          title: answers.title,
          price: String(answers.price),
          ...(answers.address ? { address: answers.address } : {}),
          ...(answers.propertyType ? { propertyType: answers.propertyType } : {}),
          ...(answers.description ? { description: answers.description } : {}),
          ...(answers.imageUrls?.length ? { imageUrls: answers.imageUrls } : {}),
        },
      },
    };
  },
});

export const PIPELINES: PipelineSpec[] = [
  adLaunch,
  whatsappTemplate,
  callingCampaign,
  customAudience,
  retargetingCampaign,
  inventoryProduct,
];

export const PIPELINE_IDS = PIPELINES.map((pipeline) => pipeline.id);

export function findPipeline(id: string | null | undefined): PipelineSpec | null {
  const wanted = String(id || '').trim().toLowerCase();
  if (!wanted) return null;
  return (
    PIPELINES.find((pipeline) => pipeline.id === wanted) ??
    // Accept the human title too, so a model echoing "Launch an ad campaign" still lands.
    PIPELINES.find((pipeline) => pipeline.title.toLowerCase() === wanted) ??
    null
  );
}

/** The menu, as tappable labels — this is what a fresh session sees first. */
export function pipelineMenu(): Array<{ id: string; label: string; summary: string }> {
  return PIPELINES.map((pipeline) => ({ id: pipeline.id, label: pipeline.title, summary: pipeline.summary }));
}

/** Resolve a tapped menu label (or a title, or an id) back to a pipeline. */
export function pipelineFromAnswer(answer: string): PipelineSpec | null {
  const lower = String(answer || '').toLowerCase();
  const byId = findPipeline(lower);
  if (byId) return byId;
  return (
    PIPELINES.find((pipeline) => lower.includes(pipeline.title.toLowerCase())) ??
    PIPELINES.find((pipeline) => (pipeline.examples ?? []).some((example) => lower.includes(example.toLowerCase()))) ??
    null
  );
}

export type { PipelineQuestion };
