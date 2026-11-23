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
export default async function CeoPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated dashboard traffic; this is the
  // defence for a direct render path (and for a session that expired mid-request).
  if (!user) redirect('/login');

  // Whose business this tab is about.
  //
  // A super admin inspecting a tenant appends ?impersonate=<uuid>; without this the
  // tab would paint the super admin's own day while the switcher said otherwise.
  const params = (await searchParams) || {};
  const raw = params.impersonate;
  const requested = (Array.isArray(raw) ? raw[0] : raw) || '';
  const impersonateId =
    requested && requested !== 'null' && requested !== 'undefined' && requested !== user.id ? requested : '';

  let targetUserId = user.id;
  if (impersonateId) {
    const { data: selfProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const selfRole = String(selfProfile?.role || '').toLowerCase();
    if (selfRole === 'super_admin') {
      targetUserId = impersonateId;
    } else if (['agency', 'admin'].includes(selfRole)) {
      // agency/admin may only look inside their own workspace.
      const { data: target } = await supabase
        .from('profiles')
        .select('agency_id, parent_id')
        .eq('id', impersonateId)
        .maybeSingle();
      if (target?.agency_id === user.id || target?.parent_id === user.id) targetUserId = impersonateId;
    }
  }

  let initial;
  try {
    initial = await loadCeoToday(supabase, targetUserId);
  } catch (e: any) {
    // Never blank the tab on a read error: render the empty state with the date,
    // which is more useful than an error page and still shows the engine controls.
    console.error('[CEO page] load failed:', e?.message || e);
    initial = emptyCeoToday();
  }

  // The panel's own refresh/switch-on calls must stay inside the viewed account.
  return <CeoTodayPanel initial={initial} impersonateId={targetUserId === user.id ? null : targetUserId} />;
}
