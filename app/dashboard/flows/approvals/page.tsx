import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { PendingDeliveries } from '@/components/flows/PendingDeliveries';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/flows/approvals — the human half of a flow.
 *
 * The scheduler writes a row for every due step; this page is where an owner sees them. It is a
 * server component purely to keep the user check on the server: the queue itself is read through
 * /api/flows/deliveries, which scopes every query to the acting owner.
 *
 * A super admin inspecting a tenant appends ?impersonate=<uuid>; the id is resolved here — with
 * the same role gate the rest of the dashboard uses (super_admin always, agency/admin only for
 * an account inside their own workspace) — and handed to the queue, which forwards it. Without
 * that the switcher would appear to do nothing on this screen.
 */
export default async function FlowApprovalsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
      const { data: target } = await supabase
        .from('profiles')
        .select('agency_id, parent_id')
        .eq('id', impersonateId)
        .maybeSingle();
      if (target?.agency_id === user.id || target?.parent_id === user.id) targetUserId = impersonateId;
    }
  }

  return <PendingDeliveries impersonateId={targetUserId === user.id ? null : targetUserId} />;
}
