import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { readLedger, supabaseLedgerReader } from '@/lib/automation/credit-reconcile';
import { CREDIT_TIERS, describeTier, formatInr, tierCapacity } from '@/lib/automation/credit-tiers';

/**
 * GET /api/admin/ledger?userId=<uuid>&limit=<n>
 *
 * The read-only credit ledger: what a support person reads before answering
 * "where did my credits go".
 *
 * WHY READ-ONLY, AND WHY THAT IS THE WHOLE POINT
 * This route has no POST, no PATCH and no DELETE, and it must never gain one. A
 * console that can also adjust a balance can also erase the evidence of what it
 * adjusted; the ledger is the audit trail, and the only correct ways to change it
 * are a payment (`grantCreditsOnce`) or a run's own charge/refund path. Anything
 * else is a bug being papered over.
 *
 * So the interesting output is not the balance — it is `problems` and the per-run
 * verdicts. A run that failed must show `no-movement`; a hold whose `spent` counter
 * disagrees with the ledger must show `mismatch`. Both are invisible from a single
 * number.
 *
 * Auth: a `super_admin` profile, exactly like /api/admin/costing.
 */
const supabaseAdmin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileErr || profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server is not configured to read the ledger' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const limit = Number(searchParams.get('limit') ?? '');

    // No user id: the plan table, so the console can price a fix-up without a
    // second request. Never a list of every tenant's ledger.
    if (!targetUserId) {
      return NextResponse.json({
        readOnly: true,
        tiers: CREDIT_TIERS.map((tier) => ({
          ...tier,
          price: formatInr(tier.pricePaise),
          description: describeTier(tier),
          capacity: tierCapacity(tier),
        })),
        note: 'pass ?userId=<uuid> to read one wallet’s ledger',
      });
    }

    const summary = await readLedger(supabaseLedgerReader(supabaseAdmin), {
      userId: targetUserId,
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    });

    return NextResponse.json({ readOnly: true, ...summary });
  } catch (error: any) {
    console.error('[admin/ledger] failed:', error?.message || error);
    return NextResponse.json(
      { error: 'Could not read the ledger', detail: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/** Nothing may be written through this route, so every other verb is refused loudly. */
function refuseWrite() {
  return NextResponse.json(
    {
      error:
        'This endpoint is read-only. Credits move only through a payment (grantCreditsOnce) or a run’s own ' +
        'charge/refund path, so there is no hand-edit here by design.',
    },
    { status: 405, headers: { Allow: 'GET' } },
  );
}

export const POST = refuseWrite;
export const PUT = refuseWrite;
export const PATCH = refuseWrite;
export const DELETE = refuseWrite;
