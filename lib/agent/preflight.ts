/* eslint-disable @typescript-eslint/no-explicit-any -- playbook rows are untyped (stale generated types). */
/**
 * PRE-FLIGHT CONTRACT
 *
 * The agent used to start a big action as soon as it was asked for one — launch
 * the campaign, generate the batch, message the segment — and only discover
 * halfway through that it never knew the budget, the cities, which asset to run
 * or what the message was for. The owner then got a half-right job and had to
 * correct it, which is more expensive than being asked up front.
 *
 * Two halves, deliberately:
 *  1. `preflightPromptSection()` — the rule, in the system prompt, as a
 *     checklist. This is what makes the agent ask BEFORE it acts.
 *  2. `checkCampaignLaunch()` / `checkBulkAction()` — a cheap structural guard
 *     the campaign-launch and bulk-action tools run before doing anything. It
 *     catches the case where the model skipped the prompt: the tool refuses and
 *     returns `missingInputs`, which names exactly what to ask.
 *
 * The guard is deliberately permissive. It only blocks on things a tool cannot
 * derive: if the playbook or the catalogue already answers an item, asking the
 * owner again would be the same failure in the other direction. A caller that
 * can resolve a value (the connected ad account's currency, for instance)
 * passes it in and the question disappears.
 *
 * Industry-neutral by construction: every noun comes from `industryVocabulary()`
 * or is written as "offer", "product", "asset", "segment".
 */

import { industryVocabulary } from '@/lib/automation/industry';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface MissingInput {
  /** The parameter the action needs, named as the tool names it. */
  field: string;
  /** The question to put to the owner, in their language. */
  question: string;
  /** What goes wrong if it is guessed — the reason this is worth a question. */
  why: string;
  /** Likely answers, best first. */
  options?: string[];
}

export interface PreflightResult {
  ok: boolean;
  missingInputs: MissingInput[];
}

export interface PreflightContext {
  /**
   * Currency of the connected ad account, when the calling tool already resolved
   * it. The ad account is the authority on its own currency, so a value here
   * removes the question rather than answering it with a guess.
   */
  accountCurrency?: string;
  /** Active playbook — anything it already answers is never asked again. */
  playbook?: Record<string, any> | null;
  /** Industry key, so the questions use this business's nouns. */
  industry?: string | null;
}

export interface CampaignLaunchInput {
  /** What the campaign is optimised for (leads, traffic, sales…). */
  objective?: unknown;
  /** Daily or lifetime budget, in whatever unit the calling tool takes. */
  budget?: unknown;
  /** Every value that could be the creative to run: image URL(s), a hash, a creative id. */
  creativeAssets?: unknown[];
  /** Cities / regions / countries, or a Graph `targeting` object. */
  locations?: unknown;
  /** Lead-form questions, when the campaign is lead-gen. */
  qualifyingQuestions?: unknown;
  /** True for a lead-generation campaign, which needs the form questions. */
  leadGen?: boolean;
  /** When it goes live. Not a blocker: "as soon as it is approved" is a real answer. */
  startDate?: unknown;
  /**
   * Fields that genuinely do not apply to this call — a bare campaign draft has
   * no creative yet, an ad set inherits its campaign's objective and often its
   * budget. Naming them keeps the guard permissive instead of pedantic.
   */
  notRequired?: string[];
}

export interface BulkActionInput {
  /** whatsapp | call | sms | email — used only for the wording of the question. */
  channel?: string;
  /** How many people this would touch, when known. */
  recipients?: number;
  /** Which leads: ids, a filter, or the description the owner would recognise. */
  segment?: unknown;
  /** What the message/call says and why: text, a script, a template name. */
  messageIntent?: unknown;
  /** When it goes out: "now", a time, a schedule. */
  when?: unknown;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

/** A value counts as "known" only when it actually carries information. */
function filled(value: any): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((v) => filled(v));
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  // `false` is an answer ("no price", "not lead-gen"), never a gap.
  if (typeof value === 'boolean') return true;
  return Boolean(value);
}

/** Read `a.b.c` out of the playbook without assuming its shape. */
function readPath(source: any, path: string): any {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc === undefined || acc === null ? acc : acc[key]), source);
}

/** First playbook value at any of these paths — the "already answered" check. */
function fromPlaybook(ctx: PreflightContext, paths: string[]): any {
  const playbook = ctx.playbook;
  if (!playbook) return undefined;
  for (const path of paths) {
    const value = readPath(playbook, path);
    if (filled(value)) return value;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 1. THE RULE, FOR THE SYSTEM PROMPT                                 */
/* ------------------------------------------------------------------ */

/**
 * The pre-flight contract, rendered for one business's vocabulary.
 *
 * Kept as a function rather than a constant because the noun it uses for "what
 * this business sells" must follow `profiles.industry`: an academy sells
 * courses, a consultancy sells services, an untagged tenant gets the neutral
 * word. Nothing here may name a vertical.
 */
export function preflightPromptSection(
  industry?: string | null,
  opts?: { adTools?: boolean },
): string {
  const v = industryVocabulary(industry);

  // The ad-account lookup is named ONLY when the Meta suite is actually loaded for this turn.
  // This section is always on, but `meta_graph_account` is not — naming it unconditionally made
  // the agent promise a check it had no tool for, on every reporting and creative turn.
  // verify:toolset fails on exactly that ("prompt mentions unregistered tools").
  const adAccountStep = opts?.adTools
    ? "Call 'meta_graph_account' FIRST so the account, its real currency and its status are"
    : 'Read the connected ad account first so the account, its real currency and its status are';

  return `PRE-FLIGHT CONTRACT — GATHER THE MISSING INPUTS BEFORE YOU ACT:
A big action started without its inputs produces a half-right job the owner has to correct, which costs
more than one question. So before ANY of the four categories below, run this checklist.

THE CHECKLIST:
1. CHECK — list what this exact action needs, and what you actually know right now.
2. SEPARATE — for each item: (a) the playbook or the catalogue already answers it, (b) the user said it in
   this conversation, or (c) it is genuinely unknown. Only (c) is a question. Reading a tool for (a) is
   free; guessing (c) is not.
3. ASK ONCE — call 'request_user_input' a SINGLE time with 'questions: [{ question, context, options:
   [{ label, description, recommended }] }]', every missing item in that one batch, the answer you would
   pick listed first and marked 'recommended: true'. Four questions at most. Even for one item, use
   'questions' so it renders as one walkthrough.
4. WAIT — then stop. Do not guess a budget, a location, an asset or a segment, and do not perform the
   action while the questions are unanswered. If the owner answers "you decide", decide, state the choice
   in one line, and proceed. If they say skip, proceed with what you have and say what you assumed.
5. NEVER ASK what the playbook ('get_playbook'), the catalogue ('nobogent_inventory_search'), the brand
   ('nobogent_brand_get_profile') or the asset library ('nobogent_assets_list') already answers. Read
   those first. Never ask the same thing twice. Never ask purely to look careful.

THE FOUR CATEGORIES — never start one of these with a required input missing:
A. LAUNCHING, PAUSING OR ADJUSTING AN AD CAMPAIGN.
   Required: the objective (leads, traffic, sales, awareness); the budget AND its currency; the
   locations/audience; which creative or asset it runs; the qualifying questions when it is lead-gen; and
   the start date. ${adAccountStep}
   facts, then ask only what is still unknown. Pausing or moving budget on a live campaign needs the
   campaign and the amount from the owner — never infer either from a previous campaign.
B. PRODUCING MORE THAN A COUPLE OF CREATIVES IN ONE GO (three or more).
   Required: which ${v.productNoun} each creative is for, named as it appears in the catalogue; the offer or price
   to show — or an explicit "no price on this one"; which brand assets to use (logo, colours, real photos); and
   the aspect ratio and channel each one is made for. A single creative does not need this; a batch does.
C. BULK MESSAGING OR CALLING LEADS.
   Required: which segment, and how many people are in it; the message intent — what the message or script
   says and why they are hearing from you; and the timing. This goes through 'request_human_approval' as
   well: the questions come first, the approval comes second.
D. ANYTHING THAT SPENDS CREDITS ABOVE ~200 IN ONE GO.
   Required: what the spend buys, how many of them, and the quality/model tier — enough that the estimate
   you quote is a real estimate and not a guess.

WHEN A TOOL REFUSES FOR THIS REASON it returns 'status: "missing_inputs"' with a 'missingInputs' list.
That is not a failure: ask those questions in one batch, then call the same tool again with the answers.
Doing the free preparation first (the script, the voice choice, the reference, the shortlist of assets) and
then asking is always allowed — this rule is about not STARTING the billable or public step on assumptions.`;
}

/* ------------------------------------------------------------------ */
/* 2. THE STRUCTURAL GUARD — CAMPAIGN LAUNCH                          */
/* ------------------------------------------------------------------ */

/**
 * Everything a campaign launch needs, checked before a single Graph call.
 *
 * Blocking set: objective, budget, audience/locations, creative asset, and the
 * lead-form questions when it is lead-gen. The start date is collected by the
 * prompt but never blocks here — "go live as soon as it is approved" is a real
 * answer, and a timestamp invented by the model is worse than the default.
 *
 * Currency is not a blocking field either: the connected ad account is the
 * authority on its own currency, so the tools resolve it there and echo it back.
 * Asking the owner would breach the "never ask what a tool already answers" rule.
 */
export function checkCampaignLaunch(
  input: CampaignLaunchInput,
  ctx: PreflightContext = {}
): PreflightResult {
  const v = industryVocabulary(ctx.industry);
  const missing: MissingInput[] = [];
  const notRequired = new Set(input.notRequired || []);
  const needs = (field: string) => !notRequired.has(field);
  const budget = filled(input.budget)
    ? input.budget
    : fromPlaybook(ctx, ['ads.daily_budget', 'ads.budget', 'campaign.daily_budget', 'campaign.budget', 'daily_budget', 'budget']);
  // The ad account is the authority on its own currency; when the caller resolved
  // it, the budget question can be asked in the right denomination.
  const currency = String(ctx.accountCurrency || '');

  if (
    needs('objective') &&
    !filled(input.objective) &&
    !fromPlaybook(ctx, ['ads.objective', 'campaign.objective', 'objective'])
  ) {
    missing.push({
      field: 'objective',
      question: 'What should this campaign be optimised for?',
      why: 'The objective fixes the optimisation goal and what counts as a result, and Meta cannot change it after the campaign exists.',
      options: [
        'Leads — enquiries you can call back',
        'Sales — purchases of the offer',
        'Traffic — clicks to the site or landing page',
        'Awareness — reach and impressions',
      ],
    });
  }

  if (needs('budget') && !filled(budget)) {
    missing.push({
      field: 'budget',
      question: `How much should this spend per day, in ${currency || 'the ad account currency'}?`,
      why: 'A budget the agent invented is real money: the ad set starts spending as soon as it is live.',
      options: [
        `Comfortable test budget in ${currency || 'the account currency'}`,
        'Match the last campaign that worked',
        'Give an exact figure',
      ],
    });
  }

  if (
    needs('locations') &&
    !filled(input.locations) &&
    !fromPlaybook(ctx, [
      'ads.locations',
      'ads.target_locations',
      'target_locations',
      'locations',
      'cadence.locations',
      'cadence.target_locations',
      'service_area',
    ])
  ) {
    missing.push({
      field: 'locations',
      question: 'Which cities or areas should this run in?',
      why: 'Targeting a guessed city spends the whole budget on people who cannot buy from the business.',
      options: ['The same area as the current campaigns', 'One city or region I will name', 'The whole country'],
    });
  }

  const creative = (input.creativeAssets || []).some((asset) => filled(asset));
  if (
    needs('creative') &&
    !creative &&
    !fromPlaybook(ctx, ['ads.creative', 'ads.creative_asset', 'creative_asset', 'creative'])
  ) {
    missing.push({
      field: 'creative',
      question: `Which ${v.productNoun} and which creative should the ad show — an asset already in the library, or one you want made first?`,
      why: 'The ad needs a real, approved asset. Generating a new one costs credits, and an ad the owner does not recognise is an ad they will pause.',
      options: [
        'Use an asset already in the library',
        'Make a new one first, then launch',
        'Use the best performer from the last campaign',
      ],
    });
  }

  const leadGen = input.leadGen !== false;
  if (
    needs('qualifying_questions') &&
    leadGen &&
    !filled(input.qualifyingQuestions) &&
    !fromPlaybook(ctx, [
      'ads.qualifying_questions',
      'lead_form.questions',
      'qualifying_questions',
      'call_script.questions',
    ])
  ) {
    missing.push({
      field: 'qualifying_questions',
      question: 'What should the lead form ask, beyond name and phone?',
      why: 'The answers are what the follow-up call is built on; a form with no qualifying question produces leads nobody can rank or route.',
      options: [
        'Budget / what they can spend',
        'Timeline / when they need it',
        `Which ${v.productNoun} they want`,
        'Keep it minimal — name and phone only',
      ],
    });
  }

  return { ok: missing.length === 0, missingInputs: missing };
}

/* ------------------------------------------------------------------ */
/* 3. THE STRUCTURAL GUARD — BULK MESSAGING / CALLING                 */
/* ------------------------------------------------------------------ */

/**
 * Everything a bulk send needs before it touches more than one person.
 *
 * Blocking set: the segment and its size, the message intent, and the timing.
 * "Send now" is a valid timing and must be stated explicitly, because a bulk
 * send that leaves on an assumption is unrecoverable.
 */
export function checkBulkAction(input: BulkActionInput, ctx: PreflightContext = {}): PreflightResult {
  const missing: MissingInput[] = [];
  const channel = String(input.channel || '').toLowerCase();
  const reached = channel === 'call' ? 'called' : channel === 'whatsapp' ? 'messaged' : 'contacted';

  const hasSegment = filled(input.segment) || (typeof input.recipients === 'number' && input.recipients > 0);
  if (!hasSegment) {
    missing.push({
      field: 'segment',
      question: 'Which leads should this go to, and roughly how many are there?',
      why: 'The segment is the whole risk in a bulk action: the wrong filter reaches people who never asked to hear from the business.',
      options: ['New leads from the last 30 days', 'Hot / positive leads only', 'One named list or segment', 'Everyone not yet contacted'],
    });
  }

  if (
    !filled(input.messageIntent) &&
    !fromPlaybook(ctx, ['ads.message_intent', 'call_script.script', 'call_script.pitch', 'whatsapp_replies.template', 'whatsapp_replies.intro'])
  ) {
    missing.push({
      field: 'message_intent',
      question: `What should the message say, and why are they hearing from you now?`,
      why: 'The intent decides the script, the template and the reply handling; without it the send is a generic blast nobody answers.',
      options: ['A specific offer I will describe', 'A follow-up on an enquiry they made', 'An announcement or reminder', 'Use the script already in the playbook'],
    });
  }

  if (!filled(input.when) && !fromPlaybook(ctx, ['ads.send_time', 'cadence.broadcast_time', 'cadence.send_time'])) {
    missing.push({
      field: 'timing',
      question: `When should this go out — now, or at a specific time?`,
      why: `A bulk ${reached} cannot be recalled, and the hour decides whether it is a helpful message or an interruption.`,
      options: ['Now', 'A specific date and time I will give', 'Tomorrow morning', 'Spread over the next few days'],
    });
  }

  return { ok: missing.length === 0, missingInputs: missing };
}

/* ------------------------------------------------------------------ */
/* 4. THE REFUSAL PAYLOAD                                             */
/* ------------------------------------------------------------------ */

/**
 * What a guarded tool returns instead of acting.
 *
 * It carries the questions already shaped for `request_user_input`, so the model
 * does not have to re-derive them: copy `suggestedQuestions` into the tool call,
 * which is the difference between a refusal the owner benefits from and one they
 * never see.
 */
export function missingInputsPayload(toolName: string, action: string, missing: MissingInput[]) {
  return {
    success: false as const,
    status: 'missing_inputs' as const,
    tool: toolName,
    action,
    /** Nothing was created, sent, or spent. */
    executed: false as const,
    missingInputs: missing,
    /** Flattened, for a quick read. */
    missingFields: missing.map((m) => m.field),
    askWith: 'request_user_input',
    suggestedQuestions: missing.map((m) => ({
      question: m.question,
      context: m.why,
      options: (m.options || []).map((label, index) => ({ label, recommended: index === 0 })),
    })),
    next:
      `Nothing was launched or sent. Call 'request_user_input' ONCE with ` +
      `questions: ${JSON.stringify(
        missing.map((m) => ({
          question: m.question,
          context: m.why,
          options: (m.options || []).map((label, index) => ({ label, recommended: index === 0 })),
        }))
      )} — wait for the answers, then call '${toolName}' again with them filled in.`,
    rule:
      'Do not guess any of these, do not launch a partial version to "fix it later", and do not ask a question a tool can answer.',
  };
}

/** Convenience for tools: check, and either an undefined (proceed) or a refusal body. */
export function preflightOrRefuse(
  toolName: string,
  action: string,
  result: PreflightResult
): ReturnType<typeof missingInputsPayload> | undefined {
  if (result.ok) return undefined;
  return missingInputsPayload(toolName, action, result.missingInputs);
}

/* ------------------------------------------------------------------ */
/* 5. FOR THE TOOLS — one call, permissive when the playbook answers  */
/* ------------------------------------------------------------------ */

/**
 * Read the active playbook for the permissive half of a guard.
 *
 * Best-effort on purpose: a failed read leaves the guard STRICT (it may ask a
 * question the playbook could have answered) but never lets it proceed on a
 * gap. Strict-and-annoying is recoverable; permissive-and-wrong is not.
 */
export async function loadPlaybookForPreflight(
  supabase: any,
  userId: string
): Promise<Record<string, any> | null> {
  try {
    const { getActivePlaybook } = await import('@/lib/automation/ceo');
    const playbook = await getActivePlaybook(supabase, userId);
    return (playbook as Record<string, any>) || null;
  } catch {
    return null;
  }
}

interface GuardArgs {
  /** The tool name the model called, echoed back so the retry is obvious. */
  tool: string;
  /** One clause describing the action, e.g. "launch a lead-generation campaign". */
  action: string;
  supabase: any;
  userId: string;
  ctx?: PreflightContext;
}

/**
 * Campaign-launch guard for a tool.
 *
 * Two passes: the direct check, then — only if it failed — the same check with
 * the playbook loaded, so nothing the playbook already says is asked again.
 * Returns undefined when the call may proceed, or the refusal body to return.
 */
export async function campaignLaunchRefusal(
  input: CampaignLaunchInput,
  args: GuardArgs
): Promise<ReturnType<typeof missingInputsPayload> | undefined> {
  const direct = checkCampaignLaunch(input, args.ctx || {});
  if (direct.ok) return undefined;

  const playbook = args.ctx?.playbook ?? (await loadPlaybookForPreflight(args.supabase, args.userId));
  const permissive = checkCampaignLaunch(input, { ...(args.ctx || {}), playbook });
  if (permissive.ok) return undefined;

  return missingInputsPayload(args.tool, args.action, permissive.missingInputs);
}

/** Bulk messaging / calling guard for a tool. Same two-pass shape. */
export async function bulkActionRefusal(
  input: BulkActionInput,
  args: GuardArgs
): Promise<ReturnType<typeof missingInputsPayload> | undefined> {
  const direct = checkBulkAction(input, args.ctx || {});
  if (direct.ok) return undefined;

  const playbook = args.ctx?.playbook ?? (await loadPlaybookForPreflight(args.supabase, args.userId));
  const permissive = checkBulkAction(input, { ...(args.ctx || {}), playbook });
  if (permissive.ok) return undefined;

  return missingInputsPayload(args.tool, args.action, permissive.missingInputs);
}

