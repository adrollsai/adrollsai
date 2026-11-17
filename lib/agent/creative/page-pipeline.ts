/**
 * The page pipeline: plan → author → render → critique → revise → publish.
 *
 * WHAT WAS MISSING
 * Every generic page we produced came from jumping straight from a request to HTML. A template cannot respond to a
 * brief, and an unplanned one-shot generation cannot be better than average. There was no plan, and nothing ever
 * LOOKED at the result and asked for it to be better.
 *
 * So this is the loop a designer actually runs:
 *   1. PLAN      a positioning memo (audience, the one promise, offer architecture, objections + answers, proof) and a
 *                section plan with a stated purpose per section and the single peak of the page;
 *   2. AUTHOR    the model writes the whole document with the two design skills in its prompt;
 *   3. RENDER    headless Chrome screenshots it, desktop and mobile;
 *   4. CRITIQUE  vision scores the screenshot against a rubric and names specific fixes;
 *   5. REVISE    the model rewrites with the critique, up to a small number of rounds;
 *   6. PUBLISH   artefact QA decides whether it may go live at all.
 *
 * NO OUTPUT CAPS. The model emits ~10k tokens happily; a 2,500-token budget was silently truncating (and sometimes
 * emptying) whole responses. Every call here is given room and the responses are measured.
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { vendoredSkill } from '@/lib/agent/skills-vendor';
import { gradePageHtml, type QaResult } from '@/lib/automation/artefact-qa';

/** Generous by design: the model's own limit is far above this, and truncation is the failure mode we are avoiding. */
const BUDGET = { plan: 9000, author: 32000, revise: 32000 } as const;

export interface PageBrief {
  businessName: string;
  productName: string;
  audience?: string;
  offer?: string;
  highlights?: string[];
  proofPoints?: string[];
  faqs?: { question: string; answer: string }[];
  /** Supplied imagery. Never inferred from a shared library: an unrelated photo is worse than none. */
  heroImage?: string;
  galleryImages?: string[];
  phone: string;
  industry?: string | null;
  brandColor?: string;
}

export interface PagePlan {
  positioning: {
    audience: string;
    promise: string;
    whyNow: string;
    objections: Array<{ objection: string; answer: string }>;
    proof: string[];
  };
  /** One line per section: what it is FOR, so the copy can be judged against a purpose. */
  sections: Array<{ kind: string; purpose: string }>;
  /** The single moment the page is built around. */
  peak: string;
  ctaPath: string;
  raw: string;
}

export interface Critique {
  ok: boolean;
  scores: Record<string, number>;
  fixes: string[];
  raw: string;
}

export interface PipelineResult {
  html: string;
  plan: PagePlan;
  qa: QaResult;
  critiques: Critique[];
  iterations: number;
  screenshots: string[];
  /** Brief tokens the page failed to mention. Non-empty means it is the wrong page. */
  fidelity?: string[];
}


/** The non-negotiables, restated on every call: the model invented a different product when these were absent. */
function factsBlock(brief: PageBrief): string {
  return [
    'THE BUSINESS AND THE OFFER, which must appear on the page exactly as written here:',
    `Business name: ${brief.businessName}`,
    `Product: ${brief.productName}`,
    brief.audience ? `Audience: ${brief.audience}` : '',
    brief.offer ? `Offer: ${brief.offer}` : '',
    brief.highlights?.length ? `Selling points: ${brief.highlights.join('; ')}` : '',
    brief.proofPoints?.length ? `Proof: ${brief.proofPoints.join('; ')}` : '',
    `Phone for every call to action: ${brief.phone}`,
    brief.heroImage ? `Hero image: ${brief.heroImage}` : '',
    brief.galleryImages?.length ? `Other images: ${brief.galleryImages.join(' , ')}` : '',
    'Do NOT invent a different product, a different company or a different industry.',
  ]
    .filter(Boolean)
    .join('\n');
}

const noDash = (html: string) => html.replace(/ — /g, ', ').replace(/—/g, '-');

const strip = (text: string) =>
  String(text ?? '')
    .replace(/```(?:html|css)?/gi, '')
    .replace(/```/g, '')
    .trim();

/** The house rubric. Written once, used by both the author and the critic so they cannot disagree about what good is. */
export const RUBRIC = [
  'hierarchy: one dominant element per screen; the eye knows where to go first',
  'one message: a single promise a stranger could repeat back',
  'one call to action, repeated, unmistakably a button',
  'contrast: text on background at least 4.5:1 everywhere',
  'imagery: every photograph relevant to the offer, filling its frame, no baked-in poster text as a hero',
  'no dead space: no empty band taller than a line of text that carries nothing',
  'section rhythm: sections differ in shape, weight and anchor instead of repeating one card grid',
  'proof: something a sceptic can check (a number, a name, a policy)',
  'mobile: legible at 390px wide, nothing clipped, buttons reachable',
  'craft: no em dashes, no lorem, no invented prices or statistics',
];

export async function planPage(brief: PageBrief, model: any): Promise<PagePlan> {
  const structure = (vendoredSkill('landing-structure')?.content ?? '').slice(0, 6000);
  const copywriting = (vendoredSkill('landing-copywriting')?.content ?? '').slice(0, 5000);
  const uiUxForPlan = (vendoredSkill('ui-ux-pro-max')?.content ?? '').slice(0, 3000);
  const scrollCraft = vendoredSkill('scroll-craft')?.content ?? '';
  const { text } = await generateText({
    model,
    maxOutputTokens: BUDGET.plan,
    system: [
      'You are a direct-response strategist and information architect. You produce a page PLAN, never HTML.',
      'Ground every choice in the facts given. If a fact is missing, say so in the plan rather than inventing it.',
      '',
      'HOW A CONVERTING PAGE IS STRUCTURED:',
      structure,
      '',
      'HOW THE COPY IS WRITTEN:',
      copywriting,
      '',
      scrollCraft.slice(0, 2500),
      uiUxForPlan,
    ].join('\n'),
    prompt: [
      'Produce the plan for this landing page. Answer in four labelled blocks, no preamble.',
      '',
      'FACTS:',
      `Business: ${brief.businessName}`,
      `Selling: ${brief.productName}`,
      brief.audience ? `Audience: ${brief.audience}` : '',
      brief.offer ? `Offer exactly as it must appear: ${brief.offer}` : '',
      brief.highlights?.length ? `Selling points: ${brief.highlights.join('; ')}` : '',
      brief.proofPoints?.length ? `Proof available: ${brief.proofPoints.join('; ')}` : '',
      brief.faqs?.length ? `Real questions: ${brief.faqs.map((f) => `${f.question} => ${f.answer}`).join(' | ')}` : '',
      `Phone: ${brief.phone}`,
      '',
      'BLOCK 1 POSITIONING: audience (one sentence), promise (one sentence a stranger could repeat), whyNow (one sentence),',
      'three objections each with the honest answer from the facts, and the proof list.',
      'BLOCK 2 SECTIONS: 7 to 10 sections in order. For each: a kind and one line saying what it is FOR.',
      'BLOCK 3 PEAK: the single moment the page is built around (which section, and why it earns the most attention).',
      'BLOCK 4 CTA PATH: where the button appears, what it says, and what happens when it is pressed.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  const raw = strip(text);
  const sections = [...raw.matchAll(/^\s*(?:\d+[.)]|[-*])\s*([a-z][a-z \-/]{2,30})[:\-–]\s*(.+)$/gim)].map((m) => ({
    kind: m[1].trim().toLowerCase(),
    purpose: m[2].trim(),
  }));
  const promise = /promise[:\-–]\s*(.+)/i.exec(raw)?.[1]?.trim() ?? brief.productName;
  const peak = /peak[:\-–]\s*(.+)/i.exec(raw)?.[1]?.trim() ?? '';
  const ctaPath = /cta path[:\-–]\s*(.+)/i.exec(raw)?.[1]?.trim() ?? '';
  const objections = [...raw.matchAll(/objection[:\-–]\s*(.+?)\s*(?:=>|->|answer[:\-–])\s*(.+)/gi)].map((m) => ({
    objection: m[1].trim(),
    answer: m[2].trim(),
  }));

  return {
    positioning: {
      audience: /audience[:\-–]\s*(.+)/i.exec(raw)?.[1]?.trim() ?? brief.audience ?? '',
      promise,
      whyNow: /why ?now[:\-–]\s*(.+)/i.exec(raw)?.[1]?.trim() ?? '',
      objections,
      proof: brief.proofPoints ?? [],
    },
    sections: sections.length ? sections : [{ kind: 'hero', purpose: 'state the promise' }],
    peak,
    ctaPath,
    raw,
  };
}

export async function authorPage(brief: PageBrief, plan: PagePlan, model: any): Promise<string> {
  const scrollCraft = vendoredSkill('scroll-craft')?.content ?? '';
  const uiUx = vendoredSkill('ui-ux-pro-max')?.content ?? '';
  const artDirection = (vendoredSkill('landing-art-direction')?.content ?? '').slice(0, 3500);
  const guardrails = (vendoredSkill('ux-guardrails')?.content ?? '').slice(0, 3500);
  const craftFloor = (vendoredSkill('impeccable-craft-floor')?.content ?? '').slice(0, 3500);
  const images = [brief.heroImage, ...(brief.galleryImages ?? [])].filter(Boolean) as string[];

  const { text, finishReason, usage } = await generateText({
    model,
    maxOutputTokens: BUDGET.author,
    system: [
      'You are a senior product designer and direct-response copywriter. You write production HTML and CSS.',
      '',
      'THE TWO HOUSE SKILLS. Follow them; they are the standard, not a suggestion.',
      '===== craft floor: the bans =====',
      craftFloor,
      '',
      '===== art direction =====',
      artDirection,
      '',
      '===== ux guardrails =====',
      guardrails,
      '',
      '===== scroll-craft (rhythm) =====',
      scrollCraft.slice(0, 1500),
      '',
      'THE RUBRIC YOUR WORK IS JUDGED AGAINST:',
      ...RUBRIC.map((r) => `- ${r}`),
      '',
      'HOUSE RULES:',
      '- One complete document: <!DOCTYPE html>, one <style> block, no frameworks, no external JS.',
      `- Palette: background ${brief.brandColor || '#0B1220'}, text #F7F6F3, muted #A9B6C9, one accent (#7DD3FC).`,
      '- A clamp() type scale, 17-18px body, tight heading letter-spacing, generous spacing rhythm.',
      '- 44px minimum touch targets, visible focus rings, a prefers-reduced-motion block, lazy images with alt text.',
      '- No em dashes. No lorem ipsum. No invented price, date, statistic or testimonial.',
      '',
      'STRUCTURE THAT MUST EXIST IN THE MARKUP, not just in the copy:',
      brief.faqs?.length
        ? `- An FAQ built from <details><summary>…</summary><p>…</p></details>, one per real pair below. Do not paraphrase them.`
        : '',
      brief.proofPoints?.length
        ? `- A visible proof strip carrying these exact claims: ${brief.proofPoints.join(' | ')}. Each as its own element with a number in it.`
        : '',
      '- A <footer> with the business name and the phone number.',
      '- At least five sections with DIFFERENT shapes: hero, cards, proof, a wide photograph, FAQ, closing band.',
      `- Use ONLY these images, and make sure each fills its frame: ${images.join(' , ') || '(none supplied)'}`,
      `- Every call to action dials or messages ${brief.phone}.`,
    ].join('\n'),
    prompt: [
      factsBlock(brief),
      '',
      'Write the page from this plan. Follow the section order and each section\'s purpose.',
      '',
      'PLAN:',
      `Audience: ${plan.positioning.audience}`,
      `Promise: ${plan.positioning.promise}`,
      `Why now: ${plan.positioning.whyNow}`,
      `Sections, in order: ${plan.sections.map((s, i) => `${i + 1}. ${s.kind} (${s.purpose})`).join(' | ')}`,
      `The one peak: ${plan.peak}`,
      `CTA path: ${plan.ctaPath}`,
      plan.positioning.objections.length ? `Objections to answer: ${plan.positioning.objections.map((o) => `${o.objection} => ${o.answer}`).join(' | ')}` : '',
      '',
      brief.faqs?.length ? `REAL FAQ PAIRS TO USE VERBATIM:\n${brief.faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}` : '',
      '',
      'Return the complete HTML document and nothing else.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  let authored = noDash(strip(text));
  console.log(`  author: ${authored.length} chars (finish=${finishReason}, ${usage?.outputTokens ?? '?'} tokens)`);

  // MEASURED CONSTRAINTS, so this is handled rather than rediscovered: as the prompt grows this model spends its
  // ENTIRE output budget on reasoning and returns an empty string with finish=length. It happened at 24k and again at
  // 32k as requirements were added. A blank page is not a failure to report; it is a second, leaner attempt.
  if (authored.length < 500) {
    console.log('  author came back empty — retrying with a lean prompt (facts, plan and rules only)');
    const lean = await generateText({
      model,
      maxOutputTokens: BUDGET.author,
      system: [
        'You are a senior designer and direct-response copywriter. Write one complete HTML document.',
        'Rules: one <style> block, no frameworks, no external JS, clamp() type scale, 44px touch targets,',
        'a prefers-reduced-motion block, lazy images with alt text, no em dashes, nothing invented.',
      ].join('\n'),
      prompt: [
        factsBlock(brief),
        '',
        'PLAN:',
        `Promise: ${plan.positioning.promise}`,
        `Sections, in order: ${plan.sections.map((s, i) => `${i + 1}. ${s.kind} (${s.purpose})`).join(' | ')}`,
        `Peak: ${plan.peak}`,
        '',
        brief.faqs?.length
          ? `Use these FAQ pairs verbatim, each in <details><summary>Q</summary><p>A</p></details>: ${brief.faqs.map((f) => `${f.question} => ${f.answer}`).join(' | ')}`
          : '',
        brief.proofPoints?.length ? `Proof strip with: ${brief.proofPoints.join(' | ')}` : '',
        '',
        'Return the complete HTML document and nothing else.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    authored = noDash(strip(lean.text));
    console.log(`  lean author: ${authored.length} chars (finish=${lean.finishReason}, ${lean.usage?.outputTokens ?? '?'} tokens)`);
  }

  return authored;
}

/** Score a rendered screenshot against the rubric. Vision only: the numbers come from looking at the page. */
export async function critiquePage(
  screenshotUrl: string,
  inspect: (url: string, prompt: string) => Promise<string>,
): Promise<Critique> {
  const answer = await inspect(
    screenshotUrl,
    [
      `You are a hard-to-please design director reviewing a landing page screenshot. Judge against this rubric:\n${(vendoredSkill('impeccable-critique')?.content ?? '').slice(0, 7000)}`,
      'Score each dimension from 1 to 10 and give ONE specific fix for anything below 8.',
      'Answer in this exact format and nothing else:',
      'HIERARCHY: n', 'ONE_MESSAGE: n', 'CTA: n', 'CONTRAST: n', 'IMAGERY: n', 'DEAD_SPACE: n', 'RHYTHM: n', 'PROOF: n', 'CRAFT: n',
      'FIXES:',
      '- (a specific change, naming the element)',
      '- (another)',
      '',
      'Be concrete. "Improve spacing" is not a fix; "the hero image stops 300px above the headline, let it fill the hero" is.',
    ].join('\n'),
  );

  const raw = String(answer ?? '');
  const scores: Record<string, number> = {};
  for (const key of ['HIERARCHY', 'ONE_MESSAGE', 'CTA', 'CONTRAST', 'IMAGERY', 'DEAD_SPACE', 'RHYTHM', 'PROOF', 'CRAFT']) {
    const found = new RegExp(`${key}\\s*[:\\-–]\\s*(\\d{1,2})`, 'i').exec(raw);
    if (found) scores[key.toLowerCase()] = Number(found[1]);
  }
  const fixes = [...raw.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].trim()).filter((line) => line.length > 8);
  const values = Object.values(scores);
  const ok = values.length > 0 && values.every((v) => v >= 8);

  return { ok, scores, fixes, raw };
}

export async function revisePage(html: string, critique: Critique, model: any, brief?: PageBrief): Promise<string> {
  const { text, finishReason, usage } = await generateText({
    model,
    maxOutputTokens: BUDGET.revise,
    system: [
      'You are a senior designer revising your own work after a design review.',
      'Change only what the review asks for, keep everything that works, and return the ENTIRE updated document.',
      'You may not remove the FAQ, the proof strip, any supplied image, or the footer phone number: those are requirements.',
      'No commentary, no markdown fences.',
      ...RUBRIC.map((r) => `- ${r}`),
    ].join('\n'),
    prompt: [
      brief ? factsBlock(brief) : '',
      '',
      'THE REVIEW:',
      critique.raw,
      '',
      'THE CURRENT PAGE:',
      html,
      '',
      'Return the full corrected HTML document.',
    ].join('\n'),
  });
  console.log(`  revise: ${String(text ?? '').length} chars (finish=${finishReason}, ${usage?.outputTokens ?? '?'} tokens)`);
  return noDash(strip(text));
}

/**
 * Run the whole thing: plan, author, then look at it and improve it until the review passes or the rounds run out.
 *
 * `screenshot` and `inspect` are injected so this can be driven from a script (with the E2B Chrome and Gemini vision)
 * and so the loop itself is testable without either.
 */
export async function buildPageWithReview(opts: {
  brief: PageBrief;
  model: any;
  screenshot: (html: string, label: string) => Promise<string | null>;
  inspect: (url: string, prompt: string) => Promise<string>;
  maxRounds?: number;
}): Promise<PipelineResult> {
  const { brief, model, screenshot, inspect } = opts;
  const maxRounds = opts.maxRounds ?? 3;

  console.log('▸ planning');
  const plan = await planPage(brief, model);
  console.log(`  sections: ${plan.sections.map((s) => s.kind).join(', ')}`);
  console.log(`  peak: ${plan.peak.slice(0, 100)}`);

  console.log('\n▸ authoring');
  let html = await authorPage(brief, plan, model);
  const screenshots: string[] = [];
  const critiques: Critique[] = [];
  let iterations = 0;

  for (let round = 0; round < maxRounds; round++) {
    iterations = round + 1;
    const shot = await screenshot(html, `round-${iterations}`);
    if (shot) screenshots.push(shot);
    if (!shot) {
      console.log('  no screenshot — cannot review, stopping the loop');
      break;
    }

    console.log(`\n▸ critique round ${iterations}`);
    const critique = await critiquePage(shot, inspect);
    critiques.push(critique);
    console.log(`  scores: ${Object.entries(critique.scores).map(([k, v]) => `${k} ${v}`).join(', ') || '(unparsed)'}`);
    for (const fix of critique.fixes.slice(0, 5)) console.log(`   fix: ${fix}`);
    if (critique.ok) {
      console.log('  review passed');
      break;
    }
    if (round === maxRounds - 1) break;

    console.log('\n▸ revising');
    const revised = await revisePage(html, critique, model, brief);
    // A revision that DELETES the supplied photographs is not an improvement, however it is justified. The critic
    // demanded a product screenshot, and the model's way of complying was to remove the photographs we supplied -
    // imagery then scored 3 and the gate refused the page. Keep the previous version when imagery is lost.
    const supplied = [brief.heroImage, ...(brief.galleryImages ?? [])].filter(Boolean) as string[];
    const lostImages = supplied.filter((url) => !revised.includes(url));
    if (!revised || revised.length <= html.length * 0.5) {
      console.log('  revision discarded: it came back too small to be the same page');
    } else if (lostImages.length) {
      console.log(`  revision discarded: it dropped ${lostImages.length} supplied image(s) instead of improving them`);
    } else {
      html = revised;
    }
  }

  const named = [brief.businessName, brief.phone.replace(/\s+/g, '')].filter(Boolean);
  const fidelity = named.filter((token) => !html.toLowerCase().includes(String(token).toLowerCase()));
  if (fidelity.length) {
    console.log(`  FIDELITY FAILURE: the page does not mention ${fidelity.join(', ')} — it drifted off the brief`);
  }

  return { html, plan, qa: gradePageHtml(html), critiques, iterations, screenshots, fidelity };
}
