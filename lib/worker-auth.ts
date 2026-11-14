/**
 * Authentication for calls to our own Cloud Run workers (stitcher, renderer).
 *
 * Those services are deployed with `--allow-unauthenticated`, because a Cloud Run service
 * that needs Google ID tokens would force an extra dependency and a credential in the app
 * just to reach our own container. Instead both containers check a shared secret:
 *
 *   - app sets WORKER_SECRET and sends it as `x-worker-secret`
 *   - container reads WORKER_SECRET and rejects anything that does not match
 *
 * The header is only attached when the env var exists, so rolling this out cannot break a
 * deployment that has not been given the secret yet. Setting the secret on the containers
 * is the step that actually closes the door — do that only after the app that sends it is live.
 */
export function workerSecretHeaders(): Record<string, string> {
  const secret = (process.env.WORKER_SECRET || '').trim();
  return secret ? { 'x-worker-secret': secret } : {};
}
