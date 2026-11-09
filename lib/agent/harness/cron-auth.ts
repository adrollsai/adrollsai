/**
 * Cron/operator authentication with support for a zero-downtime secret rotation.
 *
 * Why this exists rather than a plain `=== process.env.CRON_SECRET` check:
 * Vercel snapshots environment variables per deployment, and its cron
 * infrastructure sends `Authorization: Bearer <current CRON_SECRET>`. So if you
 * change the value, the live deployment still holds the OLD value while the
 * header carries the NEW one — every cron call 401s until a new deployment
 * takes over.
 *
 * Accepting two secrets removes that window:
 *
 *   1. Set `CRON_SECRET` = old and `CRON_SECRET_NEXT` = new, then deploy.
 *      Both values are now in the deployment's snapshot; cron still sends old. ✓
 *   2. Set `CRON_SECRET` = new, delete `CRON_SECRET_NEXT`, deploy again.
 *      During the gap the live deployment sends new and — because its snapshot
 *      still holds NEXT = new — accepts it. ✓  No 401 window.
 *   3. Afterwards the deployment carries only the new secret.
 */

function normalise(value: string | undefined | null): string | null {
  const clean = (value || '').replace(/^["']|["']$/g, '').trim();
  return clean || null;
}

/** Every value we will currently accept. Empty when nothing is configured. */
export function acceptedCronSecrets(): string[] {
  return [normalise(process.env.CRON_SECRET), normalise(process.env.CRON_SECRET_NEXT)].filter(
    (v): v is string => Boolean(v)
  );
}

/** Extract the bearer value from the Authorization header or `?cronSecret=`. */
export function presentedCronSecret(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (header) {
    const bearer = header.replace(/^Bearer\s+/i, '').trim();
    if (bearer) return bearer;
  }
  const fromQuery = new URL(req.url).searchParams.get('cronSecret');
  return fromQuery ? fromQuery.trim() : null;
}

export type CronAuthResult = 'ok' | 'not-configured' | 'unauthorized';

/** Constant-time-ish comparison so a wrong secret does not leak its prefix. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorizeCronRequest(req: Request): CronAuthResult {
  const accepted = acceptedCronSecrets();
  if (!accepted.length) return 'not-configured';

  const presented = presentedCronSecret(req);
  if (!presented) return 'unauthorized';

  return accepted.some((secret) => safeEqual(presented, secret)) ? 'ok' : 'unauthorized';
}

/**
 * Standard guard for cron/operator routes. Returns a Response to send back when
 * the request must be rejected, or null when it may proceed.
 */
export function cronAuthGuard(req: Request): Response | null {
  const result = authorizeCronRequest(req);
  if (result === 'ok') return null;
  if (result === 'not-configured') {
    return Response.json(
      { error: 'CRON_SECRET is not configured; refusing to run.' },
      { status: 503 }
    );
  }
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
