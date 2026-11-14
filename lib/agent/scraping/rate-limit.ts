/**
 * Per-host politeness: a token bucket, a `Retry-After` memory, and a queue that
 * guarantees ONE in-flight request per host.
 *
 * Why all three, and not just a sleep:
 *  - A token bucket is the only shape that lets a burst of N be honest about a
 *    sustained rate. Sleeping `1/rps` between calls is the same thing at burst 1,
 *    and worse for a host that publishes `Crawl-delay: 30`.
 *  - A `429` is not an invitation to retry immediately. `noteRetryAfter()` parks
 *    the whole host until the server said it was ready, so one worker's 429
 *    slows every other worker pointed at that host instead of piling on.
 *  - Two requests in flight to the same host is the difference between "polite"
 *    and "a scraper". The per-host chain serialises them, so a definition with
 *    20 URLs on one host behaves like a reader, not a flood.
 *
 * `now` and `sleep` are injected. That is what makes "it waited 4.2 s" testable
 * in a few milliseconds, and it is why the delays in a verification run are the
 * delays the limiter actually planned, not a second implementation of them.
 */

export type Clock = () => number;
export type Sleeper = (ms: number) => Promise<void>;

export interface HostRatePolicy {
  /** Sustained rate for a host, unless the host's robots.txt says slower. */
  requestsPerSecond: number;
  /** How many requests may go out back-to-back before the rate applies. */
  burst: number;
}

export const DEFAULT_HOST_POLICY: HostRatePolicy = { requestsPerSecond: 1, burst: 1 };

export interface RateWait {
  host: string;
  waitedMs: number;
  /** Time spent behind another request to the same host. */
  queuedMs: number;
  /** Which rule caused the wait, for the log line the agent relays. */
  reason: 'token' | 'cooldown' | 'crawl-delay' | 'none';
}

export interface HostRun<T> {
  result: T;
  waitedMs: number;
  queuedMs: number;
  reason: RateWait['reason'];
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * `Retry-After` as milliseconds from now. Accepts both wire forms: delta-seconds
 * (`120`) and HTTP-date (`Wed, 21 Oct 2015 07:28:00 GMT`). Returns null when the
 * header is absent or unparseable, so the caller falls back to exponential
 * backoff rather than pretending it was told something.
 */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (header === null || header === undefined) return null;
  const text = String(header).trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : null;
  }

  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

/**
 * Exponential backoff with jitter, bounded by `capMs`.
 *
 * `delay(n+1)` is always greater than `delay(n)` while the cap is not reached:
 * the exponential term doubles and the jitter adds at most half of it, so
 * 2n > 1.5n for every n. That is what lets a caller (and a test) say the wait
 * GREW rather than merely changed.
 */
export function backoffDelayMs(
  attempt: number,
  options: { baseMs?: number; capMs?: number; random?: () => number } = {},
): { delayMs: number; exponentialMs: number; jitterMs: number } {
  const baseMs = options.baseMs ?? 500;
  const capMs = options.capMs ?? 8_000;
  const random = options.random ?? Math.random;
  const step = Math.max(1, Math.floor(attempt));
  const exponentialMs = Math.min(capMs, baseMs * Math.pow(2, step - 1));
  const jitterMs = Math.round(random() * exponentialMs * 0.5);
  return { delayMs: Math.min(capMs, exponentialMs + jitterMs), exponentialMs, jitterMs };
}

export class HostRateLimiter {
  private readonly policies = new Map<string, HostRatePolicy>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly cooldowns = new Map<string, number>();
  private readonly lastStart = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly waitLog: RateWait[] = [];

  private readonly defaultPolicy: HostRatePolicy;
  private readonly now: Clock;
  private readonly sleep: Sleeper;
  private readonly random: () => number;
  private readonly maxSleepMs: number;

  constructor(
    options: {
      requestsPerSecond?: number;
      burst?: number;
      now?: Clock;
      sleep?: Sleeper;
      random?: () => number;
      /** A single wait is chunked at this size so a long cooldown stays cancellable. */
      maxSleepMs?: number;
      policyFor?: (host: string) => HostRatePolicy | undefined;
    } = {},
  ) {
    this.defaultPolicy = {
      requestsPerSecond: options.requestsPerSecond ?? DEFAULT_HOST_POLICY.requestsPerSecond,
      burst: options.burst ?? DEFAULT_HOST_POLICY.burst,
    };
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.maxSleepMs = options.maxSleepMs ?? 15_000;
    if (typeof options.policyFor === 'function') this.policyForHook = options.policyFor;
  }

  private policyForHook: ((host: string) => HostRatePolicy | undefined) | null = null;

  policy(host: string): HostRatePolicy {
    return this.policies.get(host) ?? this.policyForHook?.(host) ?? this.defaultPolicy;
  }

  /** Set (or tighten) the policy for one host — a `Crawl-delay` becomes this. */
  setPolicy(host: string, policy: Partial<HostRatePolicy>): HostRatePolicy {
    const merged: HostRatePolicy = { ...this.policy(host), ...policy };
    this.policies.set(host, merged);
    return merged;
  }

  /**
   * Park a host: `429` with `Retry-After: 30` means the next request to it waits
   * at least 30 s, whoever asks.
   */
  noteRetryAfter(host: string, delayMs: number, _reason = '429'): number {
    const until = this.now() + Math.max(0, Math.round(delayMs));
    const existing = this.cooldowns.get(host) ?? 0;
    const next = Math.max(existing, until);
    this.cooldowns.set(host, next);
    return Math.max(0, next - this.now());
  }

  /** Milliseconds until a parked host may be tried again (0 when free). */
  cooldownRemainingMs(host: string): number {
    return Math.max(0, (this.cooldowns.get(host) ?? 0) - this.now());
  }

  /** Every wait this limiter imposed, in order. Read by the run report. */
  waits(): readonly RateWait[] {
    return this.waitLog;
  }

  reset(): void {
    this.policies.clear();
    this.buckets.clear();
    this.cooldowns.clear();
    this.lastStart.clear();
    this.chains.clear();
    this.waitLog.length = 0;
  }

  /**
   * One request to `host`, honouring the bucket, any cooldown and any
   * `Crawl-delay`, and never overlapping another request to the same host.
   */
  async run<T>(
    host: string,
    fn: () => Promise<T>,
    options: { crawlDelayMs?: number | null } = {},
  ): Promise<HostRun<T>> {
    const queuedAt = this.now();
    const previous = this.chains.get(host) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => gate);
    this.chains.set(host, chain);

    await previous;
    const queuedMs = this.now() - queuedAt;

    try {
      const { waitedMs, reason } = await this.waitTurn(host, options.crawlDelayMs ?? null);
      const result = await fn();
      this.waitLog.push({ host, waitedMs, queuedMs, reason });
      return { result, waitedMs, queuedMs, reason };
    } finally {
      release();
      if (this.chains.get(host) === chain) this.chains.delete(host);
    }
  }

  private async waitTurn(host: string, crawlDelayMs: number | null): Promise<{ waitedMs: number; reason: RateWait['reason'] }> {
    const policy = this.policy(host);
    let waitedMs = 0;
    let reason: RateWait['reason'] = 'none';

    for (let guard = 0; guard < 64; guard++) {
      const now = this.now();
      const bucket = this.bucket(host, now);
      const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(policy.burst, bucket.tokens + elapsedSeconds * policy.requestsPerSecond);
      bucket.updatedAt = now;

      const cooldownMs = Math.max(0, (this.cooldowns.get(host) ?? 0) - now);
      const crawlMs =
        crawlDelayMs && crawlDelayMs > 0
          ? Math.max(0, (this.lastStart.get(host) ?? Number.NEGATIVE_INFINITY) + crawlDelayMs - now)
          : 0;
      const tokenMs = bucket.tokens >= 1 ? 0 : Math.ceil((1 - bucket.tokens) / Math.max(0.0001, policy.requestsPerSecond) * 1000);

      const need = Math.max(cooldownMs, crawlMs, tokenMs);
      if (need <= 0) {
        bucket.tokens = Math.max(0, bucket.tokens - 1);
        this.lastStart.set(host, now);
        return { waitedMs, reason };
      }

      if (cooldownMs >= need) reason = 'cooldown';
      else if (crawlMs >= need) reason = 'crawl-delay';
      else reason = 'token';

      const chunk = Math.min(need, this.maxSleepMs);
      await this.sleep(chunk);
      waitedMs += chunk;

      // A well-behaved host that publishes `Crawl-delay: 30` must not be polled
      // faster than that, and the bucket must not let a burst bypass it.
      if (crawlDelayMs && crawlDelayMs > 0 && policy.requestsPerSecond * 1000 > crawlDelayMs) {
        // Slow the sustained rate to the published interval, once.
        this.setPolicy(host, { requestsPerSecond: 1000 / crawlDelayMs });
      }

      if (waitedMs > 10 * 60_000) {
        throw new Error(
          `[rate-limit] ${host} has kept this crawl waiting ${Math.round(waitedMs / 1000)}s ` +
            '(cooldown or Crawl-delay). Refusing to queue longer than ten minutes.',
        );
      }
    }

    throw new Error(`[rate-limit] could not get a turn on ${host} after 64 sleeps`);
  }

  private bucket(host: string, now: number): Bucket {
    const existing = this.buckets.get(host);
    if (existing) return existing;
    const policy = this.policy(host);
    const created: Bucket = { tokens: policy.burst, updatedAt: now };
    this.buckets.set(host, created);
    return created;
  }

  /** A `429` observed outside `run()` (a shared cache, a test, a warm-up probe). */
  observeRateLimit(host: string, retryAfterHeader: string | null | undefined, fallbackMs = 1_000): number {
    const parsed = parseRetryAfter(retryAfterHeader ?? null, this.now());
    return this.noteRetryAfter(host, parsed ?? fallbackMs);
  }

  /** Jittered, bounded backoff — exposed here so one attempt count means one delay. */
  backoff(attempt: number, options: { baseMs?: number; capMs?: number } = {}): number {
    return backoffDelayMs(attempt, { ...options, random: this.random }).delayMs;
  }
}

/** The whole-policy default: one request at a time, one per second per host. */
export function createHostRateLimiter(options?: ConstructorParameters<typeof HostRateLimiter>[0]): HostRateLimiter {
  return new HostRateLimiter(options);
}
