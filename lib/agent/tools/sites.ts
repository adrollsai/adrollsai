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
      .select('custom_domain, whitelabel_domain, domain_verify_status, whitelabel_verify_status, business_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(`Could not read profile: ${error.message}`);
    return data;
  }

  /**
   * Does this domain actually serve OUR pages, or is it just a value in a column?
   *
   * `domain_verify_status` is a claim, not a fact, and it goes stale: Procolor's row says
   * "verified" while www.procolorfilmacademy.com is answered by Cloudflare and 301s to an apex
   * running WordPress, so every page URL the agent handed the owner 404'd — and the same page on
   * the platform host returned 200. Ten other accounts (bioqueestatesinternational.com,
   * app.theproestate.in, app.realtynationmohali.com, …) all answer `server: Vercel`, which is the
   * signal that separates "attached" from "configured once, moved later".
   *
   * Fails OPEN on uncertainty on purpose: a timeout or a network blip must not downgrade a domain
   * that is fine. It only reports `servesNobogent: false` on positive evidence that the host is
   * somebody else's — a non-Vercel server header, or a redirect away from the domain.
   */
  async function probeDomain(domain: string): Promise<{
    checked: boolean;
    reachable: boolean;
    server: string | null;
    servesNobogent: boolean | null;
    detail: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`https://${domain}/`, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'nobogent-domain-check' },
      });
      const server = res.headers.get('server');
      const location = res.headers.get('location');

      // A redirect to a DIFFERENT host means this domain is not serving the page itself.
      if (res.status >= 300 && res.status < 400 && location) {
        let target = '';
        try {
          target = new URL(location, `https://${domain}/`).host;
        } catch {
          target = '';
        }
        const normalise = (h: string) => h.replace(/^www\./, '').toLowerCase();
        if (target && normalise(target) !== normalise(domain)) {
          return {
            checked: true,
            reachable: true,
            server,
            servesNobogent: false,
            detail: `redirects to ${target}, which is a different host`,
          };
        }
      }

      const isVercel = /vercel/i.test(String(server ?? ''));
      return {
        checked: true,
        reachable: true,
        server,
        // Vercel is the whole signal: every genuinely attached tenant domain answers with it.
        servesNobogent: isVercel,
        detail: isVercel
          ? 'served by Vercel, like every attached tenant domain'
          : `answered by ${server || 'an unknown server'}, not Vercel`,
      };
    } catch (error: any) {
      return {
        checked: false,
        reachable: false,
        server: null,
        servesNobogent: null,
        detail: `could not be checked (${String(error?.message ?? error).slice(0, 80)}) — not treated as broken`,
      };
    } finally {
      clearTimeout(timer);
    }
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

  /**
   * Does the page we just wrote actually answer?
   *
   * "Landing page created and live at <url>" was a prediction, not an observation: the row was
   * written and the URL was composed, and nothing fetched it. With a custom domain that pointed
   * somewhere else, that sentence was simply false. A publish that cannot be confirmed now says so,
   * and the agent is told not to call it live.
   */
  async function probePage(url: string): Promise<{ ok: boolean; status: number | null; detail: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'nobogent-page-check' },
      });
      return {
        ok: res.ok,
        status: res.status,
        detail: res.ok ? 'answered 200' : `answered ${res.status}`,
      };
    } catch (error: any) {
      return {
        ok: false,
        status: null,
        detail: `could not be reached (${String(error?.message ?? error).slice(0, 70)})`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    site_domain_status: tool({
      description:
        'Read-only. Reports where landing pages are served for this business, plus the exact public URL pattern. It CHECKS the configured domain instead of trusting it: a custom domain can be set on the account while the DNS points somewhere else, and then every page URL 404s. When domainCheck.servesNobogent is false, give the owner guaranteedUrlPattern (the platform host, which always works) and say plainly that their custom domain is not currently serving these pages. You cannot attach or change domains — the user does that in dashboard Settings.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const base = await resolveBase();
          const { count } = await supabase
            .from('landing_pages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

          // The configured domain is a claim. Check whether it actually answers for us BEFORE
          // telling the owner to click it — a 404 in a chat message is worse than no URL.
          const probe = base.customDomain ? await probeDomain(base.customDomain) : null;
          const servesNobogent = probe ? probe.servesNobogent !== false : false;
          const workingBase = servesNobogent ? base.baseUrl : appBaseUrl();

          return {
            success: true,
            publicHost: workingBase,
            customDomain: base.customDomain,
            onCustomDomain: servesNobogent && Boolean(base.customDomain),
            urlPattern: `${workingBase}/shared/${userId}/<slug>`,
            guaranteedUrlPattern: `${appBaseUrl()}/shared/${userId}/<slug>`,
            domainCheck: probe
              ? {
                  configured: true,
                  checked: probe.checked,
                  reachable: probe.reachable,
                  server: probe.server,
                  servesNobogent: probe.servesNobogent,
                  detail: probe.detail,
                }
              : null,
            pageCount: count ?? 0,
            note: !base.customDomain
              ? 'No domain attached to this account yet, so pages are served on the shared host. If the user wants their own domain, tell them to attach it in dashboard Settings — do not attempt it yourself.'
              : servesNobogent
                ? "Pages are served on the customer's own domain."
                : `The account has ${base.customDomain} configured, but it ${probe?.detail ?? 'was not confirmed'}. ` +
                  'Give the owner the guaranteed URL on the platform host and say plainly that the custom domain is ' +
                  'not currently serving these pages, so they can fix the DNS in dashboard Settings. Do NOT present ' +
                  'the custom-domain URL as working.',
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

          // Advertise a host that actually serves us. A configured but misplaced custom domain
          // would otherwise be printed into the URL the owner is told to click.
          const hostProbe = base.customDomain ? await probeDomain(base.customDomain) : null;
          const useCustom = Boolean(base.customDomain) && hostProbe?.servesNobogent !== false;
          const workingBase = useCustom ? base.baseUrl : appBaseUrl();
          const url = `${workingBase}/shared/${userId}/${cleanSlug}`;

          // And then check the page itself. "Live" is a claim we can test.
          const reach = await probePage(url);

          return {
            success: true,
            action: existing ? 'updated' : 'created',
            pageId,
            slug: cleanSlug,
            url,
            publicHost: workingBase,
            onCustomDomain: useCustom,
            verified: reach.ok,
            verification: { status: reach.status, detail: reach.detail },
            message: reach.ok
              ? existing
                ? `Landing page "${cleanSlug}" updated and live at ${url} — fetched it, it answered 200.`
                : `Landing page "${cleanSlug}" created and live at ${url} — fetched it, it answered 200.`
              : `Landing page "${cleanSlug}" was SAVED, but ${url} ${reach.detail}. Do not tell the owner it is ` +
                'live: say it is saved, give them this URL to check, and if it does not load, point them at ' +
                'dashboard Settings.',
            ...(useCustom
              ? {}
              : base.customDomain
                ? {
                    note: `This account has ${base.customDomain} configured but it is not serving these pages ` +
                      `(${hostProbe?.detail ?? 'unconfirmed'}), so the URL above is on the platform host. Tell the ` +
                      'owner their custom domain is not currently serving pages.',
                  }
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
