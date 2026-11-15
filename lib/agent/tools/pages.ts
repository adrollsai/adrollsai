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
  const brand = safeColor(brief.brandColor);
  const slug = slugify(brief.slug || productName);
  const highlights = (brief.highlights ?? []).map((line) => String(line).trim()).filter(Boolean).slice(0, 6);
  const wa = `https://wa.me/${phone.replace(/\D/g, '')}`;
  const used: SectionKind[] = [];
  const parts: string[] = [];

  const section = (kind: SectionKind, html: string) => {
    if (!isSectionAllowed(brief.industry ?? null, kind)) return;
    used.push(kind);
    parts.push(markSection(kind, html));
  };

  section(
    'hero',
    `<header class="hero">
  <p class="eyebrow">${esc(businessName)}</p>
  <h1>${esc(productName)}</h1>
  ${brief.audience ? `<p class="lede">For ${esc(brief.audience)}.</p>` : ''}
  ${brief.offer ? `<p class="offer">${esc(brief.offer)}</p>` : ''}
  <a class="cta" href="${esc(wa)}">${esc(vocabulary.enquiryCta)}</a>
</header>`,
  );

  section(
    'offerings',
    `<section class="offerings">
  <h2>${esc(vocabulary.collectionHeading)}</h2>
  ${
    highlights.length
      ? `<ul>${highlights.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`
      : `<p>${esc(productName)} — details on request.</p>`
  }
</section>`,
  );

  // ── the registration-page blocks. Each is OMITTED when its facts were not given,
  // because a page that invents a crowd size or a mentor's credentials is a claim the
  // owner never made. Absent is honest; invented is a liability.
  const proofPoints = (brief.proofPoints ?? []).map((line) => String(line).trim()).filter(Boolean).slice(0, 4);
  if (proofPoints.length) {
    section(
      'proof',
      `<section class="proof">
  <ul>${proofPoints.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
</section>`,
    );
  }

  if (brief.startsAt || brief.mentorName) {
    const credentials = (brief.mentorCredentials ?? []).map((line) => String(line).trim()).filter(Boolean).slice(0, 4);
    section(
      'countdown',
      `<section class="countdown">
  ${brief.startsAt ? `<p class="eyebrow">Starts in</p><p class="big">${esc(brief.startsAt)}</p>` : ''}
  ${brief.offer ? `<p class="lede">${esc(brief.offer)}</p>` : ''}
  <a class="cta" href="${esc(wa)}">${esc(vocabulary.enquiryCta)}</a>
</section>`,
    );
    if (brief.mentorName) {
      section(
        'mentor',
        `<section class="mentor">
  <h2>Your mentor</h2>
  <p class="big">${esc(brief.mentorName)}</p>
  ${brief.mentorTitle ? `<p class="lede">${esc(brief.mentorTitle)}</p>` : ''}
  ${credentials.length ? `<ul>${credentials.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
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
  <h2>Glimpses</h2>
  <div class="grid">${gallery.map((url) => `<img src="${esc(url)}" alt="" loading="lazy">`).join('')}</div>
</section>`,
    );
  }

  const trustedBy = (brief.trustedBy ?? []).map((name) => String(name).trim()).filter(Boolean).slice(0, 12);
  if (trustedBy.length) {
    section(
      'logos',
      `<section class="logos">
  <h2>Trusted by</h2>
  <p>${trustedBy.map((name) => esc(name)).join(' · ')}</p>
</section>`,
    );
  }

  section(
    'about',
    `<section class="about">
  <h2>About ${esc(businessName)}</h2>
  <p>${esc(businessName)} works with ${esc(brief.audience || 'customers')} in and around your area.</p>
</section>`,
  );

  section(
    'register',
    `<section class="register">
  <h2>Register</h2>
  <form id="reg" onsubmit="return noboRegister(event)">
    <label>Name <input name="name" required autocomplete="name"></label>
    <label>WhatsApp number <input name="phone" required inputmode="tel" autocomplete="tel"></label>
    <button class="cta" type="submit">Send on WhatsApp</button>
  </form>
  <p class="hint">Opens WhatsApp with your details filled in — press send there.</p>
  <script>
    function noboRegister(event) {
      event.preventDefault();
      var form = event.target;
      var name = (form.elements.name.value || '').trim();
      var phone = (form.elements.phone.value || '').trim();
      var text = 'Hi ${esc(businessName).replace(/'/g, "\\'")}, I want to register for ${esc(productName).replace(/'/g, "\\'")}.'
        + (name ? ' My name is ' + name + '.' : '') + (phone ? ' My number is ' + phone + '.' : '');
      window.open('${esc(wa)}?text=' + encodeURIComponent(text), '_blank');
      return false;
    }
  </script>
</section>`,
  );

  section(
    'cta',
    `<section class="cta-band">
  <h2>Want to know more?</h2>
  <a class="cta" href="${esc(wa)}">${esc(vocabulary.enquiryCta)}</a>
</section>`,
  );

  section(
    'contact',
    `<section class="contact">
  <h2>Talk to us</h2>
  <p>Call or message <a href="tel:${esc(phone.replace(/\s+/g, ''))}">${esc(phone)}</a>.</p>
</section>`,
  );

  section(
    'footer',
    `<footer>
  <p>${esc(businessName)} · ${esc(phone)}</p>
</footer>`,
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(productName)} | ${esc(businessName)}</title>
<meta name="description" content="${esc(`${productName} from ${businessName}.`)}">
<style>
  :root { --brand: ${brand}; --ink: #f6f5f2; --dim: #b9b6ae; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--brand); color: var(--ink);
         font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px; }
  section, header.hero, footer { padding: 44px 20px; max-width: 720px; margin: 0 auto; }
  header.hero { padding-top: 72px; }
  h1 { font-size: clamp(28px, 6vw, 44px); line-height: 1.15; margin: 8px 0 14px; }
  h2 { font-size: clamp(20px, 4vw, 28px); margin: 0 0 14px; }
  .eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: 12px; color: var(--dim); margin: 0; }
  .lede, .offer { color: var(--dim); }
  .cta { display: inline-block; margin-top: 18px; padding: 14px 22px; border-radius: 999px;
         background: var(--ink); color: #0b0f19; font-weight: 700; text-decoration: none; }
  ul { padding-left: 20px; }
  .big { font-size: clamp(18px, 3.4vw, 24px); font-weight: 700; margin: 4px 0 10px; }
  .proof ul, .logos p { display: flex; flex-wrap: wrap; gap: 10px 22px; list-style: none; padding: 0; }
  .proof li { padding: 8px 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; }
  .gallery .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .gallery img { width: 100%; height: 120px; object-fit: cover; border-radius: 12px; display: block; }
  form { display: grid; gap: 12px; max-width: 360px; }
  label { display: grid; gap: 6px; font-size: 14px; color: var(--dim); }
  input { padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2);
          background: rgba(255,255,255,.06); color: var(--ink); font: inherit; }
  button.cta { border: 0; cursor: pointer; font: inherit; font-weight: 700; }
  .hint { font-size: 13px; color: var(--dim); }
  li { margin: 6px 0; }
  a { color: inherit; }
  footer { color: var(--dim); font-size: 14px; border-top: 1px solid rgba(255,255,255,.1); }
</style>
</head>
<body>
${parts.join('\n')}
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
      }),
      execute: async (input: any) => {
        try {
          const built = buildLandingPage(input as LandingPageBrief);
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
            return { success: false, error: `the page was built but the database refused it: ${error.message}` };
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
