/**
 * LIVE acceptance for the scraping capability. Real network, real servers, a
 * handful of requests in total.
 *
 * What it proves, in this order:
 *
 *  1. RETRY/BACKOFF against a real server that returns 429 (`httpbin.org`), with
 *     the real clock — the delays printed are the delays it actually waited.
 *  2. THREE permitted sources scraped for real, each with the robots.txt decision
 *     quoted verbatim: a public news RSS feed, a standards-body page, and
 *     `example.com` (whose robots.txt is a 404, i.e. nothing published to obey).
 *  3. A REFUSAL that is a valid result: `httpbin.org/deny`, which its own
 *     robots.txt disallows. The page must never be requested.
 *  4. THE R2 CACHE: the same URL twice, one request, one PUT, one hit — using the
 *     real bucket when this process has credentials for it.
 *
 * Request budget: ~6 page requests and ~5 robots.txt reads, one at a time per
 * host, with `Crawl-delay` honoured where a host publishes one. Nothing here is
 * login-walled, and nothing is retried past three attempts.
 *
 *   npm run accept:scraping      (esbuild bundle -> node, see package.json)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import {
  cacheKeyFor,
  createRobotsGate,
  createScrapeFetch,
  defaultScrapeCache,
  definitionVersion,
  describeScrapeRun,
  extractRows,
  parseDefinition,
  politeFetch,
  runScrape,
  scrapeUserAgent,
  HostRateLimiter,
  R2ScrapeCache,
  type ScrapeDefinition,
  type ScrapeMeterEvent,
  type ScrapePageResult,
} from '../lib/agent/scraping';

const USER_AGENT = scrapeUserAgent({ contactUrl: 'https://nobogent.com/scraping-policy' });
const metered: ScrapeMeterEvent[] = [];

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(22)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

function header(text: string) {
  console.log(`\n${'─'.repeat(78)}\n${text}\n${'─'.repeat(78)}`);
}

/** The real rate limiter: 1 request/second/host, burst 1, real sleeps. */
function realLimiter() {
  return new HostRateLimiter({ requestsPerSecond: 1, burst: 1 });
}

function describePage(page: ScrapePageResult) {
  line('robots.txt', page.robots?.reason ?? '—');
  line('robots status', page.robots?.robotsStatus ?? '—');
  line('crawl-delay', page.robots?.crawlDelayMs ?? 'none published');
  line('http status', page.status ?? '—');
  line('classification', page.classification);
  line('attempts', page.attempts);
  line('retry delays (ms)', page.delays.map((delay) => `${delay.delayMs}/${delay.reason}`).join(', ') || 'none');
  line('rate-limit wait (ms)', page.waitedMs);
  line('cached', page.cached);
  line('bytes', page.bytes);
  if (page.refusal) line('refusal', `${page.refusal.kind}: ${page.refusal.reason}`);
  for (const note of page.notes) console.log(`  · ${note}`);
}

function showRows(rows: Record<string, unknown>[], limit = 5) {
  console.log(`  rows extracted (${rows.length}), first ${Math.min(limit, rows.length)}:`);
  for (const row of rows.slice(0, limit)) {
    const copy: Record<string, unknown> = { ...row };
    delete copy._source;
    const text = Object.entries(copy)
      .map(([key, value]) => `${key}=${value === null ? 'null' : String(value).slice(0, 70)}`)
      .join(' | ');
    console.log(`    • ${text}`);
  }
}

async function main() {
  header('LIVE ACCEPTANCE — polite scraping, real servers');
  line('User-Agent', USER_AGENT);
  line('page request budget', 'about 6, plus robots.txt reads');

  const cache = defaultScrapeCache();
  line('cache backend', cache instanceof R2ScrapeCache ? 'R2 (real bucket)' : 'in-process memory (no R2 creds here)');
  if (cache instanceof R2ScrapeCache) console.log('    (R2 was configured, so the live cache proof below uses the real bucket)');

  const robots = createRobotsGate({ userAgent: USER_AGENT });
  const limiter = realLimiter();
  const meter = (event: ScrapeMeterEvent) => {
    metered.push(event);
    console.log(`  ₹ metered: ${event.detail} [unit=${event.unit} units=${event.units}]`);
  };

  const deps = { fetch: createScrapeFetch(), robots, limiter, cache, userAgent: USER_AGENT, meter, log: () => {} };

  // ────────────────────────────────────────────────────────────────────────
  // 1. A real 429, honoured with real backoff
  // ────────────────────────────────────────────────────────────────────────
  header('1. RETRY / BACKOFF against a real 429');
  const target429 = 'https://httpbin.org/status/429';
  const robots429 = await robots.check(target429, USER_AGENT);
  line('target', target429);
  line('robots.txt says', robots429.reason);
  if (robots429.crawlDelayMs) line('crawl-delay', `${robots429.crawlDelayMs} ms`);

  const started429 = Date.now();
  const result429 = await politeFetch(
    { url: target429, definition: 'acceptance-429' },
    { ...deps, maxAttempts: 3, backoffBaseMs: 500, backoffCapMs: 4000, limiter: realLimiter() },
  );
  const elapsed429 = Date.now() - started429;

  console.log('');
  describePage(result429);
  line('wall clock elapsed', `${elapsed429} ms`);
  const delaysGrew = result429.delays.length >= 2 && result429.delays[1].delayMs > result429.delays[0].delayMs;
  line('delays grew?', delaysGrew ? 'yes — exponential' : 'NO (only one retry, so nothing to compare)');
  line('requests made', result429.attempts);

  // ────────────────────────────────────────────────────────────────────────
  // 2. Three permitted sources, scraped for real
  // ────────────────────────────────────────────────────────────────────────
  header('2. THREE PERMITTED SOURCES');

  const definitions = {
    'example-domain': parseDefinition({
      version: 1,
      name: 'example-domain',
      description: 'The notice paragraph on example.com (the page has no h1)',
      format: 'html',
      urls: ['https://example.com/'],
      rows: { selector: 'body', limit: 1 },
      fields: [
        { name: 'notice', selector: 'p' },
        { name: 'code_sample', selector: 'code', optional: true },
      ],
    }) as ScrapeDefinition,

    'iana-example-domains': parseDefinition({
      version: 1,
      name: 'iana-example-domains',
      description: 'Navigation list items from the IANA page about example domains',
      format: 'html',
      urls: ['https://www.iana.org/help/example-domains'],
      rows: { selector: 'li', limit: 8 },
      fields: [
        { name: 'label', selector: ':self' },
        { name: 'href', selector: 'a', attribute: 'href', optional: true, resolve: true },
      ],
    }) as ScrapeDefinition,

    'bbc-news-rss': parseDefinition({
      version: 1,
      name: 'bbc-news-rss',
      description: 'Items from the public BBC News RSS feed',
      format: 'html',
      urls: ['https://feeds.bbci.co.uk/news/rss.xml'],
      rows: { selector: 'item', limit: 5 },
      fields: [
        { name: 'headline', selector: 'title' },
        { name: 'link', selector: 'link', optional: true },
        { name: 'published', selector: 'pubDate', optional: true },
      ],
    }) as ScrapeDefinition,
  };

  for (const [name, definition] of Object.entries(definitions)) {
    header(`source: ${name}`);
    const url = (definition.urls ?? [])[0];
    const decision = await robots.check(url, USER_AGENT);
    line('url', url);
    line('definition version', definitionVersion(definition));
    line('robots.txt decision', decision.allowed ? 'ALLOWED' : 'REFUSED');
    line('robots.txt reason', decision.reason);
    line('robots.txt status', decision.robotsStatus ?? '—');
    line('crawl-delay', decision.crawlDelayMs === null ? 'none published' : `${decision.crawlDelayMs} ms`);

    if (!decision.allowed) {
      console.log('  → refused by robots.txt; not requesting this page at all.');
      continue;
    }

    const page = await politeFetch(
      { url, definition: definition.name, definitionVersion: definitionVersion(definition) },
      { ...deps, cacheTtlMs: 30 * 60_000 },
    );
    console.log('');
    describePage(page);

    if (page.ok && page.body) {
      try {
        const rows = extractRows(definition, page.body, { url: page.finalUrl });
        showRows(rows as unknown as Record<string, unknown>[]);
      } catch (err: any) {
        console.log(`  extraction failed: ${err?.message ?? err}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. A refusal that is a valid result
  // ────────────────────────────────────────────────────────────────────────
  header('3. A REFUSAL (robots.txt) — no request made');
  const denied = 'https://httpbin.org/deny';
  const decisionDenied = await robots.check(denied, USER_AGENT);
  const deniedResult = await politeFetch(
    { url: denied, definition: 'acceptance-refusal' },
    { ...deps, limiter: realLimiter() },
  );
  line('url', denied);
  line('robots.txt file', (await robotsRobotsText(denied, USER_AGENT)).trim().replace(/\n/g, ' | '));
  line('robots.txt decision', decisionDenied.allowed ? 'ALLOWED' : 'REFUSED');
  line('robots.txt reason', decisionDenied.reason);
  line('http status', deniedResult.status ?? 'none — no request was made');
  line('requests made', deniedResult.attempts);
  line('refusal', deniedResult.refusal ? `${deniedResult.refusal.kind}: ${deniedResult.refusal.reason}` : '—');

  // ────────────────────────────────────────────────────────────────────────
  // 4. The cache: the same URL twice, one request
  // ────────────────────────────────────────────────────────────────────────
  header('4. CACHE — the same URL twice inside the TTL');
  const cacheUrl = 'https://example.com/';
  const version = definitionVersion(definitions['example-domain']);
  const key = cacheKeyFor(cacheUrl, version);
  line('cache key', key);
  const statsBefore = cache instanceof R2ScrapeCache ? { ...cache.stats } : null;
  // `fresh: true` skips the READ (so this proves a PUT then a HIT in one run)
  // but still writes the object, exactly as a first-ever scrape would.
  const firstRead = await politeFetch(
    { url: cacheUrl, definition: 'acceptance-cache', definitionVersion: version, fresh: true },
    { ...deps, limiter: realLimiter(), cacheTtlMs: 30 * 60_000 },
  );
  const statsMid = cache instanceof R2ScrapeCache ? { ...cache.stats } : null;
  const secondRead = await politeFetch(
    { url: cacheUrl, definition: 'acceptance-cache', definitionVersion: version },
    { ...deps, limiter: realLimiter(), cacheTtlMs: 30 * 60_000 },
  );
  const statsAfter = cache instanceof R2ScrapeCache ? { ...cache.stats } : null;
  line('first read (fresh: true)', `cached=${firstRead.cached} status=${firstRead.status} attempts=${firstRead.attempts}`);
  line('second read', `cached=${secondRead.cached} status=${secondRead.status} attempts=${secondRead.attempts}`);
  if (statsBefore && statsMid && statsAfter) {
    line('R2 before this run', statsBefore);
    line('R2 after first read', statsMid);
    line('R2 after second read', statsAfter);
    line(
      'PUTs / hits added here',
      `${statsMid.puts - statsBefore.puts} PUT, ${statsAfter.hits - statsMid.hits} hit`,
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. The end-to-end report through runScrape (stored definitions on disk)
  // ────────────────────────────────────────────────────────────────────────
  header('5. END TO END — runScrape with a stored definition (cache warm)');
  const report = await runScrape({
    definition: definitions['example-domain'],
    cache,
    robots,
    limiter: realLimiter(),
    userAgent: USER_AGENT,
    cacheTtlMs: 30 * 60_000,
    meter,
    log: () => {},
  });
  line('rows', report.rows.length);
  line('pages read', report.read);
  line('pages cached', report.cached);
  line('refused', report.refused);
  line('sentence', report.sentence);
  showRows(report.rows as unknown as Record<string, unknown>[]);

  header('METERING (what lib/agent/spend.ts received)');
  if (!metered.length) {
    console.log('  nothing metered — that would be a bug, every page read must be recorded');
  } else {
    for (const event of metered) console.log(`  • ${event.unit} × ${event.units} — ${event.detail}`);
  }
  console.log(`\nTotal page reads metered: ${metered.length}`);
}

/** Read a host's robots.txt verbatim, so the report can quote it. */
async function robotsRobotsText(url: string, userAgent: string): Promise<string> {
  const origin = new URL(url).origin;
  const response = await fetch(`${origin}/robots.txt`, {
    headers: { 'User-Agent': userAgent },
  });
  if (!response.ok) return `HTTP ${response.status} (no robots.txt published)`;
  return response.text();
}

main().catch((err) => {
  console.error('live acceptance crashed:', err?.stack || err?.message || err);
  process.exit(1);
});

// `describeScrapeRun` is exercised through runScrape's sentence; referenced here
// so a bundler cannot tree-shake the report helper out of this proof.
void describeScrapeRun;
