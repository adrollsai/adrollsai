/**
 * The polite fetch: SSRF guard → robots → rate-limit wait → one honest request →
 * classify → retry ONLY on 429/5xx.
 *
 * This runs server-side, which is exactly why the guard exists: a caller-supplied
 * URL that resolves to `127.0.0.1`, `169.254.169.254` or a `file:` path turns a
 * scraper into a way to read the box it runs on. So the URL is validated TWICE —
 * before the first request and at every redirect hop — and a hostname is resolved
 * to its addresses and rejected if ANY of them is private, because a name that
 * points at both a public and a private address is not a public name.
 *
 * The refusals, and what each means:
 *
 *   robots     the host said no. No request is made. Not a warning, not a retry.
 *   ssrf       scheme/host is not something we fetch (file:, data:, private IP).
 *   login      200 that is really a sign-in page.
 *   captcha    200 that is really a challenge page.
 *   auth       401/403 — the host is refusing our unauthenticated request.
 *   redirect   a hop we refuse to follow (private address, scheme change).
 *
 * Login walls, CAPTCHA and 401/403 stop the run. There is no cookie jar, no
 * credential, no solver here — by construction, not by policy:
 * `ScrapePageResult.body` is `null` on every refusal, so there is nothing
 * downstream that could be tempted to parse a challenge page as content.
 *
 * Retries are bounded (`maxAttempts`, default 3) and only for 429 and 5xx.
 * `Retry-After` is honoured when present, otherwise the delay is exponential with
 * jitter, and both the delay and the reason are recorded in the result so the
 * agent can say what happened rather than "it failed".
 */

import {
  backoffDelayMs,
  HostRateLimiter,
  parseRetryAfter,
  type Sleeper,
} from './rate-limit';
import type { RobotsDecision, RobotsGate } from './robots';
import { DEFAULT_CONTACT_URL, DEFAULT_SCRAPE_USER_AGENT } from './robots';
import type { CachedResponse, ScrapeCache } from './cache';
import { cacheKeyFor, DEFAULT_CACHE_TTL_MS, readCache } from './cache';

// ────────────────────────────────────────────────────────────────────────────
// The SSRF guard
// ────────────────────────────────────────────────────────────────────────────

export type RefusalKind =
  | 'scheme'
  | 'credentials'
  | 'ssrf'
  | 'hostname'
  | 'robots'
  | 'login'
  | 'captcha'
  | 'auth'
  | 'redirect'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'content-type';

export class ScrapeRefusedError extends Error {
  readonly kind: RefusalKind;
  readonly url: string;
  readonly detail: string;

  constructor(args: { kind: RefusalKind; url: string; reason: string; detail?: string }) {
    super(args.reason);
    this.name = 'ScrapeRefusedError';
    this.kind = args.kind;
    this.url = args.url;
    this.detail = args.detail ?? args.reason;
  }
}

/** Resolve a hostname to every address it maps to. Injected so tests never use DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface GuardOptions {
  /** DNS. Pass `null` to skip resolution (an IP literal needs none). */
  resolve?: HostResolver | null;
}

const PRIVATE_NAME_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.home\.arpa$/i,
  /^metadata\./i,
  /^instance-data$/i,
  /^\[?::1?\]?$/,
];

/**
 * Is this IPv4 literal inside a range we must not fetch?
 *
 * Covers loopback, link-local (the cloud metadata address `169.254.169.254`
 * lives here), RFC1918, CGNAT, documentation, benchmarking, multicast and
 * reserved space. `0.0.0.0` matters too: on Linux it usually reaches the box.
 */
export function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Is this IPv6 literal loopback, link-local, unique-local, or a mapped private v4? */
export function isPrivateIPv6(address: string): boolean {
  const text = address.replace(/^\[/, '').replace(/\]$/, '').toLowerCase().split('%')[0];
  if (text === '::' || text === '::1') return true;
  if (text.startsWith('fc') || text.startsWith('fd')) return true; // fc00::/7
  if (/^fe[89ab]/.test(text)) return true; // fe80::/10 link-local
  if (text.startsWith('ff')) return true; // multicast
  if (text.startsWith('2001:db8')) return true; // documentation
  const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const mappedHex = text.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const v4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isPrivateIPv4(v4);
  }
  return false;
}

/** True when `host` is an IP literal (and it is private, or the literal is malformed). */
export function isPrivateAddress(address: string): boolean {
  const text = String(address ?? '').trim();
  if (!text) return true;
  if (text.includes(':')) return isPrivateIPv6(text);
  return isPrivateIPv4(text);
}

/**
 * Validate one URL for a server-side fetch. Throws `ScrapeRefusedError` — a
 * refusal, never a boolean the caller might ignore.
 *
 * Returns the parsed URL plus the addresses the guard accepted, so a caller can
 * see what was actually checked.
 */
export async function assertFetchableUrl(
  rawUrl: string,
  options: GuardOptions = {},
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new ScrapeRefusedError({
      kind: 'hostname',
      url: String(rawUrl),
      reason: `${String(rawUrl).slice(0, 120)} is not a valid URL`,
    });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScrapeRefusedError({
      kind: 'scheme',
      url: url.toString(),
      reason: `only http and https are fetched; ${url.protocol} is refused`,
    });
  }

  if (url.username || url.password) {
    throw new ScrapeRefusedError({
      kind: 'credentials',
      url: url.toString(),
      reason: 'the URL carries credentials; a scrape never authenticates',
    });
  }

  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!hostname) {
    throw new ScrapeRefusedError({ kind: 'hostname', url: url.toString(), reason: 'the URL has no host' });
  }

  const literal = hostname.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  if (literal) {
    if (isPrivateAddress(hostname)) {
      throw new ScrapeRefusedError({
        kind: 'ssrf',
        url: url.toString(),
        reason: `${hostname} is a private, loopback or link-local address; refused`,
      });
    }
    return { url, addresses: [hostname] };
  }

  for (const pattern of PRIVATE_NAME_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new ScrapeRefusedError({
        kind: 'ssrf',
        url: url.toString(),
        reason: `the host "${hostname}" is a local/internal name; refused`,
      });
    }
  }

  if (options.resolve === null) return { url, addresses: [] };

  const resolver = options.resolve ?? defaultResolve;
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch (err: any) {
    throw new ScrapeRefusedError({
      kind: 'ssrf',
      url: url.toString(),
      reason: `could not resolve "${hostname}" to an address (${err?.message ?? err}); refusing to fetch unverified`,
    });
  }

  if (!addresses.length) {
    throw new ScrapeRefusedError({
      kind: 'ssrf',
      url: url.toString(),
      reason: `"${hostname}" resolved to no address; refusing`,
    });
  }

  const bad = addresses.filter((address) => isPrivateAddress(address));
  if (bad.length) {
    throw new ScrapeRefusedError({
      kind: 'ssrf',
      url: url.toString(),
      reason: `"${hostname}" resolves to ${bad.join(', ')}, which is private or link-local; refused`,
      detail: `all addresses: ${addresses.join(', ')}`,
    });
  }

  return { url, addresses };
}

/** Real DNS, resolved to every answer (a name may map to several addresses). */
const defaultResolve: HostResolver = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

// ────────────────────────────────────────────────────────────────────────────
// Body classification: a 200 that is really a wall
// ────────────────────────────────────────────────────────────────────────────

export interface BodyVerdict {
  login: boolean;
  captcha: boolean;
  reason: string | null;
}

/**
 * Read a 200 body for the two walls that do not announce themselves in a status.
 *
 * The login detector deliberately keys on a PASSWORD FIELD, not on the words
 * "sign in": nearly every public page has a sign-in link in its header, and a
 * detector that refuses those would refuse the whole web. A password input on
 * the page we asked for means the page we asked for is not the page we wanted.
 */
export function classifyBody(body: string): BodyVerdict {
  const text = String(body ?? '');

  const captchaPatterns: RegExp[] = [
    /\/recaptcha\/api2?\//i,
    /class=["'][^"']*\bg-recaptcha\b/i,
    /\bh-captcha\b|\bhcaptcha\b/i,
    /\bcf-turnstile\b|\bchallenges\.cloudflare\.com\b/i,
    /\/cdn-cgi\/challenge-platform\//i,
    /<title>\s*just a moment\.\.\.\s*<\/title>/i,
    /checking (if the site connection is secure|your browser)/i,
    /verify you are (a )?human|are you a robot|complete the security check/i,
  ];
  for (const pattern of captchaPatterns) {
    if (pattern.test(text)) {
      return { login: false, captcha: true, reason: 'the response is a CAPTCHA / bot-challenge page' };
    }
  }

  const loginPatterns: RegExp[] = [
    /<input[^>]+type\s*=\s*["']?password/i,
    /<input[^>]+name\s*=\s*["']password["']/i,
    /please (log|sign) ?in to (continue|view|access)/i,
    /you must be (logged|signed) in/i,
    /(sign|log) ?in to continue/i,
    /authentication required/i,
  ];
  for (const pattern of loginPatterns) {
    if (pattern.test(text)) {
      return { login: true, captcha: false, reason: 'the response is a sign-in page, not the content' };
    }
  }

  return { login: false, captcha: false, reason: null };
}

// ────────────────────────────────────────────────────────────────────────────
// The fetch seam
// ────────────────────────────────────────────────────────────────────────────

export interface ScrapeFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type ScrapeFetch = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    redirect?: 'manual' | 'follow';
    signal?: AbortSignal;
  },
) => Promise<ScrapeFetchResponse>;

export type ScrapeClassification =
  | 'ok'
  | 'refused'
  | 'rate_limited'
  | 'server_error'
  | 'client_error'
  | 'network_error';

export interface ScrapePageResult {
  requestedUrl: string;
  /** The URL the body actually came from (after redirects). */
  finalUrl: string;
  host: string;
  ok: boolean;
  classification: ScrapeClassification;
  status: number | null;
  refusal: { kind: RefusalKind; reason: string; detail?: string } | null;
  body: string | null;
  contentType: string | null;
  bytes: number;
  truncated: boolean;
  cached: boolean;
  cacheKey: string | null;
  attempts: number;
  /** One entry per retry: what the delay was and why. */
  delays: { attempt: number; delayMs: number; reason: 'retry-after' | 'backoff'; status: number | null }[];
  /** Total time spent waiting for a turn on the host (rate limit + cooldown). */
  waitedMs: number;
  robots: RobotsDecision | null;
  fetchedAt: number;
  notes: string[];
  /** `Retry-After` as the server sent it, when it sent one (429/503). */
  retryAfterHeader?: string | null;
}

export interface ScrapeRequest {
  url: string;
  /** Fingerprint of the definition asking for it: part of the cache key. */
  definitionVersion?: string;
  /** The definition name, for the report only. */
  definition?: string;
  accept?: string;
  /** Per-request cache TTL; 0 disables the cache for this URL. */
  cacheTtlMs?: number;
  /** Skip the cache read (still writes). */
  fresh?: boolean;
}

export interface ScrapeMeterEvent {
  service: 'other';
  detail: string;
  units: number;
  unit: string;
  host: string;
  status: number | null;
  cached: boolean;
}

export interface ScrapeFetchDeps {
  fetch: ScrapeFetch;
  robots: RobotsGate;
  limiter: HostRateLimiter;
  cache?: ScrapeCache;
  /** Honest UA: product + contact URL. Never a browser impersonation. */
  userAgent?: string;
  contactUrl?: string;
  contactEmail?: string;
  resolveHost?: HostResolver | null;
  now?: () => number;
  sleep?: Sleeper;
  random?: () => number;
  /** Total requests per URL, including the first. */
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  meter?: (event: ScrapeMeterEvent) => void | Promise<void>;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 3_000_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_REDIRECTS = 5;

/** The honest User-Agent: what we are, and where to complain. */
export function scrapeUserAgent(options: { product?: string; contactUrl?: string } = {}): string {
  const product = options.product ?? 'NobogentScraper/1.0';
  const contact = options.contactUrl ?? DEFAULT_CONTACT_URL;
  return `${product} (+${contact})`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Guard options from the deps, preserving the THREE states of `resolveHost`:
 * undefined (real DNS), a function (an injected resolver), and `null` (skip
 * resolution — only an IP literal or a test can be safe without it).
 */
function guardOptions(deps: ScrapeFetchDeps): GuardOptions {
  if (deps.resolveHost === null) return { resolve: null };
  if (typeof deps.resolveHost === 'function') return { resolve: deps.resolveHost };
  return {};
}

function emptyResult(url: string, now: number): ScrapePageResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    host: hostOf(url),
    ok: false,
    classification: 'refused',
    status: null,
    refusal: null,
    body: null,
    contentType: null,
    bytes: 0,
    truncated: false,
    cached: false,
    cacheKey: null,
    attempts: 0,
    delays: [],
    waitedMs: 0,
    robots: null,
    fetchedAt: now,
    notes: [],
  };
}

/**
 * Fetch one URL politely. Always resolves: a refusal, a 429 that outlived its
 * retries and a network error are RESULTS, because a scrape that stops must be
 * able to say why.
 */
export async function politeFetch(request: ScrapeRequest, deps: ScrapeFetchDeps): Promise<ScrapePageResult> {
  if (typeof deps?.fetch !== 'function') throw new Error('[scrape] politeFetch needs a fetch function');
  if (!deps.robots) throw new Error('[scrape] politeFetch needs a robots gate — a fetch without one is not polite');
  if (!deps.limiter) throw new Error('[scrape] politeFetch needs a rate limiter');

  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(1, deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const maxRedirects = Math.max(0, deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
  const maxBytes = Math.max(1_000, deps.maxBytes ?? DEFAULT_MAX_BYTES);
  const userAgent = deps.userAgent ?? DEFAULT_SCRAPE_USER_AGENT;
  const cacheTtlMs = request.cacheTtlMs !== undefined ? request.cacheTtlMs : deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const log = deps.log ?? (() => {});

  const result = emptyResult(request.url, now());
  const cacheKey =
    deps.cache && cacheTtlMs > 0
      ? cacheKeyFor(request.url, request.definitionVersion ?? 'unversioned')
      : null;
  result.cacheKey = cacheKey;

  // 1. Is this even a URL we are allowed to reach? Checked before anything else.
  try {
    await assertFetchableUrl(request.url, guardOptions(deps));
  } catch (err: any) {
    if (err instanceof ScrapeRefusedError) {
      result.refusal = { kind: err.kind, reason: err.message, detail: err.detail };
      result.notes.push('refused before any request was made');
      log('scrape.refused', { url: request.url, kind: err.kind, reason: err.message });
      return result;
    }
    throw err;
  }

  // 2. The cache: inside the window the same page is not fetched again at all.
  if (cacheKey && deps.cache && !request.fresh) {
    const cached = await readCache(deps.cache, cacheKey, now());
    if (cached.entry && !cached.stale) {
      const entry = cached.entry;
      result.ok = true;
      result.classification = 'ok';
      result.status = entry.status;
      result.finalUrl = entry.url;
      result.body = entry.body;
      result.contentType = entry.contentType;
      result.bytes = Buffer.byteLength(entry.body, 'utf8');
      result.cached = true;
      result.fetchedAt = entry.fetchedAt;
      result.notes.push(`served from cache (key ${cacheKey})`);
      log('scrape.cache.hit', { url: request.url, key: cacheKey, fetchedAt: entry.fetchedAt });
      return result;
    }
    if (cached.stale) result.notes.push('cache entry was stale; re-fetching');
    if (cached.corrupt) result.notes.push('cache entry was unreadable; re-fetching');
  }

  // 3. robots.txt. A denial here returns with ZERO requests made to the page.
  const robotsDecision = await deps.robots.check(request.url, userAgent);
  result.robots = robotsDecision;
  if (!robotsDecision.allowed) {
    result.refusal = { kind: 'robots', reason: robotsDecision.reason, detail: robotsDecision.robotsUrl };
    result.notes.push('robots.txt refused this URL; no request was made');
    log('scrape.refused', { url: request.url, kind: 'robots', reason: robotsDecision.reason });
    return result;
  }

  const crawlDelayMs = robotsDecision.crawlDelayMs;
  const delays: ScrapePageResult['delays'] = [];
  const notes: string[] = [...result.notes];
  let totalWaited = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await performWithRedirects(request.url, {
      deps,
      userAgent,
      maxRedirects,
      maxBytes,
      crawlDelayMs,
      startedAt: now(),
      accept: request.accept,
    });
    totalWaited += outcome.waitedMs;
    notes.push(...outcome.notes);

    const merged: ScrapePageResult = {
      ...outcome,
      requestedUrl: request.url,
      attempts: attempt,
      robots: robotsDecision,
      delays,
      notes: [...notes],
      waitedMs: totalWaited,
      // The per-hop result is built from scratch, so the cache key has to be
      // carried onto it deliberately or a caller cannot audit what it keyed on.
      cacheKey,
    };

    if (outcome.classification === 'ok') {
      return finishOk(merged, { request, deps, cacheKey, cacheTtlMs, now, log });
    }

    // A refusal, or an ordinary 4xx, is final. No retry, no workaround.
    if (outcome.classification === 'refused' || outcome.classification === 'client_error') {
      merged.body = null;
      return merged;
    }

    // 429 and 5xx are the only retryable outcomes, and only while attempts remain.
    if (attempt >= maxAttempts) {
      merged.body = null;
      merged.notes = [...notes, `gave up after ${attempt} attempt(s): ${outcome.classification}`];
      return merged;
    }

    const retryAfterMs = parseRetryAfter(outcome.retryAfterHeader ?? null, now());
    let delayMs: number;
    let reason: 'retry-after' | 'backoff';
    if (retryAfterMs !== null) {
      delayMs = retryAfterMs;
      reason = 'retry-after';
      log('scrape.retry_after', {
        url: request.url,
        status: outcome.status,
        delayMs,
        header: outcome.retryAfterHeader,
      });
    } else {
      const backoff = backoffDelayMs(attempt, {
        baseMs: deps.backoffBaseMs ?? 500,
        capMs: deps.backoffCapMs ?? 8_000,
        random: deps.random ?? Math.random,
      });
      delayMs = backoff.delayMs;
      reason = 'backoff';
      log('scrape.backoff', {
        url: request.url,
        status: outcome.status,
        attempt,
        delayMs,
        exponentialMs: backoff.exponentialMs,
        jitterMs: backoff.jitterMs,
      });
    }

    delays.push({ attempt, delayMs, reason, status: outcome.status });
    notes.push(
      `attempt ${attempt}/${maxAttempts} hit HTTP ${outcome.status ?? '—'}; waiting ${delayMs} ms (${reason})`,
    );
    // Park the host for every caller, not just this one.
    if (outcome.status === 429) deps.limiter.noteRetryAfter(merged.host, delayMs, '429');
    await sleep(delayMs);
  }

  throw new Error(
    `[scrape] ${request.url}: retry loop finished without a result — this is a bug in the attempt accounting`,
  );
}

interface HopOptions {
  deps: ScrapeFetchDeps;
  userAgent: string;
  maxRedirects: number;
  maxBytes: number;
  crawlDelayMs: number | null;
  startedAt: number;
  accept?: string;
}

async function performWithRedirects(url: string, options: HopOptions): Promise<ScrapePageResult> {
  const { deps, userAgent, maxRedirects, maxBytes, crawlDelayMs } = options;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? (() => {});
  const result = emptyResult(url, options.startedAt);
  let currentUrl = url;
  let hops = 0;
  let retryAfterHeader: string | null = null;

  while (true) {
    // Every hop is validated, not just the first: a public URL redirecting to
    // 127.0.0.1 is the classic SSRF, and it is a redirect.
    if (hops > 0) {
      try {
        await assertFetchableUrl(currentUrl, guardOptions(deps));
      } catch (err: any) {
        if (err instanceof ScrapeRefusedError) {
          result.classification = 'refused';
          result.refusal = { kind: 'redirect', reason: err.message, detail: `via ${url}` };
          result.finalUrl = currentUrl;
          result.notes.push('refused to follow a redirect');
          log('scrape.redirect_refused', { from: url, to: currentUrl, reason: err.message });
          return result;
        }
        throw err;
      }

      const hopRobots = await deps.robots.check(currentUrl, userAgent);
      result.robots = hopRobots;
      if (!hopRobots.allowed) {
        result.classification = 'refused';
        result.refusal = { kind: 'robots', reason: `redirect target: ${hopRobots.reason}`, detail: hopRobots.robotsUrl };
        result.finalUrl = currentUrl;
        result.notes.push('redirect target is disallowed by robots.txt');
        return result;
      }
    }

    const host = hostOf(currentUrl);
    let response: ScrapeFetchResponse;
    let wait = { waitedMs: 0 };
    try {
      const run = await deps.limiter.run(
        host,
        () => requestOnce(currentUrl, { deps, userAgent, ...(options.accept ? { accept: options.accept } : {}) }),
        { crawlDelayMs: result.robots?.crawlDelayMs ?? crawlDelayMs },
      );
      response = run.result;
      wait = { waitedMs: run.waitedMs };
      if (run.waitedMs > 0) {
        log('scrape.rate_limit.wait', { host, waitedMs: run.waitedMs, reason: run.reason });
        result.notes.push(`waited ${run.waitedMs} ms for a turn on ${host} (${run.reason})`);
      }
    } catch (err: any) {
      result.classification = 'network_error';
      result.status = null;
      result.refusal = { kind: 'hostname', reason: `request failed: ${err?.message ?? String(err)}` };
      result.finalUrl = currentUrl;
      result.notes.push('the request itself failed');
      return result;
    }
    result.waitedMs += wait.waitedMs;

    const status = response.status;
    result.status = status;
    result.finalUrl = currentUrl;

    // Redirects: followed by hand so each one can be checked.
    if (status >= 300 && status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        result.classification = 'client_error';
        result.refusal = { kind: 'redirect', reason: `HTTP ${status} with no Location header` };
        return result;
      }
      if (hops >= maxRedirects) {
        result.classification = 'refused';
        result.refusal = {
          kind: 'redirect',
          reason: `more than ${maxRedirects} redirects; refusing to follow further`,
        };
        result.notes.push(`hop chain: ${url} → ${currentUrl}`);
        return result;
      }
      let next: string;
      try {
        next = new URL(location, currentUrl).toString();
      } catch {
        result.classification = 'client_error';
        result.refusal = { kind: 'redirect', reason: `unparseable Location "${location}"` };
        return result;
      }
      log('scrape.redirect', { from: currentUrl, to: next, status });
      result.notes.push(`redirect ${status} → ${next}`);
      currentUrl = next;
      hops++;
      continue;
    }

    if (status === 401 || status === 403) {
      result.classification = 'refused';
      result.refusal = {
        kind: 'auth',
        reason: `HTTP ${status} — the host refuses an unauthenticated request; not attempting a workaround`,
      };
      return result;
    }

    if (status === 429) {
      retryAfterHeader = response.headers.get('retry-after');
      result.classification = 'rate_limited';
      result.refusal = {
        kind: 'rate_limited',
        reason: `HTTP 429${retryAfterHeader ? ` (Retry-After: ${retryAfterHeader})` : ''} from ${host}`,
      };
      // Attach the header so the caller can honour it rather than guess.
      result.retryAfterHeader = retryAfterHeader;
      return result;
    }

    if (status >= 500) {
      retryAfterHeader = response.headers.get('retry-after');
      result.classification = 'server_error';
      result.refusal = { kind: 'server_error', reason: `HTTP ${status} from ${host}` };
      result.retryAfterHeader = retryAfterHeader;
      return result;
    }

    if (status < 200 || status >= 300) {
      result.classification = 'client_error';
      result.refusal = { kind: 'content-type', reason: `HTTP ${status} — not retried` };
      return result;
    }

    // 2xx: read the body, cap it, and check it is not a wall dressed as content.
    let body = await response.text();
    let truncated = false;
    if (body.length > maxBytes) {
      body = body.slice(0, maxBytes);
      truncated = true;
      result.notes.push(`body truncated at ${maxBytes} characters`);
    }
    const verdict = classifyBody(body);
    if (verdict.login) {
      result.classification = 'refused';
      result.refusal = { kind: 'login', reason: verdict.reason ?? 'sign-in page', detail: currentUrl };
      result.body = null;
      log('scrape.refused', { url: currentUrl, kind: 'login' });
      return result;
    }
    if (verdict.captcha) {
      result.classification = 'refused';
      result.refusal = { kind: 'captcha', reason: verdict.reason ?? 'challenge page', detail: currentUrl };
      result.body = null;
      log('scrape.refused', { url: currentUrl, kind: 'captcha' });
      return result;
    }

    result.classification = 'ok';
    result.ok = true;
    result.status = status;
    result.body = body;
    result.contentType = response.headers.get('content-type');
    result.bytes = Buffer.byteLength(body, 'utf8');
    result.truncated = truncated;
    result.refusal = null;
    if (retryAfterHeader) result.retryAfterHeader = retryAfterHeader;
    return result;
  }
}

async function requestOnce(
  url: string,
  options: { deps: ScrapeFetchDeps; userAgent: string; accept?: string },
): Promise<ScrapeFetchResponse> {
  const { deps, userAgent, accept } = options;
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    Accept:
      accept ??
      'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    'Accept-Language': 'en;q=0.9',
    // We ask; we do not pretend to be a browser.
    'Cache-Control': 'no-cache',
  };
  if (deps.contactEmail) headers.From = deps.contactEmail;

  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await deps.fetch(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function finishOk(
  outcome: ScrapePageResult,
  args: {
    request: ScrapeRequest;
    deps: ScrapeFetchDeps;
    cacheKey: string | null;
    cacheTtlMs: number;
    now: () => number;
    log: (event: string, data?: Record<string, unknown>) => void;
  },
): Promise<ScrapePageResult> {
  const { request, deps, cacheKey, cacheTtlMs, now, log } = args;
  const finished: ScrapePageResult = { ...outcome, cached: false, ok: true, classification: 'ok' };

  if (cacheKey && deps.cache && cacheTtlMs > 0 && finished.body !== null) {
    const entry: CachedResponse = {
      url: finished.finalUrl,
      definitionVersion: request.definitionVersion ?? 'unversioned',
      status: finished.status ?? 200,
      contentType: finished.contentType,
      body: finished.body,
      key: cacheKey,
      fetchedAt: finalNow(now),
      expiresAt: finalNow(now) + cacheTtlMs,
    };
    try {
      await deps.cache.put(cacheKey, entry);
      log('scrape.cache.put', { url: request.url, key: cacheKey, bytes: finished.bytes });
    } catch (err: any) {
      finished.notes.push(`cache write failed: ${err?.message ?? String(err)}`);
    }
  }

  if (deps.meter) {
    try {
      await deps.meter({
        service: 'other',
        detail: `${request.definition ?? 'scrape'}: ${finished.finalUrl} → HTTP ${finished.status}`,
        units: 1,
        unit: 'page',
        host: finished.host,
        status: finished.status,
        cached: false,
      });
    } catch {
      /* metering must never break the scrape */
    }
  }

  return finished;
}

function finalNow(now: () => number): number {
  const value = now();
  return Number.isFinite(value) ? value : Date.now();
}

/**
 * The default fetch: real `fetch`, honest UA, manual redirects.
 *
 * `redirect: 'manual'` is not an optimisation: it is what lets
 * `performWithRedirects` inspect every hop before any of them is requested.
 */
export function createScrapeFetch(timeoutMs = DEFAULT_TIMEOUT_MS): ScrapeFetch {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        redirect: init.redirect ?? 'manual',
        signal: controller.signal,
      });
      return {
        status: response.status,
        headers: { get: (name: string) => response.headers.get(name) },
        text: () => response.text(),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
