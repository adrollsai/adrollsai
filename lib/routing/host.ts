/**
 * Which host is this, and what should it serve?
 *
 * WHY THIS IS A MODULE AND NOT FIVE LINES IN middleware.ts
 * It used to be five lines in middleware, and it broke the product in production.
 *
 * The platform's own domain (app.pipixel.io) was recognised by reading
 * `profiles.whitelabel_domain` with the REQUEST'S cookies. That read is subject to row-level
 * security, which correctly hides other tenants' profiles from a signed-in user — so for any
 * logged-in visitor the lookup came back empty, the domain was classified as a customer's
 * custom domain, and every /dashboard page was rewritten into the shared-storefront routes,
 * which do not exist there. Logged-out visitors were fine (anon can read the whitelabel rows),
 * which is why the login page kept working and hid the fault: you could sign in, and then
 * everything 404'd.
 *
 * Two lessons are encoded here:
 *   1. The platform's OWN domains are configuration, not data. They must never depend on a
 *      database read that RLS can legitimately hide.
 *   2. The storefront rewrite must never capture an app path. Even given a misconfigured or
 *      newly-added domain, /dashboard and /login stay the app.
 *
 * PURE FUNCTIONS: no Next, no database, no request. The gate can therefore test the exact
 * decision that shipped, instead of trusting a comment about it.
 */

/** Domains this platform serves itself. A subdomain of any of these is still the platform. */
export const DEFAULT_PLATFORM_DOMAINS = ['pipixel.io', 'nobogent.com', 'adrolls.ai'] as const;

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

/** Hostname without a port, lowercased. `App.PiPixel.io:443` -> `app.pipixel.io`. */
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
export function isPlatformHost(rawHost: string | null | undefined, extra: readonly string[] = []): boolean {
  const hostname = normaliseHost(rawHost);
  if (!hostname) return false;

  if ((PLATFORM_HOST_EXACT as readonly string[]).includes(hostname)) return true;
  if (PLATFORM_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;

  const domains = [...DEFAULT_PLATFORM_DOMAINS, ...extra]
    .map((domain) => normaliseHost(domain))
    .filter(Boolean);

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
