# `scrape` skill — stored definition → polite fetch → rows → an honest report

Reads a page the way a well-behaved crawler would: `robots.txt` first, one
request at a time per host, an honest `User-Agent`, and a hard stop the moment a
site says no. Returns structured rows plus a record of every page — host, status,
cached or not, rows — so the agent can say "I read 3 pages, 2 were cached"
without inventing it.

```
definition (stored, versioned) ──┐
inputs ──────────────────────────┴─▶ definitionUrls ──▶ politeFetch ──▶ cache ──▶ rows
                                                          │
                        ssrf guard ─ robots ─ rate limit ─┤
                                                        └─▶ refused? report it, stop
```

| file | what it owns |
|---|---|
| `lib/agent/scraping/robots.ts` | parse `robots.txt`, `Allow`/`Disallow` precedence, `Crawl-delay`, per-host TTL cache |
| `lib/agent/scraping/rate-limit.ts` | per-host token bucket, one in-flight per host, `Retry-After`, exponential backoff with jitter |
| `lib/agent/scraping/fetch.ts` | SSRF guard (every hop), honest UA, classification, retry on 429/5xx only |
| `lib/agent/scraping/extract.ts` | the stored definition format, HTML selector subset, JSON path subset, pure extraction, definition stores |
| `lib/agent/scraping/cache.ts` | R2 cache keyed by `hash(url + definition version)`, with a TTL |
| `lib/agent/scraping/index.ts` | `runScrape`, metering, and `describeScrapeRun` (the sentence) |
| `lib/agent/tools/skills/scrape/index.ts` | the agent tools: `scrape_definitions`, `scrape_save_definition`, `scrape_run` |

## The definition format

```json
{
  "version": 1,
  "name": "newsroom-headlines",
  "description": "Headlines from a public newsroom index page",
  "format": "html",
  "urlTemplate": "https://example.org/{section}",
  "inputs": ["section"],
  "rows": { "selector": "article.story", "limit": 25 },
  "fields": [
    { "name": "headline", "selector": "h2 a" },
    { "name": "link", "selector": "h2 a", "attribute": "href", "resolve": true },
    { "name": "summary", "selector": "p.lede", "optional": true }
  ]
}
```

`format: "json"` swaps `rows.selector` for `rows.path` (`$.items[*]`) and each
field's `selector` for a `path` (`title`, `attributes.url`). Supported selector
syntax is `tag`, `.class`, `#id`, `[attr]`, `[attr=value]` and descendant chains;
`>`, `+`, `~` and `,` are rejected loudly rather than half-honoured. Paths support
`.name`, `[0]` and `[*]`.

A field is **required unless `optional: true`**. A required field that produces
nothing throws `ExtractionError` naming the field, the row and the selector — no
partial rows. `version` of a definition (its fingerprint, 16 hex chars) is what
the cache is keyed by, so editing a selector means a new cache entry, and
re-running an unchanged definition inside the window costs the site nothing.

Definitions live in `agent_scrape_definitions` (see
`sql/migrations/18_scrape_definitions.sql`) when the process has Supabase
credentials, and as files under `.nobogent/scraping/definitions/` otherwise.

## What is refused, and how

| condition | outcome |
|---|---|
| `robots.txt` disallows the path | `refused: robots`, **no page request made** |
| `robots.txt` unreachable / 5xx | `refused: robots` (RFC 9309: assume disallow) |
| `file:`, `data:`, non-http scheme | `refused: scheme` |
| `localhost`, `*.local`, `127.0.0.0/8`, `10/8`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7` … | `refused: ssrf`, before any request |
| a redirect to any of the above | `refused: redirect`, at the hop |
| 401 / 403 | `refused: auth`, not retried, not worked around |
| 200 that is a sign-in page (password field, "sign in to continue") | `refused: login` |
| 200 that is a CAPTCHA / bot challenge | `refused: captcha` |
| 429 | honoured `Retry-After` or exponential backoff, bounded attempts, then `rate_limited` |
| 5xx | exponential backoff, bounded attempts, then `server_error` |
| other 4xx | `client_error`, not retried |

No cookie jar, no credential, no solver, no browser impersonation: on every
refusal `body` is `null`, so nothing downstream can parse a wall as content.

## The call

```ts
const report = await runScrape({ definitionName: 'newsroom-headlines', inputs: { section: 'world' } });
report.rows;     // [{ headline, link, summary, _source }, …]
report.sentence; // "I read 1 page and extracted 12 rows."
```

Every page request is metered through `lib/agent/spend.ts` (`recordSpend`, service
`other`, unit `page`), priced at `SCRAPE_INR_PER_PAGE` (default 0 = recorded but
unpriced) so a scrape appears in the same ledger as a model call.

`npm run verify:scraping` proves the whole thing offline with an injected fetch,
clock, R2 and meter.
