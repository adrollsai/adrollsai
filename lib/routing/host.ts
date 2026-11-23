/**
 * Which host is this, and what should it serve?
 *
 * WHY THIS IS A MODULE AND NOT FIVE LINES IN middleware.ts
 * It used to be five lines in middleware, and it broke the product in production.
 *
 * The app domain was recognised by reading `profiles.whitelabel_domain` with the REQUEST'S cookies.
 * That read is subject to row-level security, which correctly hides other tenants' profiles from a
 * signed-in user — so for any logged-in visitor the lookup came back empty, the domain was classified
 * as a customer's custom domain, and every /dashboard page was rewritten into the shared-storefront
 * routes, which do not exist there. Logged-out visitors were fine (anon can read the whitelabel rows),
 * which is why the login page kept working and hid the fault: you could sign in, and then everything
 * 404'd.
 *
 * Two lessons are encoded here:
 *   1. Hosts that must serve the app shell are configuration, not data. They must never depend on a
 *      database read that RLS can legitimately hide.
 *   2. The storefront rewrite must never capture an app path. Even given a misconfigured or
 *      newly-added domain, /dashboard and /login stay the app.
 *
 * OUR DOMAINS VS A CLIENT'S WHITELABEL DOMAIN — they are not the same thing
 * This file used to call pipixel.io "the platform's own domain". It is not: `app.pipixel.io` is the
 * whitelabel domain of a client account (role `agency`, set in profiles.whitelabel_domain). Treating a
 * customer's domain as ours leaked into test defaults, deploy aliases and documentation, and it would
 * have been very easy to send a customer-facing link to the wrong brand. So the two lists are separate:
 *   - PLATFORM_DOMAINS  : ours. nobogent.com and adrolls.ai.
 *   - WHITELABEL_APP_DOMAINS : client domains we KNOW must serve the app shell, kept here for exactly
 *     the RLS reason above. A client domain may graduate out of this list once its lookup is reliable.
 *
 * PURE FUNCTIONS: no Next, no database, no request. The gate can therefore test the exact
 * decision that shipped, instead of trusting a comment about it.
 */

/** OUR domains. A subdomain of any of these is still us. */
export const DEFAULT_PLATFORM_DOMAINS = ['nobogent.com', 'adrolls.ai'] as const;

/**
 * Client whitelabel domains that must serve the app shell.
 *
 * `app.pipixel.io` belongs to a client (PiPixel), NOT to us. It is here because the whitelabel lookup
 * can be hidden from a signed-in user by RLS, and without it that client's dashboard 404s — the exact
 * production regression described above. Extend with NEXT_PUBLIC_WHITELABEL_APP_DOMAINS.
 */
export const DEFAULT_WHITELABEL_APP_DOMAINS = ['pipixel.io'] as const;

/** Hosts that are local development or the platform's own preview deployments. */
const PLATFORM_HOST_SUFFIXES = ['.vercel.app', '.ngrok-free.dev', '.localhost'] as const;
const PLATFORM_HOST_EXACT = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'] as const;

/**
 * Paths that belong to the application shell, never to a customer's marketing site.
 * A custom domain serves the storefront; it does not get to swallow the app.
 */
const APP_PATH_PREFIXES = [
  '/dashboard',
  '/login',
  '/signup',
  '/auth',
  // '/update-password' used to sit here as if it were a real page. It never was: it is the path the
  // login page sent password-reset emails to, which is why every reset link 404'd after the token had
  // already been spent. '/auth' above covers the real page (/auth/reset-password), and the auth
  // callback rewrites the legacy path onto it.
  '/onboarding',
  '/api',
  '/_next',
] as const;

/** Hostname without a port, lowercased. `App.Nobogent.com:443` -> `app.nobogent.com`. */
export function normaliseHost(rawHost: string | null | undefined): string {
  return String(rawHost ?? '')
    .split(':')[0]
    .trim()
    .toLowerCase();
}

/**
 * Is this host one of ours?
 *
 * `extra` lets a deployment add domains through NEXT_PUBLIC_PLATFORM_DOMAINS without a code
 * change; the defaults are always included so a missing env var cannot un-recognise the
 * product's own domain.
 */
/**
 * Does this host serve the app shell rather than a customer storefront?
 *
 * True for our own domains, for the client whitelabel domains we know about, and for local/preview
 * hosts. `extra` lets a deployment add domains through NEXT_PUBLIC_PLATFORM_DOMAINS without a code
 * change; the defaults are always included so a missing env var cannot un-recognise our own domain.
 */
export function isPlatformHost(rawHost: string | null | undefined, extra: readonly string[] = []): boolean {
  const hostname = normaliseHost(rawHost);
  if (!hostname) return false;

  if ((PLATFORM_HOST_EXACT as readonly string[]).includes(hostname)) return true;
  if (PLATFORM_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;

  const domains = [
    ...DEFAULT_PLATFORM_DOMAINS,
    ...DEFAULT_WHITELABEL_APP_DOMAINS,
    ...parseExtraDomains(process.env.NEXT_PUBLIC_WHITELABEL_APP_DOMAINS),
    ...extra,
  ]
    .map((domain) => normaliseHost(domain))
    .filter(Boolean);

  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * Is this one of OUR domains (not a client's whitelabel domain)?
 *
 * Use this wherever the answer ends up in something a person reads — a link in an email, a test
 * default, a document — so a customer's brand is never presented as ours.
 */
export function isOurOwnDomain(rawHost: string | null | undefined, extra: readonly string[] = []): boolean {
  const hostname = normaliseHost(rawHost);
  if (!hostname) return false;
  const domains = [...DEFAULT_PLATFORM_DOMAINS, ...extra].map((domain) => normaliseHost(domain)).filter(Boolean);
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** Read the deployment's extra domains from a comma-separated env value. */
export function parseExtraDomains(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Does this path belong to the app shell? */
export function isAppPath(pathname: string | null | undefined): boolean {
  const path = String(pathname ?? '/');
  return APP_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export interface RoutingDecision {
  /** Render the app as normal. */
  kind: 'app';
}

export interface StorefrontDecision {
  kind: 'storefront';
  rewriteTo: string;
}

/**
 * The single decision middleware needs.
 *
 * `isWhitelabelPlatform` is the result of the database lookup and may be false for reasons
 * that have nothing to do with the domain being the platform's (see the file header). It is
 * therefore only ever used to ADD a tenant domain, never to remove a platform one.
 */
export function decideRouting(input: {
  host: string | null | undefined;
  pathname: string | null | undefined;
  isWhitelabelPlatform?: boolean;
  extraDomains?: readonly string[];
}): RoutingDecision | StorefrontDecision {
  const hostname = normaliseHost(input.host);
  const pathname = String(input.pathname ?? '/');

  if (isPlatformHost(hostname, input.extraDomains ?? [])) return { kind: 'app' };
  if (input.isWhitelabelPlatform === true) return { kind: 'app' };
  if (isAppPath(pathname)) return { kind: 'app' };

  const subpath = pathname === '/' || pathname === '' ? '/index' : pathname;
  return { kind: 'storefront', rewriteTo: `/shared/${hostname}${subpath}` };
}
