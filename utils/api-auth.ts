/**
 * One way to identify the caller, for routes that must work from the native app.
 *
 * The Flutter/Capacitor client has no cookie jar, so every route that used only
 * `createClient()` + `auth.getUser()` was unreachable from it — including payment
 * verification and onboarding completion, i.e. the two routes that make money.
 *
 * Order matters: a Bearer token is explicit and comes from the app, so it is
 * checked first; the cookie session is the web fallback.
 */
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/utils/supabase/server';

export interface RequestAuth {
  user: { id: string; email?: string | null } | null;
  source: 'bearer' | 'cookie' | null;
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Resolve the caller from `Authorization: Bearer <access_token>` or the session
 * cookie. Returns `user: null` when neither works — callers must answer 401.
 */
export async function resolveRequestUser(request: Request): Promise<RequestAuth> {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const admin = adminClient();
        const { data, error } = await admin.auth.getUser(token);
        if (!error && data?.user) {
          return { user: { id: data.user.id, email: data.user.email }, source: 'bearer' };
        }
      } catch {
        /* fall through to the cookie path */
      }
    }
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return { user: { id: user.id, email: user.email }, source: 'cookie' };
  } catch {
    /* no session */
  }

  return { user: null, source: null };
}

/**
 * Same contract, but throws a Response-shaped error the route can return.
 * Convenience for the common `if (!user) return unauthorized()` shape.
 */
export function unauthorized(message = 'Unauthorized') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
