/**
 * Proves the scraping capability behaves itself — with NO network, NO R2 and NO
 * real clock.
 *
 * The rules this file pins, and why each one is here rather than in a live run:
 *
 *  - `robots.txt` parsing: `Disallow` honoured, `Allow` beating a broader
 *    `Disallow`, a missing file meaning "allowed", `Crawl-delay` turning into a
 *    real minimum interval, and a group for our own token beating `*`;
 *  - a disallowed URL is refused with **zero** page requests (the fake fetch is
 *    asserted to have never been called — a warning-and-proceed would pass a
 *    "returned no rows" test, so this asserts the request instead);
 *  - a 429 is retried after a GROWING delay, a bounded number of times, and
 *    `Retry-After` is obeyed when the server bothers to send it;
 *  - the SSRF guard refuses `localhost`, `127.0.0.1`, `169.254.169.254`, a
 *    hostname resolving to a private address, and `file:`/`data:` URLs;
 *  - one in-flight request per host, a token bucket that actually waits, and a
 *    `Retry-After` that parks the whole host;
 *  - the same URL twice inside the TTL is ONE page request, ONE R2 PUT and ONE
 *    cache hit — and a changed definition version is a different key;
 *  - extraction of a required field that produces nothing throws, NAMING the
 *    field, instead of returning partial rows;
 *  - login walls, CAPTCHAs and 401/403 stop the run without a retry, and the body
 *    is never handed downstream;
 *  - `runScrape` (through the `scrape` skill's own tools) reports what it did and
 *    meters every page it read.
 *
 *   npm run verify:scraping
 */
import {
  parseRobots,
  matchRobots,
  robotsPatternMatches,
  createRobotsGate,
} from '../lib/agent/scraping/robots';
import { backoffDelayMs, HostRateLimiter, parseRetryAfter } from '../lib/agent/scraping/rate-limit';
import {
  assertFetchableUrl,
  classifyBody,
  isPrivateAddress,
  politeFetch,
  ScrapeRefusedError,
  type ScrapeFetch,
  type ScrapeFetchResponse,
  type ScrapeMeterEvent,
} from '../lib/agent/scraping/fetch';
import { cacheKeyFor, MemoryScrapeCache, readCache, type CachedResponse, type ScrapeCache } from '../lib/agent/scraping/cache';
import {
  definitionUrls,
  definitionVersion,
  diffDefinitions,
  extractRows,
  ExtractionError,
  parseDefinition,
  selectAll,
  parseHtml,
  textOf,
  type DefinitionStore,
  type ScrapeDefinition,
  type StoredDefinition,
} from '../lib/agent/scraping/extract';
import { describeScrapeRun, runScrape } from '../lib/agent/scraping';
import { createScrapeTools } from '../lib/agent/tools/skills/scrape';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

const PUBLIC_IP = '93.184.216.34';
const resolver = async () => [PUBLIC_IP];

/** A clock the fake `sleep` advances, so "it waited 4 s" costs nothing. */
function fakeClock(start = 1_760_000_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

interface Route {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

interface FakeServer {
  fetch: ScrapeFetch;
  calls: string[];
  /** Distinct attempts per URL, so a retry is countable. */
  attemptsFor(url: string): number;
  maxConcurrent: number;
}

/**
 * A routing fetch that can answer per URL per attempt.
 *
 * `route` returns null to fall through to a 404. Attempts are counted so a test
 * can assert "three requests, no more" rather than trusting a counter inside the
 * code under test.
 */
function fakeServer(
  route: (url: string, attempt: number) => Route | null,
  options: { delayMs?: number } = {},
): FakeServer {
  const calls: string[] = [];
  const perUrl = new Map<string, number>();
  let concurrent = 0;
  let maxConcurrent = 0;

  const fetchImpl: ScrapeFetch = async (url) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    try {
      calls.push(url);
      const attempt = (perUrl.get(url) ?? 0) + 1;
      perUrl.set(url, attempt);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const matched = route(url, attempt);
      const result: Route = matched ?? { status: 404, body: 'not found' };
      const headers = new Headers(result.headers ?? {});
      if (!headers.has('content-type')) headers.set('content-type', 'text/html; charset=utf-8');
      const response: ScrapeFetchResponse = {
        status: result.status,
        headers: { get: (name: string) => headers.get(name) },
        text: async () => result.body ?? '',
      };
      return response;
    } finally {
      concurrent--;
    }
  };

  return {
    fetch: fetchImpl,
    calls,
    attemptsFor: (url: string) => perUrl.get(url) ?? 0,
    get maxConcurrent() {
      return maxConcurrent;
    },
  };
}

function fakeRobots(map: Record<string, string | number>) {
  const calls: string[] = [];
  const fetchRobots = async (url: string) => {
    calls.push(url);
    const host = new URL(url).host;
    const entry = map[host] ?? 404;
    if (typeof entry === 'number') return { status: entry, text: '' };
    return { status: 200, text: entry };
  };
  return { fetchRobots, calls };
}

/** An R2 stand-in that counts exactly what the cache contract promises. */
class FakeR2 implements ScrapeCache {
  readonly objects = new Map<string, string>();
  gets = 0;
  hits = 0;
  puts = 0;

  async get(key: string): Promise<CachedResponse | null> {
    this.gets++;
    const text = this.objects.get(key);
    if (text === undefined) return null;
    this.hits++;
    return JSON.parse(text) as CachedResponse;
  }

  async put(key: string, entry: CachedResponse): Promise<void> {
    this.puts++;
    this.objects.set(key, JSON.stringify(entry));
  }
}

class MemoryStore implements DefinitionStore {
  private readonly map = new Map<string, StoredDefinition>();

  async list(): Promise<StoredDefinition[]> {
    return [...this.map.values()];
  }

  async get(name: string): Promise<StoredDefinition | null> {
    return this.map.get(name) ?? null;
  }

  async save(raw: unknown): Promise<StoredDefinition> {
    const definition = parseDefinition(raw);
    const stored = {
      name: definition.name,
      definition,
      version: definitionVersion(definition),
      updatedAt: new Date().toISOString(),
      source: 'file' as const,
    };
    this.map.set(definition.name, stored);
    return stored;
  }
}

const FEED_HTML = `<!doctype html><html><head><title>Newsroom</title></head><body>
<main id="feed">
  <article class="story news" data-kind="item">
    <h2 class="title"><a href="/a/one">First thing that happened</a></h2>
    <p class="lede">A short summary of the first item.</p>
  </article>
  <article class="story news" data-kind="item">
    <h2 class="title"><a href="/a/two">Second thing that happened</a></h2>
  </article>
  <article class="story news" data-kind="item">
    <h2 class="title">Third thing, with no link</h2>
  </article>
</main>
<script>var tracking = { "headline": "should never be a field" };</script>
</body></html>`;

const ITEMS_JSON = JSON.stringify({
  generated: '2026-01-01T00:00:00Z',
  items: [
    { title: 'Alpha', url: 'https://example.org/a', rank: 1 },
    { title: 'Beta', rank: 2 },
  ],
});

const HTML_DEFINITION: ScrapeDefinition = parseDefinition({
  version: 1,
  name: 'feed-headlines',
  description: 'Headlines and links from a public newsroom index page',
  format: 'html',
  urls: ['https://example.org/feed'],
  rows: { selector: 'article.story', limit: 10 },
  fields: [
    { name: 'headline', selector: 'h2' },
    { name: 'link', selector: 'h2 a', attribute: 'href', resolve: true, optional: true },
    { name: 'summary', selector: 'p.lede', optional: true },
  ],
});

const JSON_DEFINITION: ScrapeDefinition = parseDefinition({
  version: 1,
  name: 'feed-items-json',
  format: 'json',
  urlTemplate: 'https://api.example.org/items/{section}',
  inputs: ['section'],
  rows: { path: '$.items[*]' },
  fields: [
    { name: 'title', path: 'title' },
    { name: 'url', path: 'url', optional: true },
    { name: 'rank', path: 'rank', number: true },
  ],
});

(async () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. robots.txt
  // ──────────────────────────────────────────────────────────────────────────

  const corpus = [
    'User-agent: *',
    'Disallow: /private',
    'Disallow: /tmp/',
    'Allow: /private/public',
    'Crawl-delay: 5',
  ].join('\n');
  const parsed = parseRobots(corpus, 'NobogentScraper/1.0 (+https://nobogent.com/scraping-policy)');

  check(
    'robots: a Disallow rule is honoured',
    matchRobots(parsed, '/private/report')?.allow === false,
    `matched "${matchRobots(parsed, '/private/report')?.pattern}"`,
  );
  check(
    'robots: Allow beats a broader Disallow',
    matchRobots(parsed, '/private/public/notes')?.allow === true,
    `matched "${matchRobots(parsed, '/private/public/notes')?.pattern}"`,
  );
  check(
    'robots: the broader Disallow still denies a sibling path',
    matchRobots(parsed, '/private/other')?.allow === false,
  );
  check(
    'robots: a path with no matching rule is allowed',
    matchRobots(parsed, '/feed') === null,
    'no rule matched /feed',
  );
  check(
    'robots: Crawl-delay is parsed into the decision',
    parsed.crawlDelaySeconds === 5,
    `${parsed.crawlDelaySeconds}s`,
  );
  check(
    'robots: `*` wildcards and `$` end anchors work',
    robotsPatternMatches('/search*', '/search?q=1') &&
      robotsPatternMatches('/exact$', '/exact') &&
      !robotsPatternMatches('/exact$', '/exact/more'),
    '/search* , /exact$',
  );

  // A missing file means allowed; an unreachable one means refused.
  {
    const clock = fakeClock();
    const { fetchRobots } = fakeRobots({});
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const decision = await gate.check('https://example.org/feed');
    check('robots: a missing robots.txt (404) allows the path', decision.allowed, decision.reason);
    check('robots: the 404 is reported, not hidden', decision.robotsStatus === 404, String(decision.robotsStatus));
  }
  {
    const clock = fakeClock();
    const { fetchRobots } = fakeRobots({ 'down.example': 503 });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const decision = await gate.check('https://down.example/feed');
    check(
      'robots: an unreadable robots.txt (5xx) refuses rather than guessing',
      !decision.allowed,
      decision.reason,
    );
  }

  // A group for OUR token wins over the wildcard group, and its Crawl-delay is kept.
  {
    const clock = fakeClock();
    const { fetchRobots, calls } = fakeRobots({
      'example.org': ['User-agent: *', 'Disallow: /', 'User-agent: NobogentScraper', 'Disallow: /ours', 'Crawl-delay: 2'].join('\n'),
    });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const ours = await gate.check('https://example.org/ours/x');
    const other = await gate.check('https://example.org/anything');
    check(
      'robots: our own User-agent group beats the wildcard group',
      !ours.allowed && other.allowed,
      'NobogentScraper group says /ours only',
    );
    check('robots: the specific group crawl-delay is applied', ours.crawlDelayMs === 2000, `${ours.crawlDelayMs} ms`);
    await gate.check('https://example.org/anything/else');
    check(
      'robots: the parse is cached per host inside the TTL',
      calls.length === 1,
      `${calls.length} robots.txt request(s) for 3 checks`,
    );
    check('robots: the decision says it came from cache', ours.fromCache === false && other.fromCache === true);
  }

  // Crawl-delay becomes a real minimum interval between requests.
  {
    const clock = fakeClock();
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep, requestsPerSecond: 10, burst: 10 });
    const first = await limiter.run('example.org', async () => 'a', { crawlDelayMs: 5000 });
    const second = await limiter.run('example.org', async () => 'b', { crawlDelayMs: 5000 });
    check(
      'robots: Crawl-delay is respected as a minimum interval',
      first.waitedMs === 0 && second.waitedMs >= 5000,
      `first ${first.waitedMs} ms, second ${second.waitedMs} ms`,
    );
    check('robots: the wait is reported as a crawl-delay reason', second.reason === 'crawl-delay', second.reason);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. A forbidden URL is refused, and no request is made
  // ──────────────────────────────────────────────────────────────────────────
  {
    const clock = fakeClock();
    const server = fakeServer(() => ({ status: 200, body: FEED_HTML }));
    const { fetchRobots, calls: robotsCalls } = fakeRobots({
      'example.org': ['User-agent: *', 'Disallow: /private'].join('\n'),
    });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });
    const metered: ScrapeMeterEvent[] = [];

    const result = await politeFetch(
      { url: 'https://example.org/private/report', definitionVersion: definitionVersion(HTML_DEFINITION) },
      {
        fetch: server.fetch,
        robots: gate,
        limiter,
        resolveHost: resolver,
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0.5,
        meter: (event) => {
          metered.push(event);
        },
      },
    );

    check('refusal: a robots-disallowed URL is refused', !result.ok && result.classification === 'refused', result.classification);
    check('refusal: the refusal names robots.txt', result.refusal?.kind === 'robots', result.refusal?.reason ?? '—');
    check(
      'refusal: NO page request was made (the fake fetch was never called)',
      server.calls.length === 0,
      `${server.calls.length} page request(s)`,
    );
    check(
      'refusal: the only request was for robots.txt itself',
      robotsCalls.length === 1 && robotsCalls[0].endsWith('/robots.txt'),
      robotsCalls.join(', '),
    );
    check('refusal: nothing was metered as a page read', metered.length === 0, `${metered.length} metered event(s)`);
    check('refusal: no body is handed downstream', result.body === null);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. 429 → growing backoff → success, and the retries are bounded
  // ──────────────────────────────────────────────────────────────────────────
  {
    const clock = fakeClock();
    const server = fakeServer((url, attempt) =>
      attempt <= 2 ? { status: 429, headers: { 'retry-after': '' }, body: 'slow down' } : { status: 200, body: FEED_HTML },
    );
    const { fetchRobots } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });

    const result = await politeFetch(
      { url: 'https://example.org/feed' },
      {
        fetch: server.fetch,
        robots: gate,
        limiter,
        resolveHost: resolver,
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0.5,
        backoffBaseMs: 500,
        maxAttempts: 4,
      },
    );

    check('429: the retry eventually succeeds', result.ok && result.status === 200, `status ${result.status}`);
    check('429: three requests were made in total', server.attemptsFor('https://example.org/feed') === 3, `${server.attemptsFor('https://example.org/feed')} attempts`);
    check(
      '429: the delays GREW between attempts',
      result.delays.length === 2 && result.delays[1].delayMs > result.delays[0].delayMs,
      result.delays.map((delay) => `${delay.delayMs}ms`).join(' then '),
    );
    check(
      '429: every planned backoff was actually slept',
      result.delays.every((delay) => clock.sleeps.includes(delay.delayMs)),
      `planned [${result.delays.map((delay) => delay.delayMs).join(', ')}], slept [${clock.sleeps.join(', ')}]`,
    );
    check(
      '429: the delay doubles at least (exponential, not linear)',
      result.delays[1].delayMs >= result.delays[0].delayMs * 2,
      `${result.delays[0].delayMs} → ${result.delays[1].delayMs}`,
    );
  }
  {
    const clock = fakeClock();
    const server = fakeServer(() => ({ status: 429, headers: { 'retry-after': '' } }));
    const { fetchRobots } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });

    const result = await politeFetch(
      { url: 'https://example.org/always-429' },
      {
        fetch: server.fetch,
        robots: gate,
        limiter,
        resolveHost: resolver,
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0.5,
        maxAttempts: 3,
      },
    );
    check(
      '429: retries are BOUNDED (maxAttempts requests, then a reported failure)',
      server.attemptsFor('https://example.org/always-429') === 3 && result.attempts === 3 && !result.ok,
      `${server.attemptsFor('https://example.org/always-429')} requests, classification ${result.classification}`,
    );
    check('429: the exhausted result says rate_limited', result.classification === 'rate_limited', result.classification);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Retry-After is honoured when present
  // ──────────────────────────────────────────────────────────────────────────
  {
    check(
      'retry-after: delta-seconds parse to ms',
      parseRetryAfter('7', 0) === 7000,
      String(parseRetryAfter('7', 0)),
    );
    check(
      'retry-after: an HTTP-date parses to a delta',
      parseRetryAfter(new Date(30_000).toUTCString(), 0) === 30_000,
      String(parseRetryAfter(new Date(30_000).toUTCString(), 0)),
    );
    check('retry-after: an absent header returns null (so backoff applies)', parseRetryAfter(null) === null);

    const clock = fakeClock();
    const server = fakeServer((url, attempt) =>
      attempt === 1 ? { status: 429, headers: { 'retry-after': '7' } } : { status: 200, body: FEED_HTML },
    );
    const { fetchRobots } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });

    const result = await politeFetch(
      { url: 'https://example.org/feed' },
      {
        fetch: server.fetch,
        robots: gate,
        limiter,
        resolveHost: resolver,
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0.5,
        backoffBaseMs: 500,
      },
    );

    check('retry-after: the wait is exactly what the server asked for', result.delays[0]?.delayMs === 7000, `${result.delays[0]?.delayMs} ms`);
    check('retry-after: the delay is labelled retry-after, not backoff', result.delays[0]?.reason === 'retry-after', result.delays[0]?.reason ?? '—');
    check('retry-after: the run then succeeded', result.ok, `status ${result.status}`);
    check('retry-after: the sleep actually happened', clock.sleeps.includes(7000), `slept [${clock.sleeps.join(', ')}]`);
  }
  {
    // A Retry-After parks the whole host, not just the call that saw it.
    const clock = fakeClock();
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep, requestsPerSecond: 100, burst: 100 });
    limiter.noteRetryAfter('example.org', 4000, '429');
    check('retry-after: the host is parked', limiter.cooldownRemainingMs('example.org') === 4000, `${limiter.cooldownRemainingMs('example.org')} ms`);
    const run = await limiter.run('example.org', async () => 'ok');
    check('retry-after: the next request waits out the cooldown', run.waitedMs >= 4000, `${run.waitedMs} ms`);
    check('retry-after: the wait is attributed to the cooldown', run.reason === 'cooldown', run.reason);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. The SSRF guard
  // ──────────────────────────────────────────────────────────────────────────
  {
    const cases: { url: string; kind: string; label: string }[] = [
      { url: 'http://localhost/admin', kind: 'ssrf', label: 'http://localhost' },
      { url: 'http://169.254.169.254/latest/meta-data/', kind: 'ssrf', label: '169.254.169.254 (cloud metadata)' },
      { url: 'http://127.0.0.1:8080/', kind: 'ssrf', label: 'http://127.0.0.1' },
      { url: 'file:///etc/passwd', kind: 'scheme', label: 'file://' },
      { url: 'data:text/html,<h1>hi</h1>', kind: 'scheme', label: 'data:' },
      { url: 'http://10.0.0.5/internal', kind: 'ssrf', label: '10.0.0.5 (RFC1918)' },
      { url: 'http://[::1]/', kind: 'ssrf', label: '[::1]' },
      { url: 'http://user:pass@example.org/', kind: 'credentials', label: 'a URL with credentials' },
    ];

    for (const testCase of cases) {
      let kind = 'none';
      try {
        await assertFetchableUrl(testCase.url, { resolve: resolver });
      } catch (err: any) {
        kind = err instanceof ScrapeRefusedError ? err.kind : `error:${err?.message}`;
      }
      check(`ssrf: ${testCase.label} is refused`, kind === testCase.kind, `kind ${kind}`);
    }

    // A public NAME resolving to a private address is refused too.
    let dnsKind = 'none';
    try {
      await assertFetchableUrl('https://looks-public.example/', { resolve: async () => ['10.1.2.3'] });
    } catch (err: any) {
      dnsKind = err instanceof ScrapeRefusedError ? err.kind : 'error';
    }
    check('ssrf: a hostname resolving to a private address is refused', dnsKind === 'ssrf', `kind ${dnsKind}`);

    check(
      'ssrf: a public address is allowed through',
      isPrivateAddress('93.184.216.34') === false && isPrivateAddress('169.254.169.254') === true,
      'the classifier agrees',
    );

    // …and the refusal happens before any request.
    const clock = fakeClock();
    const server = fakeServer(() => ({ status: 200, body: 'should never be fetched' }));
    const { fetchRobots, calls: robotsCalls } = fakeRobots({});
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });
    const result = await politeFetch(
      { url: 'http://169.254.169.254/latest/meta-data/' },
      { fetch: server.fetch, robots: gate, limiter, resolveHost: resolver, now: clock.now, sleep: clock.sleep },
    );
    check(
      'ssrf: the metadata address is refused with no request at all',
      result.refusal?.kind === 'ssrf' && server.calls.length === 0 && robotsCalls.length === 0,
      `page requests ${server.calls.length}, robots requests ${robotsCalls.length}`,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Rate limiting: one in-flight per host, and a bucket that waits
  // ──────────────────────────────────────────────────────────────────────────
  {
    const clock = fakeClock();
    const server = fakeServer(() => ({ status: 200, body: FEED_HTML }), { delayMs: 10 });
    const { fetchRobots } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep, requestsPerSecond: 2, burst: 1 });

    await Promise.all([
      politeFetch({ url: 'https://example.org/a' }, { fetch: server.fetch, robots: gate, limiter, resolveHost: resolver, now: clock.now, sleep: clock.sleep, random: () => 0.5 }),
      politeFetch({ url: 'https://example.org/b' }, { fetch: server.fetch, robots: gate, limiter, resolveHost: resolver, now: clock.now, sleep: clock.sleep, random: () => 0.5 }),
      politeFetch({ url: 'https://example.org/c' }, { fetch: server.fetch, robots: gate, limiter, resolveHost: resolver, now: clock.now, sleep: clock.sleep, random: () => 0.5 }),
    ]);

    check(
      'rate-limit: never more than ONE request in flight per host',
      server.maxConcurrent === 1,
      `max concurrency ${server.maxConcurrent} across 3 simultaneous calls`,
    );
    check(
      'rate-limit: the burst is 1, so later calls waited for a token',
      limiter.waits().filter((wait) => wait.waitedMs > 0).length === 2,
      limiter.waits().map((wait) => `${wait.waitedMs}ms/${wait.reason}`).join(', '),
    );
    check(
      'rate-limit: backoff is bounded by its cap',
      backoffDelayMs(10, { baseMs: 500, capMs: 8000, random: () => 0.5 }).delayMs <= 8000,
      'cap 8000 ms',
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. The R2 cache: one PUT, one hit, one page request
  // ──────────────────────────────────────────────────────────────────────────
  {
    const clock = fakeClock();
    const server = fakeServer(() => ({ status: 200, body: FEED_HTML }));
    const { fetchRobots, calls: robotsCalls } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });
    const cache = new FakeR2();
    const version = definitionVersion(HTML_DEFINITION);

    const deps = {
      fetch: server.fetch,
      robots: gate,
      limiter,
      cache,
      resolveHost: resolver,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0.5,
      cacheTtlMs: 60_000,
    };

    const first = await politeFetch({ url: 'https://example.org/feed', definitionVersion: version }, deps);
    const second = await politeFetch({ url: 'https://example.org/feed', definitionVersion: version }, deps);

    check('cache: the first read fetched the page', first.ok && !first.cached, `${server.calls.length} request(s) so far`);
    check('cache: exactly one R2 PUT was made', cache.puts === 1, `${cache.puts} PUT(s)`);
    check('cache: the second read was served from the cache', second.ok && second.cached === true, `cached=${second.cached}`);
    check('cache: exactly one cache hit was served', cache.hits === 1, `${cache.hits} hit(s), ${cache.gets} GET(s)`);
    check(
      'cache: the same URL was NOT scraped twice inside the TTL',
      server.calls.length === 1,
      `${server.calls.length} page request(s) for 2 reads`,
    );
    check('cache: robots.txt was read once, not twice', robotsCalls.length === 1, `${robotsCalls.length} robots request(s)`);
    check(
      'cache: the key is a hash of url + definition version',
      cacheKeyFor('https://example.org/feed', version) === first.cacheKey &&
        cacheKeyFor('https://example.org/feed', 'otherversion') !== first.cacheKey,
      first.cacheKey ?? '—',
    );

    // A changed definition is a different scrape, so it must not reuse the entry.
    const otherVersion = definitionVersion(
      parseDefinition({ ...JSON.parse(JSON.stringify(HTML_DEFINITION)), fields: [{ name: 'headline', selector: 'h2' }] }),
    );
    const third = await politeFetch({ url: 'https://example.org/feed', definitionVersion: otherVersion }, deps);
    check(
      'cache: a different definition version re-fetches (and PUTs again)',
      third.cached === false && cache.puts === 2 && server.calls.length === 2,
      `${cache.puts} PUT(s), ${server.calls.length} page request(s)`,
    );

    // …and an expired entry is not served.
    const staleEntry: CachedResponse = {
      url: 'https://example.org/feed',
      definitionVersion: version,
      status: 200,
      contentType: 'text/html',
      body: FEED_HTML,
      key: cacheKeyFor('https://example.org/feed', version),
      fetchedAt: clock.now() - 120_000,
      expiresAt: clock.now() - 60_000,
    };
    const staleCache = new MemoryScrapeCache();
    await staleCache.put(staleEntry.key, staleEntry);
    const stale = await readCache(staleCache, staleEntry.key, clock.now());
    check('cache: an expired entry is reported stale, not served', stale.entry !== null && stale.stale === true);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Extraction: required fields are required
  // ──────────────────────────────────────────────────────────────────────────
  {
    const rows = extractRows(HTML_DEFINITION, FEED_HTML, { url: 'https://example.org/feed' });
    check('extract: three rows came out of the feed', rows.length === 3, `${rows.length} rows`);
    check('extract: the first headline is read', rows[0].headline === 'First thing that happened', String(rows[0].headline));
    check(
      'extract: an attribute is read and resolved against the page URL',
      rows[0].link === 'https://example.org/a/one',
      String(rows[0].link),
    );
    check('extract: an optional field that is absent becomes null, not a throw', rows[1].summary === null, String(rows[1].summary));
    check(
      'extract: script contents are never available as text',
      textOf(parseHtml(FEED_HTML)).includes('should never be a field') === false,
      'script body dropped at parse time',
    );
    check(
      'extract: a descendant selector picks the anchor inside the headline',
      selectAll(parseHtml(FEED_HTML), 'article.story h2 a').length === 2,
      '2 anchors',
    );

    const brokenDefinition = parseDefinition({
      version: 1,
      name: 'feed-with-byline',
      format: 'html',
      urls: ['https://example.org/feed'],
      rows: { selector: 'article.story' },
      fields: [{ name: 'headline', selector: 'h2 a' }, { name: 'byline', selector: '.byline' }],
    });

    let thrown: any = null;
    try {
      extractRows(brokenDefinition, FEED_HTML, { url: 'https://example.org/feed' });
    } catch (err) {
      thrown = err;
    }
    check('extract: a missing REQUIRED field throws', thrown instanceof ExtractionError, thrown ? String(thrown.message).slice(0, 80) : 'no throw');
    check(
      'extract: the error NAMES the field that is missing',
      Boolean(thrown) && /required field "byline"/.test(String(thrown.message)),
      String(thrown?.message ?? '').slice(0, 120),
    );
    check('extract: the error carries the field name structurally', thrown?.field === 'byline', String(thrown?.field));
    check('extract: no partial rows are returned', thrown?.rows === undefined, 'the call threw instead of returning rows');

    const jsonRows = extractRows(JSON_DEFINITION, ITEMS_JSON);
    check('extract: a JSON path definition produces rows', jsonRows.length === 2, `${jsonRows.length} rows`);
    check('extract: JSON fields are read by relative path', jsonRows[0].title === 'Alpha', String(jsonRows[0].title));
    check('extract: an optional JSON path that is absent becomes null', jsonRows[1].url === null, String(jsonRows[1].url));
    check('extract: `number: true` produces a number', jsonRows[1].rank === 2 && typeof jsonRows[1].rank === 'number');

    // Definition plumbing: versioning, inputs, diffing.
    check(
      'definition: the same body has the same version, a changed selector does not',
      definitionVersion(HTML_DEFINITION) === definitionVersion(parseDefinition(JSON.parse(JSON.stringify(HTML_DEFINITION)))),
      definitionVersion(HTML_DEFINITION),
    );
    const diff = diffDefinitions(HTML_DEFINITION, brokenDefinition);
    check(
      'definition: a diff names what changed',
      diff.added.includes('field.byline') && diff.removed.includes('field.summary'),
      `added ${diff.added.join(', ')}; removed ${diff.removed.join(', ')}`,
    );
    check(
      'definition: inputs fan out to one URL per value',
      definitionUrls(JSON_DEFINITION, { section: ['world', 'business'] }).join(' ') ===
        'https://api.example.org/items/world https://api.example.org/items/business',
      definitionUrls(JSON_DEFINITION, { section: ['world', 'business'] }).join(' '),
    );
    let missingInput = '';
    try {
      definitionUrls(JSON_DEFINITION, {});
    } catch (err: any) {
      missingInput = err?.message ?? '';
    }
    check('definition: a missing input is an error naming the input', /input "section"/.test(missingInput), missingInput.slice(0, 90));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Walls: login, CAPTCHA, 401/403 — stop, do not work around
  // ──────────────────────────────────────────────────────────────────────────
  {
    const loginHtml = '<html><body><h1>Sign in</h1><form><input type="password" name="pass"></form></body></html>';
    const captchaHtml = '<html><head><title>Just a moment...</title></head><body><div class="g-recaptcha"></div></body></html>';
    const plain = classifyBody(FEED_HTML);
    check('walls: a normal page is not flagged', !plain.login && !plain.captcha);
    check('walls: a password field is a login wall', classifyBody(loginHtml).login, String(classifyBody(loginHtml).reason));
    check('walls: a challenge page is a CAPTCHA', classifyBody(captchaHtml).captcha, String(classifyBody(captchaHtml).reason));

    const scenarios: { label: string; route: () => Route; kind: string }[] = [
      { label: 'a 200 sign-in page', route: () => ({ status: 200, body: loginHtml }), kind: 'login' },
      { label: 'a 200 CAPTCHA page', route: () => ({ status: 200, body: captchaHtml }), kind: 'captcha' },
      { label: 'a 403', route: () => ({ status: 403, body: 'forbidden' }), kind: 'auth' },
      { label: 'a 401', route: () => ({ status: 401, body: 'unauthorised' }), kind: 'auth' },
    ];

    for (const scenario of scenarios) {
      const clock = fakeClock();
      const server = fakeServer(scenario.route);
      const { fetchRobots } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
      const gate = createRobotsGate({ fetchRobots, now: clock.now });
      const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });
      const result = await politeFetch(
        { url: 'https://example.org/walled' },
        { fetch: server.fetch, robots: gate, limiter, resolveHost: resolver, now: clock.now, sleep: clock.sleep, random: () => 0.5, maxAttempts: 4 },
      );
      check(
        `walls: ${scenario.label} is refused as ${scenario.kind}, once`,
        result.classification === 'refused' &&
          result.refusal?.kind === scenario.kind &&
          server.attemptsFor('https://example.org/walled') === 1 &&
          result.body === null,
        `${server.attemptsFor('https://example.org/walled')} request(s), kind ${result.refusal?.kind}`,
      );
    }

    // 5xx IS retried (bounded), unlike a refusal.
    const clock = fakeClock();
    const server = fakeServer((url, attempt) => (attempt === 1 ? { status: 503 } : { status: 200, body: FEED_HTML }));
    const { fetchRobots } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });
    const recovered = await politeFetch(
      { url: 'https://example.org/flaky' },
      { fetch: server.fetch, robots: gate, limiter, resolveHost: resolver, now: clock.now, sleep: clock.sleep, random: () => 0.5 },
    );
    check('walls: a 5xx is retried (unlike a refusal) and then succeeds', recovered.ok && server.attemptsFor('https://example.org/flaky') === 2, `${server.attemptsFor('https://example.org/flaky')} attempts`);

    // A public URL redirecting to a private one is stopped at the hop.
    const clock2 = fakeClock();
    const redirectServer = fakeServer((url) =>
      url.includes('example.org/redir') ? { status: 302, headers: { location: 'http://127.0.0.1/secret' } } : { status: 200, body: 'secret' },
    );
    const { fetchRobots: robots2 } = fakeRobots({ 'example.org': 'User-agent: *\nDisallow:' });
    const gate2 = createRobotsGate({ fetchRobots: robots2, now: clock2.now });
    const limiter2 = new HostRateLimiter({ now: clock2.now, sleep: clock2.sleep });
    const redirected = await politeFetch(
      { url: 'https://example.org/redir' },
      { fetch: redirectServer.fetch, robots: gate2, limiter: limiter2, resolveHost: resolver, now: clock2.now, sleep: clock2.sleep, random: () => 0.5 },
    );
    check(
      'walls: a redirect to a private address is refused at the hop',
      redirected.classification === 'refused' && redirected.refusal?.kind === 'redirect',
      redirected.refusal?.reason ?? redirected.classification,
    );
    check(
      'walls: the private redirect target was never requested',
      redirectServer.calls.every((url) => !url.includes('127.0.0.1')),
      redirectServer.calls.join(', '),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 10. End to end through the skill's own tools
  // ──────────────────────────────────────────────────────────────────────────
  {
    const clock = fakeClock();
    const server = fakeServer((url) => {
      if (url === 'https://example.org/feed') return { status: 200, body: FEED_HTML };
      if (url === 'https://example.org/deny') return { status: 200, body: 'should not be fetched' };
      return { status: 404 };
    });
    const { fetchRobots } = fakeRobots({
      'example.org': ['User-agent: *', 'Disallow: /deny', 'Crawl-delay: 1'].join('\n'),
    });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep, requestsPerSecond: 5, burst: 1 });
    const cache = new FakeR2();
    const store = new MemoryStore();
    const metered: ScrapeMeterEvent[] = [];

    const tools: any = createScrapeTools(undefined, undefined, {
      store,
      cache,
      robots: gate,
      limiter,
      fetch: server.fetch,
      resolveHost: resolver,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0.5,
      cacheTtlMs: 60_000,
      meter: (event) => {
        metered.push(event);
      },
    });

    const saved: any = await tools.scrape_save_definition.execute(
      { definition: JSON.stringify(HTML_DEFINITION) },
      { toolCallId: 'v1', messages: [] },
    );
    check('skill: a definition can be saved and comes back versioned', saved.success === true && /^[0-9a-f]{16}$/.test(String(saved.version)), String(saved.version));

    const listed: any = await tools.scrape_definitions.execute({}, { toolCallId: 'v2', messages: [] });
    check(
      'skill: the saved definition is listed with its fields',
      listed.success === true && listed.count === 1 && listed.definitions[0].fields.includes('headline'),
      `${listed.count} definition(s)`,
    );

    const first: any = await tools.scrape_run.execute({ name: 'feed-headlines' }, { toolCallId: 'v3', messages: [] });
    check('skill: the run returns structured rows', first.success === true && first.count === 3, `${first.count} rows`);
    check(
      'skill: the report records host, status, cached and rows',
      first.report.pages[0].host === 'example.org' &&
        first.report.pages[0].status === 200 &&
        first.report.pages[0].cached === false &&
        first.report.pages[0].rows === 3,
      JSON.stringify({
        host: first.report.pages[0].host,
        status: first.report.pages[0].status,
        cached: first.report.pages[0].cached,
        rows: first.report.pages[0].rows,
      }),
    );
    check(
      'skill: the sentence says how many pages were read',
      /^I read 1 page.*extracted 3 rows/.test(String(first.message)),
      String(first.message),
    );

    const second: any = await tools.scrape_run.execute({ name: 'feed-headlines' }, { toolCallId: 'v4', messages: [] });
    check('skill: the second run is served from the cache', second.report.cached === 1 && server.calls.length === 1, `${server.calls.length} page request(s), ${second.report.cached} cached`);
    check(
      'skill: the sentence says how many were cached',
      /\(1 from cache\)/.test(String(second.message)),
      String(second.message),
    );

    // A refused page is reported, not retried, and never parsed.
    const refused: any = await tools.scrape_run.execute({ name: 'feed-headlines', urls: ['https://example.org/deny'] }, { toolCallId: 'v5', messages: [] });
    const denyPage = refused.report.pages.find((page: any) => page.url.includes('/deny'));
    check(
      'skill: a robots refusal is reported as a refusal',
      denyPage?.refusal?.kind === 'robots' && /Disallow/.test(String(denyPage?.refusal?.reason)),
      String(denyPage?.refusal?.reason).slice(0, 100),
    );
    check(
      'skill: the refused page was never requested',
      !server.calls.some((url) => url.endsWith('/deny')),
      server.calls.join(', '),
    );

    // Different URLs → different rows, all attributed.
    const twoPages: any = await tools.scrape_run.execute(
      { name: 'feed-headlines', urls: ['https://example.org/feed', 'https://example.org/feed'] },
      { toolCallId: 'v6', messages: [] },
    );
    check(
      'skill: a duplicate URL inside one run is skipped, not re-scraped',
      twoPages.report.duplicates >= 1 && twoPages.count === 3,
      `${twoPages.report.duplicates} duplicate(s), ${twoPages.count} rows`,
    );

    // Metering: one event per page that was actually fetched, never per cache hit.
    check(
      'spend: every page fetch is metered exactly once, as a unit of `page`',
      metered.length === server.calls.length &&
        metered.every((event) => event.unit === 'page' && event.units === 1 && event.service === 'other'),
      `${metered.length} metered page(s) for ${server.calls.length} fetch(es)`,
    );
    check(
      'spend: the metered detail names the URL and the status',
      metered.some((event) => /example\.org\/feed/.test(event.detail) && /HTTP 200/.test(event.detail)),
      metered[0]?.detail ?? '—',
    );

    // An unknown definition fails loudly with what IS stored.
    const missing: any = await tools.scrape_run.execute({ name: 'nope' }, { toolCallId: 'v7', messages: [] });
    check(
      'skill: an unknown definition names the store contents',
      missing.success === false && /no stored definition named "nope"; stored: feed-headlines/.test(String(missing.error)),
      String(missing.error ?? '').slice(0, 110),
    );

    // describeScrapeRun is what the agent says, and it is built from results.
    const sentence = describeScrapeRun({
      definition: 'feed-headlines',
      version: 'x',
      pages: [
        { url: 'https://example.org/feed', finalUrl: 'https://example.org/feed', host: 'example.org', status: 200, classification: 'ok', ok: true, cached: true, attempts: 1, waitedMs: 0, delaysMs: [], robotsReason: null, refusal: null, rows: 3, notes: [] },
        { url: 'https://example.org/deny', finalUrl: 'https://example.org/deny', host: 'example.org', status: null, classification: 'refused', ok: false, cached: false, attempts: 0, waitedMs: 0, delaysMs: [], robotsReason: 'disallowed', refusal: { kind: 'robots', reason: 'Disallow: /deny' }, rows: 0, notes: [] },
      ],
      rows: [],
      read: 1,
      cached: 1,
      fetched: 1,
      refused: 1,
      succeeded: 1,
      duplicates: 0,
      ok: true,
      sentence: '',
      error: null,
      startedAt: 0,
      finishedAt: 1,
    });
    check(
      'report: the sentence mentions pages, rows and the refusal',
      /I read 1 page \(1 from cache\) and extracted 0 rows/.test(sentence) && /refused: example\.org\/deny — robots/.test(sentence),
      sentence,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 11. runScrape guards its own inputs
  // ──────────────────────────────────────────────────────────────────────────
  {
    const store = new MemoryStore();
    await store.save({
      version: 1,
      name: 'too-many',
      format: 'html',
      urls: Array.from({ length: 6 }, (_, index) => `https://example.org/p${index}`),
      rows: { selector: 'article.story' },
      fields: [{ name: 'headline', selector: 'h2' }],
      policy: { maxPages: 3 },
    });
    let message = '';
    try {
      await runScrape({ definitionName: 'too-many', store, resolveHost: resolver });
    } catch (err: any) {
      message = err?.message ?? '';
    }
    check(
      'run: a definition that exceeds policy.maxPages is refused before any request',
      /6 pages requested, but the definition allows 3/.test(message),
      message.slice(0, 100),
    );
  }

  // A definition with a login-walled target is refused, and reports the wall.
  {
    const clock = fakeClock();
    const server = fakeServer(() => ({ status: 200, body: '<form><input type="password" name="pw"></form>' }));
    const { fetchRobots } = fakeRobots({ 'walled.example': 'User-agent: *\nDisallow:' });
    const gate = createRobotsGate({ fetchRobots, now: clock.now });
    const limiter = new HostRateLimiter({ now: clock.now, sleep: clock.sleep });
    const store = new MemoryStore();
    await store.save({
      version: 1,
      name: 'walled-feed',
      format: 'html',
      urls: ['https://walled.example/members'],
      rows: { selector: 'article' },
      fields: [{ name: 'headline', selector: 'h2' }],
    });

    const report = await runScrape({
      definitionName: 'walled-feed',
      store,
      robots: gate,
      limiter,
      fetch: server.fetch,
      resolveHost: resolver,
      now: clock.now,
      sleep: clock.sleep,
      meter: () => {},
    });

    check('run: a login-walled target is refused, not parsed', report.ok === false && report.refused === 1, `refused ${report.refused}`);
    check(
      'run: the report says it was a login wall',
      report.pages[0].refusal?.kind === 'login' && /sign-in page/.test(String(report.pages[0].refusal?.reason)),
      String(report.pages[0].refusal?.reason),
    );
    check('run: no rows were produced from the wall', report.rows.length === 0);
    check('run: the wall was requested once, not retried', report.pages[0].attempts === 1, `${report.pages[0].attempts} attempt(s)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error('verify-scraping crashed:', err?.stack || err?.message || err);
  process.exit(1);
});
