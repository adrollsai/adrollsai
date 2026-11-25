/**
 * The database client a harness request should actually read and write with.
 *
 * THE BUG THIS FIXES
 * The agent tab showed NOTHING when a super admin impersonated a client. Every harness table is
 * locked by row-level security to `auth.uid() = user_id` (verified against the live policies):
 *
 *   harness_sessions    ALL    USING (auth.uid() = user_id)
 *   harness_workspaces  ALL    USING (auth.uid() = user_id)
 *   harness_runs        SELECT USING (auth.uid() = user_id)
 *
 * The routes DID resolve the impersonated account correctly — `resolveActingUser` proved the caller
 * may act for it — and then read with the caller's own cookie client anyway. So the query asked for
 * rows owned by the impersonated account and RLS returned none: an empty sidebar, an empty
 * transcript, and no error to explain it. The impersonation was real and invisible at the same time.
 *
 * WHY A SERVICE-ROLE CLIENT IS THE RIGHT ANSWER HERE
 * Authorisation has already happened, by the time this is called, in `resolveActingUser`: a caller
 * may only reach this branch after `canActForUser` has confirmed the relationship. That is exactly
 * the pattern the rest of the app already uses for cross-account reads (see
 * app/api/agent/v2/../meta-ads/page-lead-forms, which authorises then reads with the admin client).
 *
 * WHAT IT COSTS, AND HOW THAT IS PAID FOR
 * A service-role client bypasses RLS, so tenant isolation becomes the caller's responsibility
 * instead of the database's. Every store function this feeds therefore has to scope by the ACTING
 * user id, and they do:
 *
 *   listSessions / listWorkspaces / createSession / loadSession / renameSession / deleteSession
 *     all filter or insert on `user_id`
 *   loadEvents / setSessionStatus
 *     do NOT — they take only a session id, so any route that reaches them under impersonation must
 *     prove the session belongs to the acting account FIRST (see sessions/[id]/events).
 *
 * Nothing changes for a normal request: when there is no impersonation this returns the caller's own
 * client and RLS keeps doing the work.
 */
import { createClient as createServerClient } from '@/utils/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/** A service-role client. Returns null when the environment cannot supply one. */
export function serviceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Required lazily: the anon/server client path must not pay for this import.
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * The client to use for harness data, given who is calling and who they are acting for.
 *
 * Falls back to the caller's own client if no service-role key is configured: impersonation would
 * then show an empty tab again, but it can never be WIDER than the caller's own permissions.
 */
export async function harnessDataClient(
  callerClient: SupabaseClient,
  callerId: string,
  actingUserId: string
): Promise<SupabaseClient> {
  if (!actingUserId || actingUserId === callerId) return callerClient;
  const admin = serviceRoleClient();
  if (!admin) {
    console.warn(
      '[Harness] impersonating but no SUPABASE_SERVICE_ROLE_KEY is configured — the impersonated account will appear empty.'
    );
    return callerClient;
  }
  return admin;
}

/** Convenience: the caller's own client plus the id they are acting for, in one call. */
export async function harnessClientFor(callerId: string, actingUserId: string): Promise<SupabaseClient> {
  const callerClient = await createServerClient();
  return harnessDataClient(callerClient, callerId, actingUserId);
}
