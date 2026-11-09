import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Landing pages.
 *
 * The agent writes the page (it is a code-writing agent, so hand-authoring the
 * HTML is the natural path); this module makes it LIVE and tells it the URL the
 * page is actually reachable at.
 *
 * DELIBERATE LIMIT: the agent must never attach, change or remove a domain.
 * Domain attachment is an ownership/billing action the user performs in
 * dashboard Settings. The agent only ever READS the domain already attached to
 * the account and slots the page's slug underneath it.
 *
 * Page storage is the same `landing_pages` table the dashboard editor uses, and
 * pages are served by `app/shared/[user_id]/[slug]`, so anything created here
 * opens in the normal editor and behaves like a page built in the UI.
 */
function appBaseUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://nobogent.com';
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createSiteTools(supabase: SupabaseClient, userId: string) {
  async function profile() {
    const { data, error } = await supabase
      .from('profiles')
      .select('custom_domain, whitelabel_domain, business_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(`Could not read profile: ${error.message}`);
    return data;
  }

  /**
   * Where this account's pages are publicly reachable: the domain the user has
   * already attached, else the shared host. Read-only by design.
   */
  async function resolveBase() {
    const p = await profile();
    const domain = (p?.whitelabel_domain || p?.custom_domain || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
    return {
      baseUrl: domain ? `https://${domain}` : appBaseUrl(),
      customDomain: domain || null,
      onCustomDomain: Boolean(domain),
    };
  }

  return {
    site_domain_status: tool({
      description:
        'Read-only. Reports which domain this business has already attached to the app and where landing pages are therefore served, plus the exact public URL pattern. Use it to tell the user where a page will live. You cannot attach or change domains — the user does that in dashboard Settings.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const base = await resolveBase();
          const { count } = await supabase
            .from('landing_pages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

          return {
            success: true,
            publicHost: base.baseUrl,
            customDomain: base.customDomain,
            onCustomDomain: base.onCustomDomain,
            urlPattern: `${base.baseUrl}/shared/${userId}/<slug>`,
            pageCount: count ?? 0,
            note: base.onCustomDomain
              ? "Pages are served on the customer's own domain."
              : 'No domain attached to this account yet, so pages are served on the shared host. If the user wants their own domain, tell them to attach it in dashboard Settings — do not attempt it yourself.',
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not read domain status' };
        }
      },
    }),

    site_list_landing_pages: tool({
      description:
        'Lists the landing pages this business already has, with slug, title, public URL and whether booking/forms/pixels are wired. Check this before creating a duplicate.',
      inputSchema: z.object({
        limit: z.number().default(20).describe('Max pages to return'),
      }),
      execute: async ({ limit }) => {
        try {
          const base = await resolveBase();
          const { data, error } = await supabase
            .from('landing_pages')
            .select('id, slug, title, product_name, property_id, form_id, pixel_id, booking_enabled, created_at, updated_at')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(Math.min(Math.max(limit || 20, 1), 100));

          if (error) throw new Error(error.message);

          return {
            success: true,
            count: data?.length || 0,
            publicHost: base.baseUrl,
            pages: (data || []).map((p: any) => ({
              ...p,
              url: `${base.baseUrl}/shared/${userId}/${p.slug}`,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not list landing pages' };
        }
      },
    }),

    site_publish_landing_page: tool({
      description:
        'Creates or updates a LIVE landing page for this account and returns its public URL under the domain already attached. You author the HTML yourself: a complete standalone document with inline <style>, real brand copy, and mobile-first responsive layout. Re-publishing the same slug updates the existing page in place. This is how the agent ships a landing page.',
      inputSchema: z.object({
        slug: z
          .string()
          .describe('URL slug, lowercase letters/numbers/hyphens (e.g. "joy-grand-launch"). This becomes /shared/<user>/<slug>'),
        title: z.string().describe('Page title shown in the browser tab and the dashboard list'),
        htmlContent: z
          .string()
          .describe(
            'The complete HTML document for the page. Include <!DOCTYPE html>, <head> with responsive meta viewport, inline CSS, and semantic sections. Use the business brand colours/logo. Keep it self-contained.'
          ),
        productName: z.string().optional().describe('Product, project or property name the page is about'),
        propertyId: z.string().optional().describe('Optional property id from inventory to link the page to'),
        formId: z.string().optional().describe('Optional qualification form id to capture leads'),
        pixelId: z.string().optional().describe('Optional Meta pixel id for conversion tracking'),
        bookingEnabled: z.boolean().optional().describe('Enable the booking widget on the page'),
      }),
      execute: async ({ slug, title, htmlContent, productName, propertyId, formId, pixelId, bookingEnabled }) => {
        const cleanSlug = String(slug || '').trim().toLowerCase().replace(/\s+/g, '-');
        if (!SLUG_RE.test(cleanSlug)) {
          return {
            success: false,
            error: 'slug must be lowercase letters, numbers and single hyphens (e.g. "joy-grand-launch").',
          };
        }
        if (!htmlContent || htmlContent.trim().length < 200) {
          return { success: false, error: 'htmlContent looks too short to be a real page.' };
        }

        try {
          const base = await resolveBase();

          const { data: existing } = await supabase
            .from('landing_pages')
            .select('id')
            .eq('user_id', userId)
            .eq('slug', cleanSlug)
            .maybeSingle();

          const payload: Record<string, any> = {
            user_id: userId,
            slug: cleanSlug,
            title,
            html_content: htmlContent,
            product_name: productName || title,
            updated_at: new Date().toISOString(),
            ...(propertyId ? { property_id: propertyId } : {}),
            ...(formId ? { form_id: formId } : {}),
            ...(pixelId ? { pixel_id: pixelId } : {}),
            ...(bookingEnabled !== undefined ? { booking_enabled: bookingEnabled } : {}),
          };

          let pageId = existing?.id as string | undefined;
          if (pageId) {
            const { error } = await supabase.from('landing_pages').update(payload).eq('id', pageId);
            if (error) throw new Error(error.message);
          } else {
            const { data, error } = await supabase
              .from('landing_pages')
              .insert({ ...payload, created_at: new Date().toISOString() })
              .select('id')
              .maybeSingle();
            if (error) throw new Error(error.message);
            pageId = data?.id;
          }

          const url = `${base.baseUrl}/shared/${userId}/${cleanSlug}`;
          return {
            success: true,
            action: existing ? 'updated' : 'created',
            pageId,
            slug: cleanSlug,
            url,
            publicHost: base.baseUrl,
            onCustomDomain: base.onCustomDomain,
            message: existing
              ? `Landing page "${cleanSlug}" updated and live at ${url}`
              : `Landing page "${cleanSlug}" created and live at ${url}`,
            ...(base.onCustomDomain
              ? {}
              : {
                  note: 'Served on the shared host because no domain is attached to this account. The user can attach their own domain in dashboard Settings.',
                }),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not publish landing page' };
        }
      },
    }),
  };
}
