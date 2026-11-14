import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { emptyCeoToday, loadCeoToday } from '@/lib/agent/ceo-today';
import CeoTodayPanel from './CeoToday';

export const dynamic = 'force-dynamic';

/**
 * The CEO tab, rendered on the server.
 *
 * This used to be a client component that fetched `/api/agent/ceo/today` in a
 * `useEffect` after hydration, so it could not paint before the round trip had
 * finished — and that route ran five queries serially. Two slow hops, one after
 * the other, before the owner saw anything.
 *
 * Now the payload is loaded here while the server is already rendering, and the
 * queries inside `loadCeoToday` run together. The client component receives the
 * finished data as a prop, so the first paint is the real tile.
 *
 * `force-dynamic` is deliberate: this is per-tenant, per-day data and must never
 * be served from a build-time cache.
 */
export default async function CeoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated dashboard traffic; this is the
  // defence for a direct render path (and for a session that expired mid-request).
  if (!user) redirect('/login');

  let initial;
  try {
    initial = await loadCeoToday(supabase, user.id);
  } catch (e: any) {
    // Never blank the tab on a read error: render the empty state with the date,
    // which is more useful than an error page and still shows the engine controls.
    console.error('[CEO page] load failed:', e?.message || e);
    initial = emptyCeoToday();
  }

  return <CeoTodayPanel initial={initial} />;
}
