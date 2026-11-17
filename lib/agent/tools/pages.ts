/**
 * Generating a landing page, which the agent could not do at all.
 *
 * THE GAP THIS CLOSES
 * `tools/sites.ts` gave the agent `site_publish_landing_page` — it could PUBLISH a
 * page and never MAKE one. "Make a landing page for the new course" therefore had no
 * tool behind it.
 *
 * WHY THIS DOES NOT CALL A MODEL
 * The obvious build is a prompt to an LLM. That is the version that produced a
 * property-listing site for a film academy, invented prices, and could not be diffed
 * or re-run. So the page is COMPOSED from the brief instead: the industry vocabulary
 * decides every noun (`lib/automation/industry.ts`), and the owner's own inputs
 * decide the copy. Nothing here can invent a price, an amenity or an address, because
 * nothing here writes a fact it was not given.
 *
 * AND IT EMITS THE P6 MARKERS
 * Every section is wrapped in `<!-- nobo:section … -->`, and only the sections the
 * business's industry may have are emitted at all (no floor plans on a film academy).
 * That means the page the agent creates is immediately editable section by section
 * through `lib/site/page-sections.ts` — generated and editable are the same artefact
 * rather than two pipelines that drift.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { industryVocabulary } from '@/lib/automation/industry';
import { markSection, isSectionAllowed, type SectionKind } from '@/lib/site/page-sections';
import { landingPageCss, noEmDash, paletteFor, revealScript } from '@/lib/site/design-system';

export interface LandingPageBrief {
  businessName: string;
  /** What the page is selling, e.g. "Film Editing Batch 12". */
  productName: string;
  /** Who it is for, in the owner's words. */
  audience?: string;
  /** The concrete offer: seats, date, price text they supplied. Never invented here. */
  offer?: string;
  /** Three-to-five selling points, verbatim from the owner. */
  highlights?: string[];
  /** Phone for the WhatsApp/telephone CTA. Required: a page with no way to enquire is a poster. */
  phone: string;
  industry?: string | null;
  /** Optional brand colour as #RRGGBB. */
  brandColor?: string;
  /** URL slug. Defaults to a slug of the product name. */
  slug?: string;

  // ── the blocks a registration page needs, all supplied by the owner ──────────
  /**
   * When it starts, as the owner stated it ("5 January, 7:30 PM IST").
   *
   * A string, not a Date: this page shows the deadline the owner promised, and a
   * timezone guessed by us is a customer arriving at the wrong hour.
   */
  startsAt?: string;
  /** The person teaching or hosting: their name as they write it. */
  mentorName?: string;
  /** What they are, in the owner's words ("India's leading business mentor"). */
  mentorTitle?: string;
  /** Their credentials, verbatim. Never inferred from a website. */
  mentorCredentials?: string[];
  /** Hard numbers the owner can stand behind: "50,000+ realtors trained". */
  proofPoints?: string[];
  /** Image URLs the owner supplied for an event/venue gallery. */
  galleryImages?: string[];
  /** Client or partner names the owner is allowed to display. */
  trustedBy?: string[];
  /** A hero photograph (the business's own, or a generated one). */
  heroImage?: string;
  /** Real customer quotes the owner supplied. The page writes none of its own. */
  testimonials?: { quote: string; name?: string; detail?: string }[];
  /** Questions the owner actually gets asked, with the answers they gave. */
  faqs?: { question: string; answer: string }[];
}

export class LandingPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LandingPageError';
  }
}

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function slugify(value: string): string {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'offer'
  );
}

/** `#1A2B3C` or a safe fallback. Anything else is ignored rather than injected. */
function safeColor(value?: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? String(value) : '#0B0F19';
}

/**
 * Build the page. Pure, so the whole thing is diffable and gate-testable.
 *
 * Only sections this industry is allowed to have are emitted — the same rule the
 * page editor and the reverse's SPEC use, from one vocabulary.
 */
export function buildLandingPage(brief: LandingPageBrief): { html: string; slug: string; sections: SectionKind[] } {
  const businessName = String(brief.businessName ?? '').trim();
  const productName = String(brief.productName ?? '').trim();
  const phone = String(brief.phone ?? '').trim();

  if (!businessName) throw new LandingPageError('a landing page needs the business name');
  if (!productName) throw new LandingPageError('a landing page needs something to sell (productName)');
  if (phone.replace(/\D/g, '').length < 8) {
    throw new LandingPageError(
      'a landing page needs a phone number a customer can actually reach: without one the page cannot take an enquiry',
    );
  }

  const vocabulary = industryVocabulary(brief.industry);
  const palette = paletteFor(brief.brandColor || safeColor(brief.brandColor));
  const slug = slugify(brief.slug || productName);
  const highlights = (brief.highlights ?? []).map((line) => String(line).trim()).filter(Boolean).slice(0, 6);
  const wa = `https://wa.me/${phone.replace(/\D/g, '')}`;
  const tel = `tel:${phone.replace(/[^\d+]/g, '')}`;
  const used: SectionKind[] = [];
  const parts: string[] = [];

  // Copy is cleaned on the way out: `scroll-craft` treats an em dash as machine-written tell, and this is the one
  // place every human-visible string passes through.
  const say = (value: unknown) => esc(noEmDash(String(value ?? '')));

  // At most one eyebrow per three sections. A page with a kicker above every heading reads as a template, so the
  // budget is enforced here rather than trusted to whoever wrote the copy.
  let eyebrows = 0;
  const eyebrow = (text: string) => {
    const budget = Math.max(1, Math.floor(used.length / 3) + 1);
    if (eyebrows >= budget) return '';
    eyebrows += 1;
    return `<p class="eyebrow">${say(text)}</p>`;
  };

  const section = (kind: SectionKind, html: string) => {
    if (!isSectionAllowed(brief.industry ?? null, kind)) return;
    used.push(kind);
    parts.push(markSection(kind, html));
  };

  const heroImage = /^https:\/\//i.test(String(brief.heroImage ?? '')) ? String(brief.heroImage) : '';

  section(
    'hero',
    `<header class="hero">
  ${heroImage ? `<div class="hero__media"><img src="${esc(heroImage)}" alt="${say(businessName)}" width="1600" height="1000" loading="eager" fetchpriority="high"><div class="hero__scrim"></div></div>` : ''}
  <div class="hero__content">
    ${eyebrow(businessName)}
    <h1>${say(productName)}</h1>
    ${brief.audience ? `<p class="lede">For ${say(brief.audience)}.</p>` : ''}
    ${brief.offer ? `<p class="offer">${say(brief.offer)}</p>` : ''}
    <a class="cta" href="${esc(wa)}">${say(vocabulary.enquiryCta)}</a>
    <p class="note">${esc(phone)}</p>
  </div>
</header>`,
  );

  section(
    'offerings',
    `<section class="offerings">
  <div class="wrap">
    <div class="split__copy">
      <h2>${say(vocabulary.collectionHeading)}</h2>
      ${
        highlights.length
          ? `<div class="cards">${highlights
              .map((line, index) => `<div class="card"><span class="card__index">${String(index + 1).padStart(2, '0')}</span><p>${say(line)}</p></div>`)
              .join('')}</div>`
          : `<p>${say(productName)}. Details on request.</p>`
      }
    </div>
  </div>
</section>`,
  );

  // ── the registration-page blocks. Each is OMITTED when its facts were not given,
  // because a page that invents a crowd size or a mentor's credentials is a claim the
  // owner never made. Absent is honest; invented is a liability.
  const proofPoints = (brief.proofPoints ?? []).map((line) => noEmDash(String(line).trim())).filter(Boolean).slice(0, 4);
  if (proofPoints.length) {
    section(
      'proof',
      `<section class="proof">
  <div class="wrap">
    <ul>${proofPoints.map((line) => `<li>${say(line)}</li>`).join('')}</ul>
  </div>
</section>`,
    );
  }

  if (brief.startsAt || brief.mentorName) {
    const credentials = (brief.mentorCredentials ?? []).map((line) => String(line).trim()).filter(Boolean).slice(0, 4);
    section(
      'countdown',
      `<section class="countdown">
  <div class="wrap narrow">
    ${brief.startsAt ? `${eyebrow('Starts in')}<p class="big">${say(brief.startsAt)}</p>` : ''}
    ${brief.offer ? `<p class="lede">${say(brief.offer)}</p>` : ''}
    <a class="cta" href="${esc(wa)}">${say(vocabulary.enquiryCta)}</a>
  </div>
</section>`,
    );
    if (brief.mentorName) {
      section(
        'mentor',
        `<section class="mentor">
  <div class="wrap narrow">
    <h2>Your mentor</h2>
    <p class="big">${say(brief.mentorName)}</p>
    ${brief.mentorTitle ? `<p class="lede">${say(brief.mentorTitle)}</p>` : ''}
    ${credentials.length ? `<ul>${credentials.map((line) => `<li>${say(line)}</li>`).join('')}</ul>` : ''}
  </div>
</section>`,
      );
    }
  }

  const gallery = (brief.galleryImages ?? [])
    .map((url) => String(url).trim())
    .filter((url) => /^https:\/\//i.test(url))
    .slice(0, 6);
  if (gallery.length) {
    section(
      'gallery',
      `<section class="gallery">
  <div class="wrap">
    <h2>Glimpses</h2>
    <div class="grid">${gallery
      .map((url, index) => `<img src="${esc(url)}" alt="${say(businessName)} photograph ${index + 1}" loading="lazy" decoding="async" width="480" height="320">`)
      .join('')}</div>
  </div>
</section>`,
    );
  }

  const trustedBy = (brief.trustedBy ?? []).map((name) => String(name).trim()).filter(Boolean).slice(0, 12);
  if (trustedBy.length) {
    section(
      'logos',
      `<section class="logos">
  <div class="wrap narrow">
    <h2>Trusted by</h2>
    <p>${trustedBy.map((name) => say(name)).join(' · ')}</p>
  </div>
</section>`,
    );
  }

  // Only quotes the owner actually supplied. A generated testimonial is a fabricated endorsement, which is both a
  // legal problem and the fastest way to lose the audience's trust.
  const testimonials = (brief.testimonials ?? [])
    .map((item) => ({
      quote: noEmDash(String(item?.quote ?? '').trim()),
      name: noEmDash(String(item?.name ?? '').trim()),
      detail: noEmDash(String(item?.detail ?? '').trim()),
    }))
    .filter((item) => item.quote.length > 0)
    .slice(0, 3);
  if (testimonials.length) {
    section(
      'testimonials',
      `<section class="testimonials">
  <div class="wrap">
    <h2>What people say</h2>
    <div class="cards">${testimonials
      .map(
        (item) => `<figure class="card">
      <blockquote><p>${say(item.quote)}</p></blockquote>
      ${item.name ? `<figcaption class="note">${say(item.name)}${item.detail ? `, ${say(item.detail)}` : ''}</figcaption>` : ''}
    </figure>`,
      )
      .join('')}</div>
  </div>
</section>`,
    );
  }

  // Answers the questions that stop a purchase. Uses <details> so it costs nothing until opened, and needs no JS.
  const faqs = (brief.faqs ?? [])
    .map((item) => ({
      question: noEmDash(String(item?.question ?? '').trim()),
      answer: noEmDash(String(item?.answer ?? '').trim()),
    }))
    .filter((item) => item.question.length > 0 && item.answer.length > 0)
    .slice(0, 6);
  if (faqs.length) {
    section(
      'faq',
      `<section class="faq">
  <div class="wrap narrow">
    <h2>Questions</h2>
    ${faqs
      .map(
        (item) => `<details>
      <summary>${say(item.question)}</summary>
      <p>${say(item.answer)}</p>
    </details>`,
      )
      .join('\n    ')}
  </div>
</section>`,
    );
  }

  section(
    'about',
    `<section class="about">
  <div class="wrap narrow">
    <h2>About ${say(businessName)}</h2>
    <p>${say(businessName)} works with ${say(brief.audience || 'customers')} in and around your area.</p>
  </div>
</section>`,
  );

  section(
    'register',
    `<section class="register">
  <div class="wrap narrow">
    <h2>Register</h2>
    <form id="reg" onsubmit="return noboRegister(event)">
      <label>Name <input name="name" required autocomplete="name" placeholder="Your name"></label>
      <label>WhatsApp number <input name="phone" required inputmode="tel" autocomplete="tel" placeholder="10-digit mobile"></label>
      <button class="cta" type="submit">Send on WhatsApp</button>
    </form>
    <p class="note">Opens WhatsApp with your details filled in. Press send there.</p>
  </div>
  <script>
    function noboRegister(event) {
      event.preventDefault();
      var form = event.target;
      var name = (form.elements.name.value || '').trim();
      var phone = (form.elements.phone.value || '').trim();
      var text = 'Hi ${esc(noEmDash(businessName)).replace(/'/g, "\\'")}, I want to register for ${esc(noEmDash(productName)).replace(/'/g, "\\'")}.'
        + (name ? ' My name is ' + name + '.' : '') + (phone ? ' My number is ' + phone + '.' : '');
      window.open('${esc(wa)}?text=' + encodeURIComponent(text), '_blank');
      return false;
    }
  </script>
</section>`,
  );

  // The engineered peak: one full-width band, the only place the accent inverts. It gets the scroll room and the
  // strongest contrast on the page, so the page has somewhere it is going rather than a flat run of sections.
  section(
    'cta',
    `<section class="cta-band band">
  <div class="wrap narrow">
    <h2>${say(brief.offer ? `Ready for ${productName}?` : 'Want to know more?')}</h2>
    ${brief.offer ? `<p class="lede">${say(brief.offer)}</p>` : ''}
    <a class="cta" href="${esc(wa)}">${say(vocabulary.enquiryCta)}</a>
  </div>
</section>`,
  );

  section(
    'contact',
    `<section class="contact">
  <div class="wrap narrow">
    <h2>Talk to us</h2>
    <p>Call or message <a href="${esc(tel)}">${esc(phone)}</a>.</p>
  </div>
</section>`,
  );

  section(
    'footer',
    `<footer>
  <div class="wrap narrow">
    <p>${say(businessName)} · ${esc(phone)}</p>
  </div>
</footer>`,
  );

  const sticky = `<div class="sticky-cta" aria-label="Contact ${esc(noEmDash(businessName))}">
  <a class="sticky-cta__call" href="${esc(tel)}">Call</a>
  <a class="cta" href="${esc(wa)}">${say(vocabulary.enquiryCta)}</a>
</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(noEmDash(productName))} | ${esc(noEmDash(businessName))}</title>
<meta name="description" content="${esc(noEmDash(`${productName} from ${businessName}${brief.offer ? `. ${brief.offer}` : ''}.`))}">
<meta name="theme-color" content="${palette.brand}">
<meta property="og:title" content="${esc(noEmDash(productName))}">
<meta property="og:description" content="${esc(noEmDash(brief.offer || `${productName} from ${businessName}.`))}">
${heroImage ? `<meta property="og:image" content="${esc(heroImage)}">` : ''}
<style>
${landingPageCss(palette)}
</style>
</head>
<body>
<main>
${/* Each section's root landmark opts into the reveal observer. Done here, not in fourteen templates, so a
   section added later cannot forget to animate and cannot accidentally animate twice. */ ''}${parts
    .map((part) => part.replace(/<(header|section|footer)(\s|>)/, '<$1 data-reveal$2'))
    .join('\n')}
</main>
${sticky}
${revealScript()}
</body>
</html>
`;

  return { html, slug, sections: used };
}

/**
 * Build this business's whole website from its own catalogue.
 *
 * A landing page is one offer to one audience; a website is the business — home, offerings, contact.
 * There was no tool for the latter, so "build me a website" produced a landing page instead.
 */
function buildWebsiteTool(supabase: any, userId: string) {
  return tool({
    description:
      "Build or rebuild this business's FULL WEBSITE (home, offerings from the catalogue, proof, contact) and " +
      'publish it at /shared/<owner>/index. Use it when the owner asks for a website, a site, or their whole ' +
      'online presence — NOT for a single-offer page (that is create_landing_page). If you are unsure which ' +
      'they want, ASK: one page for one offer, or a multi-section website for the whole business.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { ensureTenantSite } = await import('@/lib/automation/site-builder');
        const built = await ensureTenantSite(supabase, userId);
        const { data } = await supabase
          .from('landing_pages')
          .select('slug, title')
          .eq('user_id', userId)
          .eq('slug', 'index')
          .maybeSingle();
        return {
          success: true,
          slug: data?.slug ?? 'index',
          title: data?.title ?? null,
          url: `/shared/${userId}/index`,
          created: (built as any)?.created ?? null,
          skipped: (built as any)?.skipped ?? null,
          message:
            'The website is built from the profile and catalogue and live at ' +
            `/shared/${userId}/index. Review it, then tell the owner what it contains and what it left out.`,
        };
      } catch (error: any) {
        return { success: false, error: String(error?.message || error) };
      }
    },
  });
}

export function createPageAuthoringTools(supabase: SupabaseClient, userId: string) {
  return {
    build_website: buildWebsiteTool(supabase, userId),
    create_landing_page: tool({
      description:
        'Create a landing page for an offer and save it. BEFORE YOU DESIGN: call get_skill(\'scroll-craft\') for ' +
  'landing-page structure that survives a thumb-scroll, and get_skill(\'ui-ux-pro-max\') for the layout, ' +
  'typography and CTA system — or pick_skill with what the page must achieve if you are unsure which ' +
  'applies. Compose it from facts you were GIVEN: the business ' +
        'name, what is being sold, who it is for, the offer as the owner stated it, and a phone number. Do not ' +
        'invent a price, a date, an address, a discount or a testimonial — leave it out and ask instead. The page ' +
        'is emitted with editable sections, so it can be adjusted one section at a time afterwards. ' +
        'A phone number is required because a page with no way to enquire takes no enquiries.',
      inputSchema: z.object({
        // Minimums are on the schema, not only in the builder: a model that passes
        // blank strings should get a validation error it can correct, not a tool result
        // saying "built" or a builder exception it cannot see.
        businessName: z.string().min(1).describe('The business name as the owner writes it'),
        productName: z.string().min(1).describe('What the page is selling'),
        audience: z.string().optional().describe('Who it is for, in the owner\'s words'),
        offer: z.string().optional().describe('The offer exactly as stated — never invent one'),
        highlights: z.array(z.string()).optional().describe('Selling points, verbatim from the owner'),
        phone: z
          .string()
          .min(8)
          .describe('Phone for the WhatsApp / call CTA — a page with no way to enquire takes no enquiries'),
        industry: z.string().optional().describe('The business industry, if known'),
        brandColor: z.string().optional().describe('#RRGGBB'),
        slug: z.string().optional().describe('URL slug'),
        // The three things a page needs to convert that copy alone cannot supply. All optional and all
        // owner-supplied: the builder refuses to invent a quote, a number or a question.
        heroImage: z
          .string()
          .optional()
          .describe('A public https image URL for the hero: the business\'s own photograph, or one generated for this offer'),
        proofPoints: z
          .array(z.string())
          .optional()
          .describe('Hard numbers the owner can stand behind ("launched in a week"). Never invent one.'),
        testimonials: z
          .array(
            z.object({
              quote: z.string().describe('The customer\'s words, verbatim'),
              name: z.string().optional(),
              detail: z.string().optional().describe('Where they are from, or what they bought'),
            }),
          )
          .optional()
          .describe('Real customer quotes only. A generated testimonial is a fabricated endorsement: pass none instead.'),
        faqs: z
          .array(z.object({ question: z.string(), answer: z.string() }))
          .optional()
          .describe('Questions the owner actually gets asked, with the answer they gave. Ask, do not write them.'),
      }),
      execute: async (input: any) => {
        try {
          // IMAGERY THE BUSINESS ACTUALLY OWNS. A page with one hero photograph is the page the owner rejected, and
          // the cause was that the brief carried a single image — the builder happily emits a gallery when it is given
          // one. So when the caller supplies no gallery, use the images already in this business's asset library: their
          // own photos or ones generated for them. Nothing invented, and the page stops being a single-column template.
          const inputWithImagery = { ...(input as any) };
          const hasGallery = Array.isArray(inputWithImagery.galleryImages) && inputWithImagery.galleryImages.length > 0;
          if (!hasGallery) {
            try {
              const { data: assets } = await supabase
                .from('assets')
                .select('url, created_at')
                .eq('user_id', userId)
                .eq('type', 'image')
                .order('created_at', { ascending: false })
                .limit(8);
              const urls = (assets ?? [])
                .map((row: any) => String(row?.url ?? ''))
                .filter((url: string) => /^https:\/\//i.test(url))
                .filter((url: string) => url !== inputWithImagery.heroImage)
                // The asset library holds EVERY creative made for this account, including other businesses and
                // festive posters. Pulling it blindly put a Diwali "GRAND OPENING 50% OFF" poster on a Nobogent page,
                // which is worse than no gallery: somebody else's offer on our own page.
                .filter((url: string) => !/grand[-_ ]?opening|diwali|holi|bhai[-_ ]?dooj|festive|christmas|new[-_ ]?year/i.test(url))
                .slice(0, 4);
              if (urls.length) {
                // LOOK AT THEM FIRST. The asset library holds every creative made for this account - other
                // businesses, festive posters, text posters. Filenames are opaque, so a name filter cannot help:
                // the only check that works is showing each image to a vision model and asking whether it belongs
                // on a page selling THIS product. An unrelated image is worse than none: it advertises somebody
                // else's offer on the client's own page.
                const { analyzeImageWithGemini } = await import('@/utils/image-analysis');
                const { filterRelevantImages } = await import('@/lib/site/image-relevance');
                const checked = await filterRelevantImages({
                  candidates: urls.map((url) => ({ url, origin: 'asset library' })),
                  brief: {
                    productName: String(inputWithImagery.productName ?? ''),
                    businessName: String(inputWithImagery.businessName ?? ''),
                    offer: inputWithImagery.offer ? String(inputWithImagery.offer) : undefined,
                  },
                  inspect: (url, prompt) => analyzeImageWithGemini(url, prompt),
                  limit: 4,
                });
                if (checked.keep.length) inputWithImagery.galleryImages = checked.keep;
                (inputWithImagery as any).imageCheck = {
                  kept: checked.keep.length,
                  rejected: checked.rejected,
                };
              }
            } catch {
              /* the gallery is an enhancement; a page without one is still a page */
            }
          }

          // THE TEMPLATE IS NO LONGER THE PAGE PATH: plan -> author -> screenshot -> critique -> revise -> publish.
          // Representational imagery is generated when the business has none, and the bar is acceptable work rather
          // than perfect work, so something ships that the owner can then refine.
          {
            const { buildAndPublishPage } = await import('@/lib/agent/creative/page-publish');
            const piped = await buildAndPublishPage(supabase, userId, input as any);
            return {
              success: piped.success,
              ...(piped.success
                ? {
                    slug: piped.slug,
                    url: `/shared/${userId}/${piped.slug}`,
                    message:
                      'Page planned, written, rendered, reviewed and revised before publishing at ' +
                      `/shared/${userId}/${piped.slug}. Review average ${piped.averageScore}/10: ` +
                      Object.entries(piped.review?.scores ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') +
                      '. ' +
                      (piped.generatedImagery?.length
                        ? `${piped.generatedImagery.length} representational image(s) were generated because the business had none; the owner can replace them.`
                        : '') +
                      ' Tell the owner the scores and anything you assumed.',
                  }
                : { error: piped.error }),
              review: piped.review,
              qa: piped.qa?.findings,
              iterations: piped.iterations,
              screenshots: piped.screenshots,
              generatedImagery: piped.generatedImagery,
            };
          }

          const built = buildLandingPage(inputWithImagery as LandingPageBrief);

          // QA BEFORE SAVING. `landing_pages` has no draft state - creating the row publishes the page - so a page
          // that fails the design grade must not be written at all. What this refuses is exactly what shipped last
          // time: one hero image, a single column of text, no proof block, nothing for the eye to land on.
          const { gradePageHtml, describeQa } = await import('@/lib/automation/artefact-qa');
          const pageQa = gradePageHtml(built.html);
          const blocking = pageQa.findings.filter(
            (f) => ['real_imagery', 'several_sections', 'proof_or_faq', 'no_placeholder_copy'].includes(f.check) && !f.ok,
          );
          if (blocking.length) {
            return {
              success: false,
              error:
                'Refusing to publish this page: ' +
                blocking.map((f) => `{f.check} ({f.detail})`).join('; ') +
                '. A page that is one hero and a column of text is not a landing page. Add at least two images ' +
                '(a hero plus a gallery or product shot), five or more distinct sections, and a proof block or an ' +
                'FAQ that answers the questions which stop a purchase, then build it again. ' +
                'If the imagery cannot be verified because the vision service is unavailable, generate the pictures ' +
                'yourself with generate_ai_image — a hero photograph with NO baked-in text, plus two supporting shots ' +
                '— and pass their URLs as heroImage and galleryImages. Do not reuse an ad poster as a page hero: the ' +
                'poster already contains the headline, so the page repeats itself beside it.',
              qa: pageQa.findings,
              sections: built.sections,
            };
          }

          const { data, error } = await supabase
            .from('landing_pages')
            .upsert(
              {
                user_id: userId,
                slug: built.slug,
                title: `${input.productName} | ${input.businessName}`,
                product_name: String(input.productName),
                html_content: built.html,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id, slug' },
            )
            .select('id, slug')
            .single();

          if (error) {
            return { success: false, error: `the page was built but the database refused it: ${error?.message ?? "unknown"}` };
          }

          return {
            success: true,
            pageId: data?.id ?? null,
            slug: built.slug,
            sections: built.sections,
            bytes: built.html.length,
            message:
              `Created the page at /${built.slug} with ${built.sections.length} editable section(s): ` +
              `${built.sections.join(', ')}.`,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message ?? error) };
        }
      },
    }),
  };
}
