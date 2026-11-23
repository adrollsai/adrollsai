import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolveRequestUser } from '@/utils/api-auth';
import { resolveActingUser } from '@/utils/route-auth';
import { loadCeoToday } from '@/lib/agent/ceo-today';

export const maxDuration = 60;

/**
 * What the CEO tab shows for today.
 *
 * The work itself lives in `lib/agent/ceo-today.ts`, because the page now renders
 * the same payload on the server before the first paint. One loader, two callers —
 * the tab cannot drift from the route it refreshes from.
 *
 * `?impersonate=<uuid>` is honoured only for a caller that may act for that
 * account (super_admin always, agency/admin for their own sub-accounts).
 */
export async function GET(request: Request) {
  const auth = await resolveRequestUser(request);
  if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const acting = await resolveActingUser(request, new URL(request.url).searchParams.get('impersonate'));
    if (!acting.ok) return acting.response;

    const supabase = await createClient();
    const today = await loadCeoToday(supabase, acting.userId);
    return NextResponse.json(today);
  } catch (e: any) {
    console.error('[CEO today] load failed:', e?.message || e);
    return NextResponse.json({ error: 'Could not load today' }, { status: 500 });
  }
}
