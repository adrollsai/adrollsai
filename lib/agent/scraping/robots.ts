/**
 * `robots.txt`: fetch it, parse it, cache the parse, and answer `isAllowed`.
 *
 * A refusal here is a HARD refusal. `RobotsGate.check()` returning
 * `{ allowed: false }` is the only thing the caller needs to know: the polite
 * fetcher turns it into a result with no request made at all, never a warning
 * that proceeds anyway.
 *
 * WHAT THIS FILE OWNS (and what it deliberately does not)
 *  - The wire format: `User-agent` / `Allow` / `Disallow` / `Crawl-delay` /
 *    `Sitemap`, comments, blank-line separated groups, `*` and `$` wildcards.
 *  - Rule precedence, per RFC 9309 and Google's published behaviour: the
 *    LONGEST matching pattern wins, and on an equal match `Allow` beats
 *    `Disallow`. With no matching rule the path is allowed.
 *  - Which group applies: the token in our own User-Agent that matches a
 *    `User-agent:` line (e.g. `NobogentScraper`), and `*` when we have none —
 *    never another vendor's token.
 *  - A per-host in-memory cache with a TTL, so a hundred-row scrape per host
 *    reads `robots.txt` once, not a hundred times.
 *
 * Nothing here fetches a page. `fetchRobots` is injected, so the parser and the
 * gate are testable without a network, and one code path serves both tests and
 * production.
 *
 * Unavailable robots (5xx, connection refused, timeout) is treated as
 * "disallow everything" rather than "allow everything": RFC 9309 says an
 * unreachable robots.txt means the crawler should assume complete disallow, and
 * that is also the only reading consistent with "a refusal is a refusal". A
 * 404/410 means the host has published nothing to obey, so it is allowed.
 */

/** The product-identifying User-Agent. A scraper that hides is not a polite one. */
export const DEFAULT_CONTACT_URL = 'https://nobogent.com/scraping-policy';
export const DEFAULT_SCRAPE_USER_AGENT = `NobogentScraper/1.0 (+${DEFAULT_CONTACT_URL})`;

/** How long a parsed `robots.txt` may be reused for a host. */
export const DEFAULT_ROBOTS_TTL_MS = 10 * 60_000;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface ParsedRobots {
  /** The User-Agent string the rules were selected for. */
  userAgent: string;
  /** The `User-agent:` token whose group was used: a product token, or `*`. */
  group: string;
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
  sitemaps: string[];
  raw: string;
}

export interface RobotsRuleMatch {
  pattern: string;
  allow: boolean;
}

export interface RobotsDecision {
  allowed: boolean;
  /** One line a human or the agent can relay verbatim. */
  reason: string;
  /** The rule that decided it, when a rule did. */
  matched?: RobotsRuleMatch;
  /** `Crawl-delay` as milliseconds, when the host published one. */
  crawlDelayMs: number | null;
  robotsUrl: string;
  /** HTTP status of `robots.txt` (`null` when the fetch itself failed). */
  robotsStatus: number | null;
  fromCache: boolean;
}

export interface RobotsTxtResponse {
  status: number;
  text: string;
}

/** Injected so tests never touch the network (and production uses real `fetch`). */
export type RobotsFetcher = (url: string, userAgent: string) => Promise<RobotsTxtResponse>;

/** `https://example.com/a/b?c=1` -> `https://example.com/robots.txt`. */
export function robotsUrlFor(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}/robots.txt`;
}

/**
 * Parse a `robots.txt` body and select the group that applies to `userAgent`.
 *
 * Group selection, in order:
 *  1. every group whose token is a case-insensitive substring of our
 *     User-Agent (`NobogentScraper` matches `NobogentScraper/1.0 (+url)`), merged;
 *  2. failing that, the `*` group(s), merged.
 *
 * Merging matters: real files publish `User-agent: Bot` twice instead of one
 * group, and reading only the first would lose half the rules.
 */
export function parseRobots(text: string, userAgent = DEFAULT_SCRAPE_USER_AGENT): ParsedRobots {
  const raw = String(text ?? '');
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelaySeconds: number | null }[] = [];
  const sitemaps: string[] = [];

  let current: { agents: string[]; rules: RobotsRule[]; crawlDelaySeconds: number | null } | null = null;
  /** A `Crawl-delay` belongs to the group it is declared in, even if it precedes a new `User-agent` line. */
  let lastWasAgent = false;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) {
      // A blank line ends a group; the next `User-agent` opens a fresh one.
      current = null;
      lastWasAgent = false;
      continue;
    }

    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      // Consecutive User-agent lines describe ONE group; a User-agent after
      // directives starts the next group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      if (value) current.agents.push(value);
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;

    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      // Sitemap is not scoped to a group.
      continue;
    }

    if (!current) {
      // A directive before any User-agent: RFC 9309 says ignore it. Keeping it
      // would silently deny paths the host never scoped to us.
      continue;
    }

    if (key === 'allow' || key === 'disallow') {
      // `Disallow:` with an empty value means "nothing is disallowed"; the
      // empty pattern would otherwise match every path as a denial.
      if (!value) continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
      continue;
    }

    if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
      continue;
    }
  }

  const ourToken = productTokenOf(userAgent).toLowerCase();
  const specific = groups.filter((group) =>
    group.agents.some((agent) => {
      const token = agent.toLowerCase();
      return token !== '*' && token !== '' && ourToken !== '' && ourToken.includes(token);
    }),
  );
  const wildcard = groups.filter((group) => group.agents.some((agent) => agent.trim() === '*'));
  const chosen = specific.length ? specific : wildcard;

  const rules: RobotsRule[] = [];
  let crawlDelaySeconds: number | null = null;
  for (const group of chosen) {
    rules.push(...group.rules);
    if (group.crawlDelaySeconds !== null) {
      crawlDelaySeconds =
        crawlDelaySeconds === null ? group.crawlDelaySeconds : Math.max(crawlDelaySeconds, group.crawlDelaySeconds);
    }
  }

  return {
    userAgent,
    group: specific.length ? specific[0].agents.find((agent) => agent.trim() !== '*') ?? '*' : '*',
    rules,
    crawlDelaySeconds,
    sitemaps,
    raw,
  };
}

/** `NobogentScraper/1.0 (+https://…)` -> `NobogentScraper`. */
export function productTokenOf(userAgent: string): string {
  const token = String(userAgent ?? '').trim().split(/[\s/]/)[0];
  return token || '';
}

/**
 * Does `pattern` (robots syntax: `*` any run, `$` end anchor) match `path`?
 *
 * The pattern is anchored at the start; everything after it is free unless the
 * pattern ends with `$`. `?` and other regex metacharacters are literal here,
 * because robots patterns are not regexes — a `?` in `/search?q=` is a query
 * string, not an optional character.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const re = new RegExp(`^${source}${anchored ? '$' : ''}`);
  return re.test(path);
}

/** The path+query a rule is matched against, percent-decoded the way crawlers compare it. */
export function pathOf(url: string | URL): string {
  const parsed = url instanceof URL ? url : new URL(url);
  return `${parsed.pathname || '/'}${parsed.search || ''}`;
}

/**
 * Decide one path against a parsed file: longest match wins, ties go to `Allow`.
 */
export function matchRobots(robots: ParsedRobots, path: string): RobotsRuleMatch | null {
  let best: RobotsRuleMatch | null = null;
  for (const rule of robots.rules) {
    if (!robotsPatternMatches(rule.pattern, path)) continue;
    if (!best) {
      best = rule;
      continue;
    }
    const length = rule.pattern.replace(/\$$/, '').length;
    const bestLength = best.pattern.replace(/\$$/, '').length;
    if (length > bestLength || (length === bestLength && rule.allow)) best = rule;
  }
  return best;
}

/**
 * A `robots.txt` reader with a per-host TTL cache.
 *
 * One instance per process is enough; the cache is keyed by host, so two hosts
 * never share a decision. `ttlMs: 0` disables reuse (useful in a test that wants
 * to re-fetch).
 */
export class RobotsGate {
  private readonly cache = new Map<
    string,
    { robots: ParsedRobots | null; status: number | null; fetchedAt: number; error: string | null }
  >();

  private readonly fetchRobots: RobotsFetcher;
  private readonly ttlMs: number;
  private readonly now: () => number;
  readonly userAgent: string;

  constructor(options: {
    fetchRobots: RobotsFetcher;
    userAgent?: string;
    ttlMs?: number;
    now?: () => number;
  }) {
    if (typeof options?.fetchRobots !== 'function') {
      throw new Error('[robots] needs a fetchRobots(url, userAgent) function');
    }
    this.fetchRobots = options.fetchRobots;
    this.userAgent = options.userAgent ?? DEFAULT_SCRAPE_USER_AGENT;
    this.ttlMs = options.ttlMs ?? DEFAULT_ROBOTS_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** The parsed file for a host, if it is cached and fresh. */
  peek(host: string): ParsedRobots | null {
    const entry = this.cache.get(host);
    if (!entry || !entry.robots) return null;
    if (this.isStale(entry.fetchedAt)) return null;
    return entry.robots;
  }

  /** Drop everything (a test or an operator forcing a re-read). */
  clear(): void {
    this.cache.clear();
  }

  /**
   * The decision for one URL. Never throws for an ordinary denial — a denial is
   * an answer, not an error. It DOES throw for a malformed URL, because that is
   * a caller bug, not a host's opinion.
   */
  async check(url: string, userAgent = this.userAgent): Promise<RobotsDecision> {
    const target = new URL(url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error(`[robots] only http/https can be checked, got ${target.protocol}`);
    }

    const host = target.host;
    const robotsUrl = `${target.origin}/robots.txt`;
    const entry = this.cache.get(host);
    const fresh = entry && !this.isStale(entry.fetchedAt);
    let robots: ParsedRobots | null;
    let status: number | null;
    let error: string | null;

    if (fresh) {
      robots = entry.robots;
      status = entry.status;
      error = entry.error;
    } else {
      try {
        const response = await this.fetchRobots(robotsUrl, userAgent);
        status = response.status;
        error = null;
        // 4xx (typically 404/410) means nothing was published: allowed.
        // 5xx means the host cannot tell us its rules: refused (RFC 9309).
        robots = response.status >= 200 && response.status < 300 ? parseRobots(response.text, userAgent) : null;
      } catch (err: any) {
        robots = null;
        status = null;
        error = err?.message ? String(err.message) : String(err);
      }
      this.cache.set(host, { robots, status, fetchedAt: this.now(), error });
    }

    const crawlDelayMs = robots?.crawlDelaySeconds != null ? Math.round(robots.crawlDelaySeconds * 1000) : null;

    // Nothing usable was published: allowed (404) or refused (unreachable / 5xx).
    if (!robots) {
      if (status !== null && status >= 400 && status < 500) {
        return {
          allowed: true,
          reason: `robots.txt is HTTP ${status} on ${host} — nothing published to obey, so the path is allowed`,
          crawlDelayMs: null,
          robotsUrl,
          robotsStatus: status,
          fromCache: Boolean(fresh),
        };
      }
      return {
        allowed: false,
        reason:
          `robots.txt could not be read on ${host} ` +
          `(${error ? `error: ${error}` : `HTTP ${status}`}) — refusing rather than guessing`,
        crawlDelayMs: null,
        robotsUrl,
        robotsStatus: status,
        fromCache: Boolean(fresh),
      };
    }

    const path = pathOf(target);
    const matched = matchRobots(robots, path);

    if (matched && !matched.allow) {
      return {
        allowed: false,
        reason: `robots.txt on ${host} disallows ${path} (rule "Disallow: ${matched.pattern}", group ${robots.group})`,
        matched,
        crawlDelayMs,
        robotsUrl,
        robotsStatus: status,
        fromCache: Boolean(fresh),
      };
    }

    return {
      allowed: true,
      reason: matched
        ? `robots.txt on ${host} allows ${path} (rule "Allow: ${matched.pattern}", group ${robots.group})`
        : `robots.txt on ${host} has no rule for ${path} (group ${robots.group}), so the path is allowed`,
      ...(matched ? { matched } : {}),
      crawlDelayMs,
      robotsUrl,
      robotsStatus: status,
      fromCache: Boolean(fresh),
    };
  }

  private isStale(fetchedAt: number): boolean {
    return this.ttlMs <= 0 || this.now() - fetchedAt >= this.ttlMs;
  }
}

/** The default gate: real `fetch`, honest User-Agent, in-memory TTL cache. */
export function createRobotsGate(options: {
  fetchRobots?: RobotsFetcher;
  userAgent?: string;
  ttlMs?: number;
  now?: () => number;
  timeoutMs?: number;
} = {}): RobotsGate {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchRobots: RobotsFetcher =
    options.fetchRobots ??
    (async (url, userAgent) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': userAgent, Accept: 'text/plain,*/*;q=0.5' },
          redirect: 'follow',
          signal: controller.signal,
        });
        return { status: response.status, text: await response.text() };
      } finally {
        clearTimeout(timer);
      }
    });

  return new RobotsGate({
    fetchRobots,
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
