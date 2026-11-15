import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { resolveBillingOwner } from '@/lib/automation/billing';
import {
  PageEditError,
  describeEdit,
  disallowedSections,
  editSection,
  ensureSections,
  isSectionAllowed,
  replaceTextOnce,
  stripDisallowedSections,
  verifyEdit,
} from '@/lib/site/page-sections';
import { describeEditPlan, parseEditRequest } from '@/lib/site/page-edit-request';
import { industryVocabulary } from '@/lib/automation/industry';

/**
 * GET  /api/landing-page/edit?pageId=<uuid>   — the sections you can edit
 * POST /api/landing-page/edit                 — change ONE of them
 *
 * WHY THIS EXISTS BESIDE `generate`
 * `POST /api/landing-page/generate` in `mode: 'edit'` sends the entire page to a
 * model with an instruction and takes the entire page back. Ask it to change a phone
 * number and it may re-pick the hero image, re-word the headline and invent a price.
 * It costs a credit, it is not repeatable, and it cannot show what else moved.
 *
 * This route does the boring, correct thing instead: it applies the edit to ONE
 * section, proves every other section came back byte-identical, and refuses a
 * request it cannot apply unambiguously. It calls NO model and therefore spends NO
 * credits — there is no vendor cost to pass on.
 *
 * It also enforces the industry rule on the way out: a page is stripped of sections
 * its industry may not have (floor plans on a film academy's page, the bug that made
 * every tenant a property site). Stripping is reported, never silent.
 */
const supabaseAdmin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

type Authed =
  | { ok: true; userId: string; ownerId: string; industry: string | null; admin: any }
  | { ok: false; response: NextResponse };

async function authenticate(): Promise<Authed> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = supabaseAdmin ?? supabase;
  const ownerId = await resolveBillingOwner(admin, user.id);
  const { data: profile } = await admin
    .from('profiles')
    .select('industry')
    .eq('id', ownerId)
    .maybeSingle();

  return {
    ok: true,
    userId: user.id,
    ownerId,
    industry: (profile?.industry as string | null) ?? null,
    admin,
  };
}

async function loadPage(admin: any, ownerId: string, pageId: string | null, slug: string | null) {
  if (!pageId && !slug) return { page: null, error: 'give pageId or slug' as const };

  let query = admin.from('landing_pages').select('id, user_id, slug, title, html_content').eq('user_id', ownerId);
  query = pageId ? query.eq('id', pageId) : query.eq('slug', slug);
  const { data, error } = await query.maybeSingle();

  if (error) return { page: null, error: String(error.message || error) };
  return { page: data ?? null, error: data ? null : ('no such page' as const) };
}

/** GET — the editable sections of one page, so an editor can offer them. */
export async function GET(request: Request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get('pageId');
    const slug = searchParams.get('slug');
    const loaded = await loadPage(auth.admin, auth.ownerId, pageId, slug);
    if (!loaded.page) {
      return NextResponse.json({ error: `could not read that page: ${loaded.error}` }, { status: 404 });
    }

    const page = ensureSections(String(loaded.page.html_content ?? ''));
    const vocabulary = industryVocabulary(auth.industry);
    const disallowed = disallowedSections(String(loaded.page.html_content ?? ''), auth.industry);

    return NextResponse.json({
      readOnly: true,
      pageId: loaded.page.id,
      slug: loaded.page.slug,
      title: loaded.page.title,
      industry: auth.industry,
      vocabulary: { productNoun: vocabulary.productNoun, collectionHeading: vocabulary.collectionHeading },
      marked: page.marked,
      sections: page.sections.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        bytes: entry.html.length,
        allowed: entry.kind === 'unknown' ? null : isSectionAllowed(auth.industry, entry.kind as never),
      })),
      /** Sections this page has that its industry should not have, if any. */
      disallowed,
      note:
        'POST { section, html } to replace one section, or { find, replace, section? } to replace one ' +
        'exact piece of text. No model is called, so no credits are spent.',
    });
  } catch (error: any) {
    console.error('[landing-page/edit] GET failed:', error?.message || error);
    return NextResponse.json({ error: 'Could not read the page', detail: String(error?.message ?? error) }, { status: 500 });
  }
}

/** POST — apply one surgical edit, prove it, and write it back. */
export async function POST(request: Request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'the request body must be JSON' }, { status: 400 });
    }

    const parsed = parseEditRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.rejection.error, reason: parsed.rejection.reason }, { status: parsed.rejection.status });
    }

    const record = body as Record<string, unknown>;
    const pageId = typeof record.pageId === 'string' && record.pageId.trim() ? record.pageId.trim() : null;
    const slug = typeof record.slug === 'string' && record.slug.trim() ? record.slug.trim() : null;

    const loaded = await loadPage(auth.admin, auth.ownerId, pageId, slug);
    if (!loaded.page) {
      return NextResponse.json({ error: `could not read that page: ${loaded.error}` }, { status: 404 });
    }

    const current = String(loaded.page.html_content ?? '');
    if (!current.trim()) {
      return NextResponse.json(
        { error: 'this page has no content yet; generate it before editing it section by section' },
        { status: 409 },
      );
    }

    // ── apply the edit
    let nextHtml: string;
    let before;
    let after;
    try {
      if (parsed.plan.kind === 'section') {
        const result = editSection(current, parsed.plan.section, parsed.plan.html);
        nextHtml = result.html;
        before = result.before;
        after = result.after;
      } else {
        const result = replaceTextOnce(current, parsed.plan.find, parsed.plan.replace, {
          ...(parsed.plan.section ? { section: parsed.plan.section } : {}),
        });
        nextHtml = result.html;
        before = result.before;
        after = result.after;
      }
    } catch (error: any) {
      if (error instanceof PageEditError) {
        // A refusal is an ANSWER, not a crash: say which reason and what could be
        // done instead, so the UI can put it in front of the owner unchanged.
        const status = error.reason === 'no_such_section' ? 404 : error.reason === 'leaked_outside' ? 409 : 400;
        return NextResponse.json(
          { error: error.message, reason: error.reason, sections: ensureSections(current).sections.map((entry) => entry.id) },
          { status },
        );
      }
      throw error;
    }

    // ── the industry rule, applied on the way out
    const strip = stripDisallowedSections(nextHtml, auth.industry);
    if (strip.removed.length) {
      nextHtml = strip.html;
      after = ensureSections(nextHtml);
    }

    const proof = verifyEdit(before, after, parsed.plan.kind === 'section' ? parsed.plan.section : undefined, {
      allowRemoval: true,
    });
    if (!proof.ok) {
      // The edit itself was fine but something moved that should not have. Do not
      // write it: a page is not worth saving if we cannot say what we saved.
      return NextResponse.json(
        { error: `refusing to save: ${proof.message}`, reason: 'leaked_outside', proof },
        { status: 409 },
      );
    }

    const { error: writeError } = await auth.admin
      .from('landing_pages')
      .update({ html_content: nextHtml, updated_at: new Date().toISOString() })
      .eq('id', loaded.page.id)
      .eq('user_id', auth.ownerId);

    if (writeError) {
      return NextResponse.json(
        { error: `the edit was applied but could not be saved: ${writeError.message}` },
        { status: 500 },
      );
    }

    console.log(`[landing-page/edit] ${describeEditPlan(parsed.plan)} page=${loaded.page.id} ${describeEdit(proof)}`);

    return NextResponse.json({
      ok: true,
      pageId: loaded.page.id,
      plan: parsed.plan.kind,
      proof,
      removedSections: strip.removed,
      creditsSpent: 0,
      detail: describeEdit(proof),
      note: strip.removed.length
        ? `also removed ${strip.removed.length} section(s) this industry should not have: ${strip.removed.join(', ')}`
        : undefined,
    });
  } catch (error: any) {
    console.error('[landing-page/edit] POST failed:', error?.message || error);
    return NextResponse.json({ error: 'Could not apply the edit', detail: String(error?.message ?? error) }, { status: 500 });
  }
}

/** A page is edited here, not rewritten wholesale; the model path is `generate`. */
function refuse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'Only GET and POST are supported. Use POST with { section, html } or { find, replace }. ' +
        'A whole-page rewrite belongs to /api/landing-page/generate.',
    },
    { status: 405, headers: { Allow: 'GET, POST' } },
  );
}

export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
