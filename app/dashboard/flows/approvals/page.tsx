import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { PendingDeliveries } from '@/components/flows/PendingDeliveries';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/flows/approvals — the human half of a flow.
 *
 * The scheduler writes a row for every due step; this page is where an owner sees them. It is a
 * server component purely to keep the user check on the server: the queue itself is read through
 * /api/flows/deliveries, which scopes every query to the signed-in owner.
 */
export default async function FlowApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <PendingDeliveries />;
}
