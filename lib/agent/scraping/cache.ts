/**
 * The raw-response cache: R2, keyed by a hash of the URL **and the definition
 * version**, with a TTL.
 *
 * Two things that look like details and are not:
 *
 *  1. THE DEFINITION VERSION IS IN THE KEY. A page cached by `headlines@v1` is
 *     not a valid cache entry for `headlines@v2`: the second definition exists
 *     precisely because the first one extracted the wrong thing. Keying on the
 *     URL alone would serve yesterday's parse of a changed definition and make
 *     the diff a lie.
 *
 *  2. THE BODY IS STORED RAW. Extraction runs on every request against the
 *     cached bytes, so a definition can be re-run and diffed inside the cache
 *     window without touching the host again — and a parse bug does not require
 *     re-scraping a site to fix.
 *
 * The envelope carries `expiresAt`, so the TTL survives the process: a body
 * cached an hour ago is not served just because this worker has never seen it.
 *
 * R2 access reuses the app's single S3 client in `utils/r2.ts` (no second
 * client, no second credential path), imported lazily so this module — and the
 * offline verification — never needs AWS in scope.
 */

import { createHash } from 'node:crypto';

/** One cached response, exactly as it will be read back. */
export interface CachedResponse {
  url: string;
  /** Fingerprint of the definition that asked for it. */
  definitionVersion: string;
  status: number;
  contentType: string | null;
  body: string;
  /** R2 key the body lives under. */
  key: string;
  fetchedAt: number;
  expiresAt: number;
}

/** The seam. Tests inject a fake; production injects R2. */
export interface ScrapeCache {
  get(key: string): Promise<CachedResponse | null>;
  put(key: string, entry: CachedResponse): Promise<void>;
}

export const CACHE_KEY_PREFIX = 'scrape/cache/v1';
export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60_000; // six hours

/**
 * The R2 key for one (url, definition version) pair.
 *
 * The hash is over `url \n version`, so a change to either moves the key and an
 * unchanged pair always lands on the same object. The `.json` suffix is the
 * envelope's format, not the page's.
 */
export function cacheKeyFor(url: string, definitionVersion: string, prefix = CACHE_KEY_PREFIX): string {
  const digest = sha256Hex(`${normaliseUrl(url)}\n${definitionVersion}`);
  return `${prefix.replace(/\/+$/, '')}/${digest}.json`;
}

/** `HTTP://Example.com:80/a?b=1#frag` and `http://example.com/a?b=1` are one page. */
export function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }
    return parsed.toString();
  } catch {
    return String(url);
  }
}

export function isFresh(entry: Pick<CachedResponse, 'expiresAt'>, now = Date.now()): boolean {
  return entry.expiresAt > now;
}

/**
 * The cache read, with the TTL applied and a corrupt entry treated as a miss.
 *
 * A corrupt envelope must never break a scrape: an unreadable object in R2 is
 * the same problem as an absent one, and the polite answer is to fetch the page.
 */
export async function readCache(
  cache: ScrapeCache,
  key: string,
  now = Date.now(),
): Promise<{ entry: CachedResponse | null; stale: boolean; corrupt: boolean }> {
  const entry = await cache.get(key);
  if (!entry) return { entry: null, stale: false, corrupt: false };
  if (!entry.body || typeof entry.body !== 'string' || !Number.isFinite(entry.expiresAt)) {
    return { entry: null, stale: false, corrupt: true };
  }
  if (!isFresh(entry, now)) return { entry, stale: true, corrupt: false };
  return { entry, stale: false, corrupt: false };
}

/** Serialise an envelope for R2. */
export function envelopeBody(entry: CachedResponse): string {
  return JSON.stringify(entry);
}

/** Parse an R2 object back into an envelope; null when it is not one. */
export function parseEnvelope(text: string): CachedResponse | null {
  try {
    const parsed = JSON.parse(text) as CachedResponse;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.body !== 'string' || typeof parsed.url !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Where the bytes go. Injected so R2 is one implementation, not the only one. */
export interface ObjectStore {
  getText(key: string): Promise<string | null>;
  putText(key: string, body: string, contentType: string): Promise<void>;
}

/** The real one: the app bucket through `utils/r2.ts`. */
export function r2ObjectStore(): ObjectStore {
  return {
    async getText(key: string) {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { r2, R2_BUCKET } = await import('../../../utils/r2');
      try {
        const response = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        const body = response.Body as unknown as { transformToString?: () => Promise<string> } | undefined;
        if (!body || typeof body.transformToString !== 'function') return null;
        return await body.transformToString();
      } catch (err: any) {
        const name = String(err?.name || '');
        const status = Number(err?.$metadata?.httpStatusCode ?? 0);
        if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) return null;
        throw err;
      }
    },

    async putText(key: string, body: string, contentType: string) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { r2, R2_BUCKET } = await import('../../../utils/r2');
      await r2.send(
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
      );
    },
  };
}

/**
 * The R2-backed cache.
 *
 * Read and write failures are logged, not thrown: a scrape that fetched the page
 * has already paid for it, and losing the cache write must not throw the work
 * away. A failed READ is a miss (fetch again); a failed WRITE is the same as
 * never having cached (the next run pays again) — both are the safe direction.
 */
export class R2ScrapeCache implements ScrapeCache {
  readonly stats = { hits: 0, misses: 0, puts: 0, errors: 0 };

  constructor(
    private readonly store: ObjectStore = r2ObjectStore(),
    private readonly logger: (event: string, data?: Record<string, unknown>) => void = () => {},
  ) {}

  async get(key: string): Promise<CachedResponse | null> {
    try {
      const text = await this.store.getText(key);
      if (text === null) {
        this.stats.misses++;
        return null;
      }
      const entry = parseEnvelope(text);
      if (!entry) {
        this.stats.errors++;
        this.logger('scrape.cache.corrupt', { key });
        this.stats.misses++;
        return null;
      }
      this.stats.hits++;
      return entry;
    } catch (err: any) {
      this.stats.errors++;
      this.logger('scrape.cache.read_failed', { key, error: err?.message ?? String(err) });
      this.stats.misses++;
      return null;
    }
  }

  async put(key: string, entry: CachedResponse): Promise<void> {
    try {
      await this.store.putText(key, envelopeBody(entry), 'application/json');
      this.stats.puts++;
    } catch (err: any) {
      this.stats.errors++;
      this.logger('scrape.cache.write_failed', { key, error: err?.message ?? String(err) });
    }
  }
}

/**
 * An in-process cache with the same semantics.
 *
 * Used by the offline verification, and as the fallback when the process has no
 * R2 credentials: a scrape inside one serverless invocation still must not read
 * the same page twice.
 */
export class MemoryScrapeCache implements ScrapeCache {
  readonly stats = { hits: 0, misses: 0, puts: 0 };
  private readonly objects = new Map<string, string>();

  async get(key: string): Promise<CachedResponse | null> {
    const text = this.objects.get(key);
    if (text === undefined) {
      this.stats.misses++;
      return null;
    }
    const entry = parseEnvelope(text);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return entry;
  }

  async put(key: string, entry: CachedResponse): Promise<void> {
    this.objects.set(key, envelopeBody(entry));
    this.stats.puts++;
  }

  /** Every key currently stored — the cheap way to prove twice-hit-once-put. */
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

/** R2 when this process can reach it, memory otherwise. Never throws. */
export function defaultScrapeCache(
  logger?: (event: string, data?: Record<string, unknown>) => void,
): ScrapeCache {
  const hasR2 = Boolean(
    (process.env.R2_ENDPOINT || '').trim() && (process.env.R2_ACCESS_KEY_ID || '').trim(),
  );
  return hasR2 ? new R2ScrapeCache(r2ObjectStore(), logger) : new MemoryScrapeCache();
}

/** A stable content hash — the definition fingerprint and the cache key both use it. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
