import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolveRequestUser } from '@/utils/api-auth';
import { loadCeoToday } from '@/lib/agent/ceo-today';

export const maxDuration = 60;

/**
 * What the CEO tab shows for today.
 *
 * The work itself lives in `lib/agent/ceo-today.ts`, because the page now renders
 * the same payload on the server before the first paint. One loader, two callers —
 * the tab cannot drift from the route it refreshes from.
 */
export async function GET(request: Request) {
  const auth = await resolveRequestUser(request);
  if (!auth.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = await createClient();
    const today = await loadCeoToday(supabase, auth.user.id);
    return NextResponse.json(today);
  } catch (e: any) {
    console.error('[CEO today] load failed:', e?.message || e);
    return NextResponse.json({ error: 'Could not load today' }, { status: 500 });
  }
}
