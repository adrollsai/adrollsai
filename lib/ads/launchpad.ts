/**
 * The ads launchpad, as a conversation.
 *
 * The owner's ask: when someone says "launch a campaign" in chat, do not improvise a campaign out of
 * primitives — walk them through OUR launchpad, in the same order the ads tab does, with the answers
 * offered as things you can tap. And leave a free-text box on every question, because the agent can
 * do things the launchpad cannot (a custom instruction is often the whole point).
 *
 * WHY THIS IS A PURE MODULE
 * The ordering, the options and the mapping to the launch payload are the product here. They are
 * kept free of the database and of the model so a gate can prove that, for example, "Use images from
 * my library" actually ends up as asset ids on the launch instead of a sentence nobody reads.
 *
 * THE TAIL IS THE REAL PIPELINE
 * This does not create anything. It produces the exact input `launch_meta_campaign` takes, which runs
 * the same plan, preflight and processor as the ads screen — so a launch started in chat and a launch
 * started from the ads tab cannot drift apart, and the approval gate still stands in front of the
 * spend.
 */

export type LaunchGoal = 'leads' | 'quality_leads' | 'conversions' | 'whatsapp';
export type CreativeSource = 'library' | 'upload' | 'agent';

export interface LaunchpadAnswers {
  goal?: LaunchGoal;
  creativeSource?: CreativeSource;
  /** Library asset ids the owner picked. */
  assetIds?: string[];
  /** Public URLs they attached in the chat (the upload path). */
  creativeUrls?: string[];
  /** Products/properties the campaign is for. */
  productIds?: string[];
  dailyBudget?: number;
  /** Anything they want the agent to follow that the questions did not cover. */
  instructions?: string;
  startPaused?: boolean;
}

export interface LaunchpadAsset {
  id: string;
  label: string;
  kind?: string;
  /** A public URL, so the chat can show the picture instead of asking the owner to recognise a name. */
  url?: string;
  /** A small preview, when the pipeline stores one separately. */
  thumbnailUrl?: string;
}

export interface LaunchpadProduct {
  id: string;
  label: string;
}

export interface LaunchpadContext {
  library?: LaunchpadAsset[];
  products?: LaunchpadProduct[];
  currency?: string;
  minDailyBudget?: number;
  canLeadForms?: boolean;
  canWhatsApp?: boolean;
}

export type LaunchpadStep =
  | 'goal'
  | 'creative_source'
  | 'assets'
  | 'product'
  | 'budget'
  | 'instructions'
  | 'ready';

export interface LaunchpadQuestion {
  step: LaunchpadStep;
  question: string;
  context?: string;
  /** Tap-able answers. Empty means "type it", which is right for the free-text step. */
  options: string[];
  /** Always true: the agent may do more than the buttons offer. */
  allowsFreeText: boolean;
}

const money = (currency: string, amount: number): string =>
  currency === 'INR' ? `₹${amount.toLocaleString('en-IN')}` : `${currency} ${amount.toLocaleString('en-US')}`;

/** The budget presets shown as buttons, in the account's own currency. */
export function budgetPresets(ctx: LaunchpadContext): number[] {
  const minimum = Number(ctx.minDailyBudget ?? 0) || 0;
  const base = [300, 500, 1000, 2000].filter((amount) => amount >= minimum);
  return (base.length ? base : [Math.max(minimum, 300)]).slice(0, 4);
}

/**
 * The next thing to ask — or null when there is nothing left to ask.
 *
 * Order matters and is deliberate: the GOAL decides which destinations are legal (an instant form,
 * a website pixel, a WhatsApp chat), so it comes first; the creative source decides whether we need
 * to talk about assets at all; the product is only worth asking when the account actually has one,
 * because a question with no useful answer is how a form feels like a tax form.
 */
export function nextLaunchpadQuestion(
  answers: LaunchpadAnswers,
  ctx: LaunchpadContext = {}
): LaunchpadQuestion | null {
  if (!answers.goal) {
    const options = [
      'Get leads with an instant form',
      ...(answers.goal === undefined && ctx.canLeadForms === false ? [] : ['Higher-quality leads']),
      'Website conversions',
      ...(ctx.canWhatsApp === false ? [] : ['WhatsApp chats']),
    ];
    return {
      step: 'goal',
      question: 'What should this campaign bring you?',
      context: 'This decides where the ad sends people, and what Meta optimises for.',
      options,
      allowsFreeText: true,
    };
  }

  if (!answers.creativeSource) {
    const hasLibrary = (ctx.library?.length ?? 0) > 0;
    return {
      step: 'creative_source',
      question: 'What should the ads show?',
      context: hasLibrary
        ? `${ctx.library!.length} item${ctx.library!.length === 1 ? '' : 's'} in your library — pick one of these, or have me create something new.`
        : 'Your library is empty, so I can create the creative or use images you upload here.',
      options: [
        ...(hasLibrary ? ['Use images from my library'] : []),
        'I will upload new images',
        'Create the creatives for me',
      ],
      allowsFreeText: true,
    };
  }

  if (answers.creativeSource === 'library' && !(answers.assetIds?.length || 0)) {
    const library = ctx.library ?? [];
    return {
      step: 'assets',
      question: 'Which creatives should run?',
      context: 'Tap one, or name the ones you mean — I can take several.',
      options: [
        ...library.slice(0, 6).map((asset) => asset.label),
        ...(library.length > 1 ? ['Use the newest 3'] : []),
      ],
      allowsFreeText: true,
    };
  }

  /**
   * "I will upload" needs somewhere to upload TO.
   *
   * Without this the flow moved straight on to the budget and only noticed at the end that there was
   * no creative, which reads as the launchpad forgetting what was just said. Asking here means the
   * answer arrives in the same conversation, and the attachments are the answer.
   */
  if (answers.creativeSource === 'upload' && !(answers.creativeUrls?.length || 0)) {
    return {
      step: 'assets',
      question: 'Send me the images to run',
      context: 'Attach them in the chat — images or one short video. I will use exactly what you send.',
      options: [],
      allowsFreeText: true,
    };
  }

  if ((ctx.products?.length ?? 0) > 0 && !(answers.productIds?.length || 0)) {
    const products = ctx.products!;
    return {
      step: 'product',
      question: 'Which product or property is this for?',
      context: 'The ad copy and the form questions are written from this.',
      options: [...products.slice(0, 6).map((product) => product.label), 'Not about one product'],
      allowsFreeText: true,
    };
  }

  if (!answers.dailyBudget) {
    const currency = ctx.currency ?? 'INR';
    return {
      step: 'budget',
      question: 'What should I spend per day?',
      context: `Minimum on this account is ${money(currency, Number(ctx.minDailyBudget ?? 0))}. You can change it later.`,
      options: budgetPresets(ctx).map((amount) => `${money(currency, amount)} per day`),
      allowsFreeText: true,
    };
  }

  if (answers.instructions === undefined) {
    return {
      step: 'instructions',
      question: 'Anything you want me to follow?',
      context:
        'Optional. Say it however you like — audience, offer, tone, what to avoid — and I will follow it ' +
        'even where the launchpad has no field for it.',
      options: ['Nothing, go ahead'],
      allowsFreeText: true,
    };
  }

  return null;
}

/**
 * Was the word at this position being ruled OUT rather than asked for?
 *
 * "I want site visits booked, not form fills" contains "form", and a naive match reads that as
 * "this owner wants an instant form" — the exact opposite. Since a wrong guess here spends money on
 * the wrong campaign, a cue only counts when the words just before it are not a negation.
 */
function isNegated(answer: string, index: number): boolean {
  const before = answer.slice(Math.max(0, index - 26), index).toLowerCase();
  return /\b(not|no|never|without|don'?t|do not|instead of|rather than|except)\b[\s\w]{0,14}$/.test(before);
}

/** First cue in the list that appears and is not being negated. */
function firstUnnegated(answer: string, cues: Array<[RegExp, string]>): string | null {
  const lower = answer.toLowerCase();
  for (const [pattern, value] of cues) {
    const match = lower.match(pattern);
    if (!match || match.index === undefined) continue;
    if (isNegated(lower, match.index)) continue;
    return value;
  }
  return null;
}

/** Read one answered question. The chip text is the answer, so parsing lives with the question. */
export function readLaunchpadAnswer(
  step: LaunchpadStep,
  rawAnswer: string,
  ctx: LaunchpadContext = {}
): Partial<LaunchpadAnswers> {
  const answer = String(rawAnswer ?? '').trim();
  const lower = answer.toLowerCase();

  if (step === 'goal') {
    const goal = firstUnnegated(lower, [
      [/quality|better lead|higher/, 'quality_leads'],
      [/whatsapp|\bchat\b/, 'whatsapp'],
      [/conversion|website|pixel|purchase|\bsale/, 'conversions'],
      [/\blead|form|enquir|inquir/, 'leads'],
    ]);
    return goal ? { goal: goal as LaunchGoal } : {};
  }

  if (step === 'creative_source') {
    const source = firstUnnegated(lower, [
      [/upload|attach|send you|my own/, 'upload'],
      [/create|make|generate|design|new/, 'agent'],
      [/library|existing|already|use my|asset/, 'library'],
    ]);
    return source ? { creativeSource: source as CreativeSource } : {};
  }

  if (step === 'assets') {
    const library = ctx.library ?? [];
    // "Use the newest 3" — the shortcut, resolved here so the tool needs no extra state.
    if (/newest|latest|recent/.test(lower)) {
      const count = Number((answer.match(/(\d+)/) || [])[1] || 3);
      return { assetIds: library.slice(0, Math.max(1, count)).map((asset) => asset.id) };
    }
    /**
     * Match by name, ONE asset per name.
     *
     * Most library items have no caption, so several can end up called "image 2" or share a caption
     * the owner reused. Matching every asset whose label appears in the sentence would then quietly
     * select a creative they never pointed at — and this is a list that decides which photos the ad
     * runs with. First match per label wins; the picker sends distinct labels anyway.
     */
    const seen = new Set<string>();
    const assetIds: string[] = [];
    for (const asset of library) {
      const label = asset.label.toLowerCase();
      if (!label || !lower.includes(label) || seen.has(label)) continue;
      seen.add(label);
      assetIds.push(asset.id);
    }
    if (assetIds.length) return { assetIds };
    // Anything that is a URL is treated as an uploaded creative.
    const urls = answer.match(/https?:\/\/\S+/g) ?? [];
    if (urls.length) return { creativeUrls: urls };
    return {};
  }

  if (step === 'product') {
    if (/not about|none|no product|generic|skip/.test(lower)) return { productIds: [] };
    const products = ctx.products ?? [];
    const matched = products.filter((product) => lower.includes(product.label.toLowerCase()));
    if (matched.length) return { productIds: matched.map((product) => product.id) };
    return {};
  }

  if (step === 'budget') {
    const amount = Number(answer.replace(/[^\d.]/g, ''));
    if (Number.isFinite(amount) && amount > 0) return { dailyBudget: amount };
    return {};
  }

  if (step === 'instructions') {
    if (/^nothing|go ahead|no instructions|skip|none$/i.test(answer)) return { instructions: '' };
    return { instructions: answer };
  }

  return {};
}

export interface LaunchInput {
  campaignName: string;
  dailyBudget: number;
  campaignGoal: LaunchGoal;
  creativeUrls?: string[];
  assetIds?: string[];
  inventoryIds?: string[];
  startPaused?: boolean;
  /** Carried separately: `launch_meta_campaign` has no field for it, the agent must honour it. */
  instructions?: string;
}

export interface LaunchReadiness {
  ready: boolean;
  input?: LaunchInput;
  /** What is still missing, in words the owner would use. */
  blockers: string[];
}

/**
 * Turn the answers into the launch payload, or say what is missing.
 *
 * A "blocker" here is never a silent gap: `launch_meta_campaign` refuses an incomplete launch with one
 * combined question, so this returns the same shape of refusal one step earlier, while the owner is
 * still in the conversation.
 */
export function launchpadToLaunchInput(
  answers: LaunchpadAnswers,
  ctx: LaunchpadContext = {}
): LaunchReadiness {
  const blockers: string[] = [];

  if (!answers.goal) blockers.push('what the campaign should bring (leads, conversions or WhatsApp chats)');
  if (!answers.dailyBudget) blockers.push('a daily budget');
  else if (answers.dailyBudget < Number(ctx.minDailyBudget ?? 0)) {
    blockers.push(`a daily budget of at least ${money(ctx.currency ?? 'INR', Number(ctx.minDailyBudget ?? 0))}`);
  }

  const hasCreative =
    (answers.assetIds?.length ?? 0) > 0 ||
    (answers.creativeUrls?.length ?? 0) > 0 ||
    answers.creativeSource === 'agent';
  if (!hasCreative) blockers.push('a creative — images from your library, an upload, or one I create');

  if (blockers.length) return { ready: false, blockers };

  const goalLabel: Record<LaunchGoal, string> = {
    leads: 'Leads',
    quality_leads: 'Quality leads',
    conversions: 'Conversions',
    whatsapp: 'WhatsApp',
  };
  const productLabel = ctx.products?.find((product) => product.id === answers.productIds?.[0])?.label;
  const campaignName = [goalLabel[answers.goal!], productLabel].filter(Boolean).join(' · ');

  return {
    ready: true,
    blockers: [],
    input: {
      campaignName: campaignName || 'Nobogent campaign',
      dailyBudget: answers.dailyBudget!,
      campaignGoal: answers.goal!,
      ...(answers.creativeUrls?.length ? { creativeUrls: answers.creativeUrls } : {}),
      ...(answers.assetIds?.length ? { assetIds: answers.assetIds } : {}),
      ...(answers.productIds?.length ? { inventoryIds: answers.productIds } : {}),
      ...(answers.instructions ? { instructions: answers.instructions } : {}),
      ...(answers.startPaused !== undefined ? { startPaused: answers.startPaused } : {}),
    },
  };
}

/** How far along the owner is, for a progress line in the chat. */
export function launchpadProgress(answers: LaunchpadAnswers, ctx: LaunchpadContext = {}): {
  answered: number;
  total: number;
  label: string;
} {
  const total = 4 + ((ctx.products?.length ?? 0) > 0 ? 1 : 0) + (answers.creativeSource === 'library' ? 1 : 0);
  const answered =
    (answers.goal ? 1 : 0) +
    (answers.creativeSource ? 1 : 0) +
    (answers.creativeSource === 'library' && (answers.assetIds?.length ?? 0) > 0 ? 1 : 0) +
    ((ctx.products?.length ?? 0) > 0 && answers.productIds ? 1 : 0) +
    (answers.dailyBudget ? 1 : 0);
  return { answered, total, label: `Launchpad ${answered}/${total}` };
}
