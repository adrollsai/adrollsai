/**
 * The daily brief, composed from the playbook instead of from code.
 *
 * WHAT CHANGED AND WHY
 * The crons used to BE the pipeline: `auto-generate` decided who ran, when, and
 * which property; `auto-generate-video` hardcoded the model, the 2x15s chunking,
 * the stitching and the TTS. That expresses one opinion about how to market a
 * business, and it is the wrong opinion for a film academy or an immigration
 * consultancy.
 *
 * So the day is now described to the agent rather than executed for it. This
 * module turns
 *
 *   playbook (positioning, industry, daily_routine, recipes)
 * + the routine row (cadence, approval policy, spend ceiling, channels)
 * + today's context (date, credits, pending approvals, festivals)
 *
 * into a brief that says what the day needs and which tools to compose it with.
 * The recipes are FIRST-DRAFT GUIDANCE, not the implementation: they say what a
 * good artefact looks like and — critically — what "still acceptable" looks like
 * when the ideal is not achievable, because an agent composing from scratch has
 * far more failure modes than a fixed pipeline.
 *
 * Pure on purpose: no database, no network, no clock. The brief is the most
 * behaviour-shaping string in the system, so it has to be testable.
 */
import type { Playbook } from './ceo';
import { industryVocabulary } from './industry';
import { resolveRecipes, type RecipeSet } from './recipes';
import { adCopyRulesForPrompt } from '../ads/creative-specs';
import { learningsBriefLines, type CreativeLearnings } from '../ads/creative-learning';
import { observanceBriefLines, upcomingObservances } from './observance-calendar';
import { directiveBriefLines, mergeDirectives } from './creative-directives';

export interface RoutineBriefRoutine {
  name?: string;
  intent: string;
  cadence: string;
  approval_policy: string;
  /** 0 / null means no ceiling (uncapped by design). */
  daily_credit_cap: number | string | null;
  channels: string[];
  timezone: string;
}

export interface RoutineBriefInput {
  businessName?: string | null;
  industry?: string | null;
  playbook?: Partial<Playbook> | null;
  routine: RoutineBriefRoutine;
  /** Today, in the tenant's timezone, as YYYY-MM-DD. */
  todaysDate: string;
  /**
   * The instant the brief is composed. Defaults to the real clock, which is what the cron and the
   * manual trigger both want; injectable so the observance window can be tested against a fixed date.
   */
  now?: Date;
  /** Raw wallet balance, for the agent's own planning. */
  creditsLeft?: number | null;
  /** Balance minus open holds: what today is actually allowed to commit. */
  availableCredits?: number | null;
  pendingApprovals?: number;
  festivals?: string[];
  recentOutputs?: string[];
  lastWeekNotes?: string | null;
  /**
   * What the account's ads have actually done, from `optimize_meta_campaign`.
   *
   * Optional because composing a brief must never depend on Meta being reachable: when it is absent the
   * brief still tells the agent to go and look, and says nothing false about performance. When it is
   * present, the day's creative starts from what worked instead of from a blank page.
   */
  /**
   * What the ads did, in money, whether or not any creative recorded an argument.
   *
   * `creativeLearnings` speaks per argument and stays silent until a launch has recorded which one it
   * made. That silence was being rendered as "not read yet" even when Meta HAD been read and the money
   * was known — a dry run on a real account said "not read yet" while holding "₹434 spent, 19 enquiries,
   * ₹23 each". Throwing away a real measurement is worse than having none, so the account total arrives
   * separately and the per-argument detail is layered on top when it exists.
   */
  adPerformance?: {
    measured: boolean;
    currency?: string;
    spendPaise: number;
    results: number;
    costPerResultPaise: number | null;
    previousCostPerResultPaise?: number | null;
    /** Launches that carried no record of which argument they made. */
    unattributedLaunches?: number;
  } | null;
  creativeLearnings?: CreativeLearnings | null;
}

const MAX_LIST = 6;

/**
 * How far ahead observance days are surfaced in the brief.
 *
 * 14 days, so the day after tomorrow and the day after that are both visible: long enough to plan a
 * shoot, short enough that a creative is not made three weeks before the day it belongs to.
 */
const OBSERVANCE_WINDOW_DAYS = 14;

function listBlock(title: string, items: unknown, limit = MAX_LIST): string[] {
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  const clean = arr
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, limit);
  if (clean.length === 0) return [];
  return [`  ${title}:`, ...clean.map((v) => `    - ${v}`)];
}

/**
 * Render the playbook's `daily_routine` as readable slots.
 *
 * The stored shape is free-form by design — the CEO writes it in plain language —
 * so anything that is not a simple scalar/array is rendered as JSON rather than
 * silently dropped. A schedule the agent cannot read is worse than no schedule.
 */
export function renderDailyRoutine(dailyRoutine?: Record<string, unknown> | null): string[] {
  if (!dailyRoutine || typeof dailyRoutine !== 'object') return [];
  const keyOrder = ['summary', 'timezone', 'slots', 'morning', 'afternoon', 'evening', 'always', 'channels', 'skip_when'];
  const keys = Object.keys(dailyRoutine);
  const ordered = [
    ...keyOrder.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !keyOrder.includes(k)),
  ];

  const lines: string[] = [];
  for (const key of ordered) {
    const value = (dailyRoutine as any)[key];
    if (value === null || value === undefined || value === '') continue;
    const label = key.replace(/_/g, ' ');

    if (Array.isArray(value)) {
      const items = value
        .map((v) => (typeof v === 'string' ? v : typeof v === 'object' ? describeSlot(v) : String(v)))
        .filter(Boolean);
      if (items.length) {
        lines.push(`- ${label}:`);
        for (const item of items) lines.push(`  Â· ${item}`);
      }
      continue;
    }

    if (typeof value === 'object') {
      lines.push(`- ${label}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null || v === undefined || v === '') continue;
        lines.push(`  Â· ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
      }
      continue;
    }

    lines.push(`- ${label}: ${String(value)}`);
  }
  return lines;
}

/** One routine slot: `{ when: 'morning', do: '...', channel: 'whatsapp' }`. */
function describeSlot(slot: any): string {
  if (!slot || typeof slot !== 'object') return String(slot ?? '');
  const when = slot.when || slot.at || slot.time || '';
  const what = slot.do || slot.action || slot.task || slot.summary || '';
  const channel = slot.channel || slot.channels || '';
  const bits = [when && String(when), what && String(what), channel && `on ${Array.isArray(channel) ? channel.join('/') : channel}`]
    .filter(Boolean);
  return bits.length ? bits.join(' — ') : JSON.stringify(slot).slice(0, 200);
}

/** Human-readable recipe guidance, including its degraded path. */
export function renderRecipe(name: 'creative' | 'video' | 'copy', recipe: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const goal = recipe.goal ? String(recipe.goal) : '';
  lines.push(`### ${name.toUpperCase()}${goal ? ` — aim: ${goal}` : ''}`);

  lines.push(...listBlock('must include', recipe.must_include));
  lines.push(...listBlock('structure', recipe.structure));
  lines.push(...listBlock('layout', recipe.layout));
  lines.push(...listBlock('avoid', recipe.avoid));

  if (recipe.format && typeof recipe.format === 'object') {
    const f = recipe.format as Record<string, unknown>;
    const bits = Object.entries(f)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${Array.isArray(v) ? v.join('“') : v}`);
    if (bits.length) lines.push(`  format: ${bits.join(', ')}`);
  }

  if (recipe.audio && typeof recipe.audio === 'object') {
    const a = recipe.audio as Record<string, unknown>;
    for (const [k, v] of Object.entries(a)) {
      if (v === null || v === undefined || v === '') continue;
      lines.push(`  audio/${k.replace(/_/g, ' ')}: ${String(v)}`);
    }
  }

  if (recipe.language) lines.push(`  language: ${String(recipe.language)}`);
  if (recipe.channel_rules && typeof recipe.channel_rules === 'object') {
    for (const [k, v] of Object.entries(recipe.channel_rules as Record<string, unknown>)) {
      lines.push(`  ${k} rule: ${String(v)}`);
    }
  }

  const degraded = recipe.degraded_path ? String(recipe.degraded_path) : '';
  lines.push(
    degraded
      ? `  IF THE IDEAL IS NOT ACHIEVABLE: ${degraded}`
      : '  IF THE IDEAL IS NOT ACHIEVABLE: produce the simplest honest version and say what you dropped.'
  );
  return lines;
}

/**
 * The audio rule, stated once, outside the recipe text.
 *
 * It is the owner's own note and it is easy to get wrong twice: a presenter that
 * is already speaking plus a voiceover reads as a broken video, not a dubbed one.
 */
export const AUDIO_RULE =
  'If an avatar or presenter is speaking in the clip, do NOT add a separate voiceover. Add TTS only when the visuals are silent.';

export interface CompiledBrief {
  text: string;
  /** Which recipe sections were included, for debugging and the verify suite. */
  recipeSections: string[];
  /** True when the brief carried an authored playbook routine rather than intent. */
  usedPlaybookRoutine: boolean;
}

/** Compile the brief. `text` is what the agent receives as its goal. */
export function composeRoutineBrief(input: RoutineBriefInput): CompiledBrief {
  const vocab = industryVocabulary(input.industry);
  const recipes: RecipeSet = resolveRecipes((input.playbook as any)?.recipes);
  const routine = input.routine;

  const lines: string[] = [];
  const business = input.businessName || 'this business';
  const positioning = input.playbook?.positioning ? ` ${String(input.playbook.positioning).trim()}` : '';

  lines.push(`You are running marketing for ${business} today (${input.todaysDate}, ${routine.timezone}).${positioning}`);

  const industryKey = (input.playbook?.industry || input.industry || 'neutral') as string;
  lines.push(
    `Industry: ${industryKey}. Talk about "${vocab.productNounPlural}" (a ${vocab.productNoun} is one item), ` +
      `and use "${vocab.enquiryCta}" language. Never borrow vocabulary from another industry.`
  );

  // ---- the schedule ----
  const routineLines = renderDailyRoutine((input.playbook as any)?.daily_routine);
  const usedPlaybookRoutine = routineLines.length > 0;

  lines.push('');
  lines.push('THE DAY, AS THE OWNER AND YOU HAVE AGREED IT:');
  if (usedPlaybookRoutine) {
    lines.push(...routineLines);
    if (routine.intent?.trim()) lines.push(`- standing intent: ${routine.intent.trim()}`);
  } else {
    lines.push(`- ${routine.intent.trim()}`);
  }

  // ---- today's context ----
  lines.push('');
  lines.push('TODAY, BEFORE YOU PLAN — look with tools, not memory:');
  lines.push(`- new and open leads, what stage they are in, and anything waiting on a reply`);
  lines.push(`- the catalogue: what ${vocab.productNounPlural} are actually available right now`);
  lines.push(`- what went out in the last 7 days and what happened to it`);
  lines.push(`- the calendar: any festival, holiday or event today or tomorrow`);
  if (input.festivals?.length) lines.push(`- known for today: ${input.festivals.slice(0, MAX_LIST).join(', ')}`);
  // OBSERVANCE DAYS (Women's Day, Earth Day, Environment Day, Yoga Day, Mother's/Father's Day, ...)
  // were nobody's job: they are not festivals, so the festival calendar never carried them, and the
  // routine was told only to "check the calendar" — which it had no way to do. They arrive here with
  // the date, the commercial angle and the lead time, so the creative exists BEFORE the day.
  const observances = upcomingObservances(input.now ?? new Date(), {
    withinDays: OBSERVANCE_WINDOW_DAYS,
    timezone: routine.timezone,
  });
  if (observances.length) {
    lines.push('');
    lines.push('OBSERVANCE DAYS — in the window right now (not festivals; fixed national/international days):');
    lines.push(...observanceBriefLines(observances));
    lines.push(
      '- An observance creative is a real piece of work, not a greeting card: use the angle given, and tie it to what this business actually sells. If the honest angle does not exist, skip that day and say why.'
    );
  }
  // CREATIVE DIRECTIVES — the owner's standing rules for what a creative may contain.
  //
  // This is the half that makes "no phone number in any daily creative" a rule rather than a hope: the
  // same directives are enforced on the compiled spec by build_ad_creative_prompt, and stating them in
  // the brief means the agent plans around them instead of discovering them at the check.
  const directiveSet = (input.playbook as any)?.creative_directives ?? null;
  const globalDirectives = mergeDirectives(directiveSet, {});
  if (globalDirectives.instructions.length || globalDirectives.bans.length) {
    lines.push('');
    lines.push(...directiveBriefLines(globalDirectives));
  }
  const itemDirectiveMap = ((directiveSet?.items ?? directiveSet?.properties) ?? {}) as Record<string, unknown>
  const propertyDirectives = Object.entries(itemDirectiveMap)
    .map(([propertyId, list]) => {
      const merged = mergeDirectives({ items: { [propertyId]: list as any } }, { propertyId });
      if (!merged.instructions.length && !merged.bans.length) return null;
      return { propertyId, instructions: merged.instructions, bans: merged.bans };
    })
    .filter(Boolean) as Array<{ propertyId: string; instructions: string[]; bans: string[] }>;

  if (propertyDirectives.length) {
    lines.push('');
    lines.push(
    'PER-ITEM CREATIVE RULES (apply when that catalogue item is the subject - pass its id as itemId to build_ad_creative_prompt):'
    );
    for (const entry of propertyDirectives.slice(0, MAX_LIST)) {
      const bits = [...entry.instructions];
      if (entry.bans.length) bits.push(`never include: ${entry.bans.join(', ')}`);
      lines.push(`- item ${entry.propertyId}: ${bits.join('; ')}`);
    }
  }

  if (input.recentOutputs?.length) {
    lines.push(`- already published recently: ${input.recentOutputs.slice(0, MAX_LIST).join('; ')}`);
  }

  // ── LAST WEEK, MEASURED ──────────────────────────────────────────────────────────────────────
  //
  // This is the memory the daily loop did not have. `lastWeekNotes` existed in this signature from
  // the start and no caller ever passed it, so the day always began at zero — which is why the
  // engine could produce work every morning and never visibly get better at it. It is now computed
  // from the numbers (see lib/agent/weekly-recap.ts) and stated as fact before the plan is written.
  //
  // It goes ABOVE the ads block on purpose: what actually happened last week outranks what the ad
  // account says about angles, and reading it first shapes what the agent goes looking for.
  if (input.lastWeekNotes) {
    lines.push('');
    lines.push('LAST WEEK, MEASURED — what actually happened, before you decide what today needs:');
    lines.push(`- ${String(input.lastWeekNotes).trim()}`);
    lines.push(
      '- If a number moved the wrong way, today\'s plan has to answer it by name: say what you are changing and',
    );
    lines.push(
      '  what you expect it to do. If nothing moved, say that too and change one thing deliberately rather than',
    );
    lines.push('  repeating the week that produced it.');
  }

  // ── WHAT ALREADY RAN, AND WHAT IT TAUGHT US ─────────────────────────────────────────────────────
  //
  // The loop closes here for the daily flow. Two states, both honest:
  //   WITH data   the measured verdicts go into the brief, so today's creative argues what won.
  //   WITHOUT     the brief says to go and read the numbers first, and says nothing false.
  // A brief that quietly implies it knows performance when it does not is worse than one that asks.
  const learned = learningsBriefLines(input.creativeLearnings);
  const ads = input.adPerformance;
  const rupee = (paise: number | null | undefined) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
  const hasAccountTotals = Boolean(ads?.measured && ads.spendPaise > 0);
  lines.push('');
  if (learned.length) {
    lines.push('WHAT THE ADS HAVE ACTUALLY DONE (measured, not guessed — build on this):');
    lines.push(...learned);
    lines.push(
      '- Before you design today\'s creative, call optimize_meta_campaign for the current numbers and pass its',
    );
    lines.push(
      '  guidance.avoid into build_ad_creative_prompt as avoidAngles, and prefer its winners. Do not re-propose an',
    );
    lines.push('  angle that already lost on this account unless the owner asks for it by name.');
  } else if (hasAccountTotals) {
    // Measured, but not fine enough to compare arguments yet. Say both halves.
    lines.push('WHAT THE ADS HAVE ACTUALLY DONE (last 7 days, measured):');
    lines.push(
      `- ${rupee(ads!.spendPaise)} spent, ${ads!.results} enquir${ads!.results === 1 ? 'y' : 'ies'} from ads` +
        (ads!.costPerResultPaise !== null
          ? ` — ${rupee(ads!.costPerResultPaise)} each` +
            (ads!.previousCostPerResultPaise
              ? `, against ${rupee(ads!.previousCostPerResultPaise)} each the week before.`
              : '.')
          : ' — no enquiries, so there is no price per enquiry to compare.'),
    );
    lines.push(
      '- No launch recorded WHICH ARGUMENT its creative made, so nothing finer can be compared yet. Record it:',
    );
    lines.push(
      '  pass creativePlan.angleId (the id build_ad_creative_prompt returned) on every launch from today. That is',
    );
    lines.push('  the one field that turns next week\'s report from a total into a lesson.');
    lines.push(
      '- Today, choose the argument from what the numbers say about the offer and the audience, call',
    );
    lines.push('  optimize_meta_campaign to see whether any argument is judgeable, and state your reasoning in one line.');
  } else {
    lines.push('WHAT THE ADS HAVE ACTUALLY DONE: not read yet.');
    lines.push(
      '- Call optimize_meta_campaign BEFORE designing anything. If campaigns are running, its learnings decide which',
    );
    lines.push(
      '  angle today\'s creative argues; if the account is too new to judge, it will say so and you should vary the',
    );
    lines.push('  angle rather than repeat the last one. Either way, say which it was.');
  }
  if (input.creditsLeft !== null && input.creditsLeft !== undefined) {
    lines.push(`- wallet: ${input.creditsLeft} credits`);
  }
  if (input.availableCredits !== null && input.availableCredits !== undefined) {
    lines.push(`- available to commit today (unreserved): ${input.availableCredits} credits`);
  }

  // ---- first-draft guidance ----
  lines.push('');
  lines.push('HOW A GOOD FIRST DRAFT LOOKS (guidance, not a script — adapt it to this business):');
  lines.push(...renderRecipe('creative', recipes.creative));
  lines.push(...renderRecipe('video', recipes.video));
  lines.push(...renderRecipe('copy', recipes.copy));

  // THE COPY RULE THAT IS ACTUALLY CHECKED.
  //
  // The recipes above are guidance a business can edit. This block is not: it is the same limits table
  // that lib/ads/creative-specs.ts enforces and that a Meta launch is refused against, printed here so
  // the first draft is written inside the budget instead of being rejected after it. One source of
  // truth — the numbers come from the code, never retyped into prose.
  lines.push('');
  lines.push('AD COPY — THE RULE THAT GETS CHECKED (not guidance; a launch that breaks it is refused):');
  lines.push(
    ...adCopyRulesForPrompt()
      .split('\n')
      .slice(1) // drop the heading, which is already stated above
      .map((line) => (line.startsWith('-') || line.startsWith('  ') ? `  ${line}` : line)),
  );
  lines.push(
    '  Say which angle each creative uses and why, and state a hypothesis a result could disprove —',
  );
  lines.push(
    '  the metric, what it is measured against, and the direction. Full method: load the skill',
  );
  lines.push(
    '  "nobogent-ad-copy" for the rule, or "ad-creative" for the whole playbook plus its reference documents.',
  );

  lines.push('');
  lines.push(`AUDIO RULE (does not bend): ${AUDIO_RULE}`);

  // ---- the tools ----
  lines.push('');
  lines.push('HOW TO MAKE IT — compose with your own tools, in this order:');
  lines.push('- composeCreative: one poster/creative. It applies the creative recipe and takes the degraded');
  lines.push('  path by itself when there is no usable photo. Pass the facts you verified, never guesses.');
  lines.push('- composeVideo: one short vertical clip. It applies the video recipe, decides the audio mode,');
  lines.push('  and returns a task id — poll it with check_media_task before you call it delivered.');
  lines.push('- deliverArtefact: sends a finished artefact to the owner (or publishes it) on the channel you');
  lines.push('  choose. Never deliver something whose task is still running.');
  lines.push('- If a composition fails, re-read its degraded path and make the simpler thing. Producing');
  lines.push('  nothing is the worst outcome; producing something honest and small is a good day.');

  // ---- the approval gate ----
  // Do the cheap preparation first (copy, voice, reference, plan), then stop ONCE
  // before the first billable generation. Without this the run spends credits
  // unattended, which is the one thing the owner has consistently asked not to happen.
  lines.push('');
  lines.push('THE APPROVAL GATE:');
  lines.push('- do the cheap preparation first: the plan, the copy, the facts you verified, any voice or');
  lines.push('  reference you need. None of that costs credits.');
  const policy = String(routine.approval_policy || 'always');
  if (policy === 'never') {
    lines.push('- approval policy is "never": you may generate without asking. Still stop before ad spend');
    lines.push('  and before any broadcast.');
  } else if (policy === 'auto_images') {
    lines.push('- approval policy is "auto_images": images may be generated without asking; stop at');
    lines.push('  request_human_approval before the first video or any other billable step above the ceiling.');
  } else {
    lines.push('- approval policy is "always": stop ONCE at request_human_approval immediately before the');
    lines.push('  first billable generation, with the quote and what it produces. Do not ask twice.');
  }

  // ---- money ----
  lines.push('');
  lines.push('MONEY RULES:');
  const cap = Number(routine.daily_credit_cap || 0);
  lines.push(
    cap > 0
      ? `- spend ceiling for today: ${cap} credits. If the day would cost more, do the cheaper version and say what you skipped.`
      : '- there is no daily ceiling, but the wallet is finite: never spend what the balance cannot cover.'
  );
  lines.push('- always quote before executing anything above ~200 credits; below that, just do it.');
  lines.push('- if the real cost would exceed what you told the owner, STOP and ask. A silently overdrawn');
  lines.push('  balance is unrecoverable trust.');
  lines.push('- NEVER spend ad budget. Credits are not ad spend; ad spend is on the business\'s own');
  lines.push('  Meta/Google card. Stop at "campaign ready — launch with Rs X/day?" and wait.');
  lines.push(`- approval policy for today: ${routine.approval_policy}`);
  lines.push(`- channels available: ${(routine.channels || []).join(', ') || 'none configured'}`);
  if (input.pendingApprovals) {
    lines.push(`- there are already ${input.pendingApprovals} approval(s) waiting — do not duplicate them`);
  }

  // ---- invariants ----
  lines.push('');
  lines.push('RULES THAT DO NOT BEND:');
  lines.push(`- never invent a price, a registration number, an availability, an approval or a performance figure`);
  lines.push(`- if you do not have a fact, say what you need — do not fill the gap with something plausible`);
  lines.push('- a reference creative is a style guide, never this business\'s own product');
  lines.push('- nothing goes to a paid channel or a broadcast without approval');
  lines.push(
    '- every message to a lead carries exactly three reply buttons with these ids: view_properties,' +
      ' talk_expert, book_appointment. Labels can be contextual ("' +
      vocab.productNounPlural +
      '"); ids never change.'
  );
  lines.push('- if nothing needs doing today, say so plainly and stop; a quiet day is a valid outcome');

  // ---- the digest ----
  //
  // This block becomes the email and the push the owner reads. The person reading it owns a
  // business, not a marketing department: they know what an enquiry is and what it costs, and
  // they do not know what CPL, CTR, impressions or "angles" mean. So the shape is fixed (so the
  // report can be parsed and so two days are comparable) AND the language is pinned to plain
  // words with a reason attached to every number.
  lines.push('');
  lines.push('FINISH WITH A DIGEST in exactly this shape, because it becomes the email and the push:');
  lines.push('  DONE: what you made, with links');
  lines.push('  SPENT: credits used today');
  lines.push('  NUMBERS: the two or three figures that moved, in plain words, each with what it means');
  lines.push('  NEEDS YOU: approvals pending, missing inputs, decisions (or "nothing")');
  lines.push('  NOT DONE: what you skipped and why (or "nothing")');
  lines.push('  TOMORROW: one line on what is next, and the number it is meant to move');
  lines.push('');
  lines.push('HOW TO WRITE THOSE LINES — the reader is a business owner, not a marketer:');
  lines.push('- Never use an acronym or a term of art. Not CPL, CPA, CTR, CTR%, ROAS, CPM, impressions,');
  lines.push('  frequency, reach, attribution, funnel, ad set, adset, angle, cadence, cohort, creative plan,');
  lines.push('  or "engagement". If a number needs a term to explain it, the term is wrong.');
  lines.push('- Say money in rupees, enquiries as "enquiries", and people who saw an ad as "people who saw it".');
  lines.push('- Every number gets a comparison or a consequence in the same sentence: not "12 enquiries" but');
  lines.push('  "12 enquiries, 4 more than the week before". A number with nothing to compare it to is trivia.');
  lines.push('- Say what you did about it. "Enquiries cost ₹803 each, up from ₹310, so today I am changing the');
  lines.push('  opening line to the offer instead of the claim" — that is the whole job in one sentence.');
  lines.push('- No adjectives about yourself. No "great", no "successfully", no "excited". What happened, then');
  lines.push('  what it means, then what is next.');

  return {
    text: lines.join('\n'),
    recipeSections: ['creative', 'video', 'copy'],
    usedPlaybookRoutine,
  };
}

/** Stable idempotency key for one routine's one period. */
export function routineRunKey(routineId: string, periodKey: string): string {
  return `${routineId}:${periodKey}`;
}
