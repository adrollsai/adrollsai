import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PageEditError,
  describeEdit,
  ensureSections,
  editSection,
  isSectionAllowed,
  sectionById,
  stripDisallowedSections,
  verifyEdit,
} from '@/lib/site/page-sections';

/**
 * Editing a live landing page one section at a time.
 *
 * Publishing a page was a tool; changing one line on it was not. The only other route was
 * `create_landing_page`, which regenerates the WHOLE document from a prompt — so "change the phone
 * number in the footer" could also re-pick the hero image, re-word the headline and invent a price.
 * That is why the page editor in the UI is section-based, and why the agent was locked out of the
 * most ordinary page task there is.
 *
 * These tools use the same machinery as `app/api/landing-page/edit`: section markers in the HTML,
 * `editSection`/`replaceTextOnce`, and `verifyEdit` which refuses to save when anything outside the
 * requested section moved. No model is called, so no credits are spent, and the reply can say exactly
 * what changed.
 *
 * It IS gated. A page is live at its slug the moment the row exists (there is no draft state), so a
 * section edit changes what the public sees in the business's name — the same reason publishing is
 * gated. The approval card carries the page, the section and the new text.
 */

export const MAX_SECTION_CHARS = 20_000;

export function createPageEditTools(supabase: SupabaseClient, userId: string) {
  const loadPage = async (ref: { pageId?: string | null; slug?: string | null }) => {
    const pageId = String(ref.pageId ?? '').trim();
    const slug = String(ref.slug ?? '').trim();
    if (!pageId && !slug) throw new Error('give pageId or slug');
    let query = supabase.from('landing_pages').select('id, slug, title, html_content').eq('user_id', userId);
    query = pageId ? query.eq('id', pageId) : query.eq('slug', slug);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`could not read that page: ${error.message}`);
    if (!data) throw new Error(pageId ? `no page with id ${pageId}` : `no page with slug "${slug}"`);
    return data as { id: string; slug: string; title: string; html_content: string };
  };

  return {
    page_read_sections: tool({
      description:
        'Read a live landing page as editable SECTIONS (hero, features, pricing, footer…), with each ' +
        'section\'s id and its current HTML. Use it before page_edit_section so the edit replaces the right ' +
        'block, and when the owner asks what is on a page. Pages created by an older builder are named ' +
        'automatically from their markup on first read.',
      inputSchema: z.object({
        slug: z.string().optional().describe('The page slug, e.g. "diwali-3bhk"'),
        pageId: z.string().optional().describe('Or the page id (UUID)'),
        section: z.string().optional().describe('Return only this section, with its full HTML'),
        includeHtml: z.boolean().optional().describe('Include each section\'s HTML (default true for one section, false for the list)'),
      }),
      execute: async (input: any) => {
        try {
          const page = await loadPage({ pageId: input?.pageId, slug: input?.slug });
          const html = String(page.html_content ?? '');
          const parsed = ensureSections(html);
          const wanted = String(input?.section ?? '').trim();
          const includeHtml = input?.includeHtml !== undefined ? Boolean(input.includeHtml) : Boolean(wanted);

          if (wanted) {
            const found = sectionById(parsed, wanted);
            if (!found) {
              return {
                success: false,
                error: `this page has no section "${wanted}"`,
                sections: parsed.sections.map((s) => s.id),
              };
            }
            const clipped = found.html.length > MAX_SECTION_CHARS;
            return {
              success: true,
              pageId: page.id,
              slug: page.slug,
              title: page.title,
              section: {
                id: found.id,
                kind: found.kind,
                bytes: found.html.length,
                html: clipped ? found.html.slice(0, MAX_SECTION_CHARS) : found.html,
                truncated: clipped,
              },
              note: clipped
                ? `the section is ${found.html.length} characters; only the first ${MAX_SECTION_CHARS} are shown. Prefer find/replace for a small change.`
                : undefined,
            };
          }

          return {
            success: true,
            pageId: page.id,
            slug: page.slug,
            title: page.title,
            marked: parsed.marked,
            sections: parsed.sections.map((s) => ({
              id: s.id,
              kind: s.kind,
              bytes: s.html.length,
              ...(includeHtml ? { html: s.html.slice(0, 4_000) } : {}),
            })),
            note: 'Call page_edit_section with a section id and its replacement HTML, or with find/replace for one exact string.',
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    page_edit_section: tool({
      description:
        'Change ONE section of a live landing page, or replace one exact piece of text inside it. It proves ' +
        'every other section came back byte-identical and refuses to save otherwise, so it cannot silently ' +
        'redesign the page. It needs the owner\'s approval first because the page is public. For a small ' +
        'change (a phone number, a price, a date) prefer find/replace: it is refused if the text appears ' +
        'more than once, rather than guessing which one you meant.',
      inputSchema: z.object({
        slug: z.string().optional().describe('The page slug'),
        pageId: z.string().optional().describe('Or the page id (UUID)'),
        section: z.string().optional().describe('The section to edit (required with html; optional scope for find/replace)'),
        html: z.string().optional().describe('The section\'s complete replacement HTML'),
        find: z.string().optional().describe('Exact text to replace (must appear exactly once)'),
        replace: z.string().optional().describe('What to put in its place'),
      }),
      execute: async (input: any) => {
        try {
          const hasHtml = typeof input?.html === 'string' && input.html.trim().length > 0;
          const hasFind = typeof input?.find === 'string' && input.find.length > 0;
          if (hasHtml === hasFind) {
            return {
              success: false,
              error: 'give EITHER html (replace a whole section) OR find+replace (replace one exact string), not neither and not both',
            };
          }
          if (hasHtml && !String(input?.section ?? '').trim()) {
            return { success: false, error: 'replacing a section needs its section id — call page_read_sections first' };
          }
          if (hasFind && typeof input?.replace !== 'string') {
            return { success: false, error: 'find needs a replace value (use an empty string to delete the text)' };
          }

          const page = await loadPage({ pageId: input?.pageId, slug: input?.slug });
          const current = String(page.html_content ?? '');
          if (!current.trim()) {
            return { success: false, error: 'this page has no content yet; generate it before editing it section by section' };
          }

          let nextHtml: string;
          let before;
          let after;
          if (hasHtml) {
            const result = editSection(current, String(input.section).trim(), String(input.html));
            nextHtml = result.html;
            before = result.before;
            after = result.after;
          } else {
            // replaceTextOnce lives in the same module as the marker machinery; imported lazily so the
            // pure helpers above stay the only hard dependency of the read path.
            const { replaceTextOnce } = await import('@/lib/site/page-sections');
            const result = replaceTextOnce(current, String(input.find), String(input.replace), {
              ...(input?.section ? { section: String(input.section).trim() } : {}),
            });
            nextHtml = result.html;
            before = result.before;
            after = result.after;
          }

          // The industry rule, applied on the way out (a page must not gain sections its industry
          // may not have). Stripping is reported, never silent.
          const strip = stripDisallowedSections(nextHtml, null);
          if (strip.removed.length) {
            nextHtml = strip.html;
            after = ensureSections(nextHtml);
          }

          const proof = verifyEdit(before, after, hasHtml ? String(input.section).trim() : undefined, { allowRemoval: true });
          if (!proof.ok) {
            return {
              success: false,
              error: `refusing to save: ${proof.message}`,
              reason: 'leaked_outside',
              proof,
            };
          }

          const { error: writeError } = await supabase
            .from('landing_pages')
            .update({ html_content: nextHtml, updated_at: new Date().toISOString() })
            .eq('id', page.id)
            .eq('user_id', userId);
          if (writeError) {
            return { success: false, error: `the edit was applied but could not be saved: ${writeError.message}` };
          }

          const sections = after.sections.map((s) => ({ id: s.id, kind: s.kind, allowed: s.kind === 'unknown' ? null : isSectionAllowed(null, s.kind) }));
          return {
            success: true,
            pageId: page.id,
            slug: page.slug,
            plan: hasHtml ? 'section' : 'text',
            detail: describeEdit(proof),
            changedSections: proof.changed ?? (hasHtml ? [String(input.section).trim()] : undefined),
            removedSections: strip.removed,
            sections,
            creditsSpent: 0,
            message: `Saved. ${describeEdit(proof)}${strip.removed.length ? ` Also removed ${strip.removed.join(', ')} (not allowed for this industry).` : ''}`,
          };
        } catch (error: any) {
          if (error instanceof PageEditError) {
            return { success: false, error: error.message, reason: error.reason };
          }
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),
  };
}
