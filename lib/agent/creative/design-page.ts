/**
 * Model-designed pages: the two design skills decide the composition, then QA decides whether it ships.
 *
 * WHY THE TEMPLATE HAD TO GO
 * `buildLandingPage` is deterministic template code: one column, one hero, a fixed list of blocks. It is honest, fast
 * and repeatable, and it cannot be tasteful — there is no design decision anywhere in it. That is why the owner's
 * verdict was "I don't think you used any of the skills", and they were right: skills are instructions for a MODEL,
 * and no model was involved in the design.
 *
 * So this asks the model to write the page against `scroll-craft` and `ui-ux-pro-max`, then grades the result with
 * the same artefact QA that blocks bad output everywhere else, and gives the model exactly one correction pass with
 * the specific failures named. If it still fails, the caller falls back to the template rather than shipping a bad
 * page — a plain page that passes beats a beautiful one that does not exist.
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gradePageHtml, type QaResult } from '@/lib/automation/artefact-qa';
import { houseSkill } from '@/lib/agent/house-skills';
import { vendoredSkill } from '@/lib/agent/skills-vendor';

export interface PageDesignBrief {
  businessName: string;
  productName: string;
  audience?: string;
  offer?: string;
  highlights?: string[];
  proofPoints?: string[];
  testimonials?: { quote: string; name?: string; detail?: string }[];
  faqs?: { question: string; answer: string }[];
  images?: string[];
  phone: string;
  brandColor?: string;
  industry?: string | null;
}

export interface PageDesignResult {
  html: string;
  qa: QaResult;
  attempts: number;
  usedSkills: string[];
}

const REQUIRED_BLOCKS = [
  'a hero with a real photograph and the offer stated plainly',
  'the offer or package, as cards',
  'proof: numbers, a testimonial, or both',
  'an FAQ that answers the questions which stop a purchase',
  'one clear call to action repeated at the end',
];

/** The design system the page must sit inside, as CSS rather than as prose the model can reinterpret. */
const TOKENS = `:root{--brand:#0F172A;--ink:#F7F6F3;--muted:#C8C5BC;--surface:rgba(255,255,255,.045);--line:rgba(255,255,255,.14);
  --step-0:clamp(16px,1.9vw,18px);--step-1:clamp(19px,2.6vw,23px);--step-2:clamp(24px,3.6vw,31px);
  --step-3:clamp(31px,5vw,43px);--step-4:clamp(38px,7vw,62px);--radius:16px}`;

/**
 * Compose the page with the model, grade it, and allow exactly one correction.
 *
 * `model` is passed in so this can be driven by a script (a proof) as well as by the agent, and so a test can supply
 * a stub instead of spending a real generation.
 */
export async function designLandingPage(
  brief: PageDesignBrief,
  model: any,
  opts: { maxAttempts?: number } = {},
): Promise<PageDesignResult> {
  const scrollCraft = vendoredSkill('scroll-craft');
  const uiUx = vendoredSkill('ui-ux-pro-max');
  const usedSkills = [scrollCraft?.name, uiUx?.name].filter(Boolean) as string[];

  const facts = [
    `Business: ${brief.businessName}`,
    `Selling: ${brief.productName}`,
    brief.audience ? `For: ${brief.audience}` : '',
    brief.offer ? `Offer, exactly as it must appear: ${brief.offer}` : '',
    brief.highlights?.length ? `Selling points (verbatim): ${brief.highlights.join('; ')}` : '',
    brief.proofPoints?.length ? `Proof the business stands behind: ${brief.proofPoints.join('; ')}` : '',
    brief.testimonials?.length
      ? `Real customer quotes: ${brief.testimonials.map((t) => `"${t.quote}"${t.name ? ` — ${t.name}` : ''}`).join(' | ')}`
      : '',
    brief.faqs?.length ? `Real questions and answers: ${brief.faqs.map((f) => `${f.question} => ${f.answer}`).join(' | ')}` : '',
    brief.images?.length ? `Image URLs you may use (use at least two): ${brief.images.join(', ')}` : '',
    `Phone for the call to action: ${brief.phone}`,
    brief.industry ? `Industry: ${brief.industry}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const system = [
    'You are a senior web designer and direct-response copywriter. You write ONE self-contained HTML page.',
    '',
    'THE TWO SKILLS YOU MUST FOLLOW — these are the house standard, not suggestions:',
    (scrollCraft?.content ?? '').slice(0, 6000),
    '',
    (uiUx?.content ?? '').slice(0, 5000),
    '',
    'HARD RULES:',
    '- A complete document: <!DOCTYPE html>, one <style> block, no build step, no frameworks, no external JS.',
    '- Include the token block verbatim at the start of your CSS and design against those tokens:',
    TOKENS,
    '- At least TWO photographs (use the supplied image URLs), several DIFFERENT section shapes, and a proof or FAQ block.',
    '- Contrast 4.5:1 minimum, 44px minimum touch targets, visible focus rings, prefers-reduced-motion honoured,',
    '  lazy-loaded images with alt text, one type scale, one accent.',
    '- No em dashes anywhere in visible copy. No lorem ipsum. No invented price, date, statistic or testimonial:',
    '  if a fact was not supplied, leave it out rather than making one up.',
    '- Copy is Hinglish-friendly but English on screen. One message per screen.',
  ].join('\n');

  let attempt = 0;
  let html = '';
  let qa = gradePageHtml('');
  const maxAttempts = opts.maxAttempts ?? 2;

  while (attempt < maxAttempts) {
    attempt += 1;
    const correction =
      attempt === 1
        ? ''
        : `\n\nYOUR PREVIOUS ATTEMPT FAILED QA. Fix exactly these and return the whole page again:\n${qa.problems
            .map((p) => `- ${p}`)
            .join('\n')}`;

    const user = [
      'Write the page.',
      '',
      'FACTS (use only these):',
      facts,
      '',
      'THE PAGE MUST CONTAIN:',
      ...REQUIRED_BLOCKS.map((b) => `- ${b}`),
      correction,
    ].join('\n');

    const { text } = await generateText({ model, system, prompt: user, maxOutputTokens: 8000 });
    html = String(text ?? '').trim();

    // Some models wrap the document in a fenced block; take the document itself.
    const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(html);
    if (fenced) html = fenced[1].trim();
    if (!/<html/i.test(html)) {
      qa = gradePageHtml(html);
      continue;
    }

    qa = gradePageHtml(html);
    if (qa.ok) break;
  }

  return { html, qa, attempts: attempt, usedSkills };
}

/** The template fallback, so a failed design still produces a page that passes rather than nothing. */
export function fallbackNote(): string {
  return houseSkill('nobogent-never-invent') ? 'design failed; template used' : 'design failed';
}
