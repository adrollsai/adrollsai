/**
 * Turning Meta's Graph errors into something an agent — or a person — can act on.
 *
 * THE FAILURE THIS FIXES
 * A live client's campaign launch came back as, in full:
 *
 *     Campaign creation error: Invalid parameter
 *
 * That is `error.message` and nothing else. Meta had said much more in the same JSON —
 * which field was wrong and why — and we threw all of it away, so the agent could only
 * report that something was invalid and stop. It was right to stop: staging a third
 * approval card on unchanged arguments would have been guessing with the owner's money.
 * But the dead end was ours, not Meta's.
 *
 * `blame_field_specs` names the offending parameter. `error_user_title` and
 * `error_user_msg` are Meta's own plain-language explanation. `error_subcode` and
 * `fbtrace_id` are what their support asks for. All of it travels now.
 */

/** The parts of a Graph error payload worth keeping. */
export interface MetaErrorShape {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  error_data?: { blame_field_specs?: Array<{ field?: string; name?: string }>; details?: string };
  fbtrace_id?: string;
}

/** Pull a Graph error object out of whatever shape the caller is holding. */
export function extractMetaError(payload: unknown): MetaErrorShape | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = (payload as any).error;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as MetaErrorShape;
}

/**
 * One sentence that names the parameter and quotes Meta's own explanation.
 *
 * Returns null when there is no Graph error in the payload, so callers can keep their
 * existing success path unchanged.
 */
export function describeMetaError(payload: unknown, action = 'Meta rejected the request'): string | null {
  const error = extractMetaError(payload);
  if (!error) return null;

  const blamed = (error.error_data?.blame_field_specs ?? [])
    .map((spec) => String(spec?.field ?? spec?.name ?? '').trim())
    .filter(Boolean);

  const parts: string[] = [];
  parts.push(String(error.message || 'no message').trim());

  if (error.error_user_title || error.error_user_msg) {
    parts.push(
      [error.error_user_title, error.error_user_msg]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join(': ')
    );
  }
  if (blamed.length) parts.push(`field: ${blamed.join(', ')}`);
  if (error.error_data?.details) parts.push(String(error.error_data.details).trim());

  const codes: string[] = [];
  if (error.code !== undefined) codes.push(`code ${error.code}`);
  if (error.error_subcode !== undefined) codes.push(`subcode ${error.error_subcode}`);
  if (error.fbtrace_id) codes.push(`trace ${error.fbtrace_id}`);

  const head = `${action}: ${parts.filter(Boolean).join(' — ')}`;
  return codes.length ? `${head} (${codes.join(', ')})` : head;
}

/**
 * Every Meta error on the request, formatted for a tool result.
 *
 * `reason` is the machine-readable hint the agent should branch on, because the fix
 * differs by cause: a permissions gap needs the owner to reconnect, a parameter error
 * needs different arguments, and a policy rejection needs a different ad.
 */
export function classifyMetaError(payload: unknown): {
  reason: 'permissions' | 'parameter' | 'policy' | 'rate_limit' | 'auth' | 'unknown';
  /** True when retrying the identical request cannot help. */
  permanent: boolean;
} {
  const error = extractMetaError(payload);
  if (!error) return { reason: 'unknown', permanent: false };

  const text = `${error.message || ''} ${error.error_user_title || ''} ${error.error_user_msg || ''}`.toLowerCase();
  const code = Number(error.code ?? 0);

  // 190 is an invalid/insufficient token. 200/10 are permission errors. These need a
  // human to reconnect the account; the same call will fail identically forever.
  if (code === 190 || code === 102 || /access token|page access token/.test(text)) {
    return { reason: 'permissions', permanent: true };
  }
  if (code === 200 || code === 10 || /permission/.test(text)) {
    return { reason: 'permissions', permanent: true };
  }
  if (code === 100 || /invalid parameter/.test(text)) {
    return { reason: 'parameter', permanent: true };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || /rate limit|too many calls/.test(text)) {
    return { reason: 'rate_limit', permanent: false };
  }
  if (/policy|not eligible|no longer available/.test(text)) {
    return { reason: 'policy', permanent: true };
  }
  if (code === 1 || code === 2) return { reason: 'auth', permanent: false };
  return { reason: 'unknown', permanent: false };
}
