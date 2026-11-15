import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { resolveBillingOwner } from '@/lib/automation/billing';
import {
  describeStatus,
  evaluateSpine,
  nextQuestion,
  snapshotFromProfile,
} from '@/lib/automation/onboarding-spine';

/**
 * GET /api/onboarding/status
 *
 * Where this business is on the onboarding spine, and the ONE thing to do next.
 *
 * WHY A ROUTE AND NOT A PAGE
 * Two callers need the same answer and must not disagree: the dashboard (to render
 * progress) and the agent itself (to ask for the missing thing before it starts
 * work, instead of failing deep inside a vendor call). The page kept its own idea of
 * what "finished" meant; this is the single computed answer.
 *
 * The steps are DERIVED from data on every call — the profile row, the offering
 * count, the wallet and the runs that actually finished. `profiles.onboarding_completed`
 * is returned only so a caller can see it, and disagreements between it and the data
 * come back in `discrepancies` rather than changing the verdict.
 *
 * READ ONLY. Nothing here writes; completing a step happens on the step's own route.
 */
const supabaseAdmin =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, business_name, business_info, industry, contact_number, whatsapp_phone_number, ' +
          'logo_url, custom_domain, credits, onboarding_completed, client_features',
      )
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { error: 'Could not read the profile', detail: profileError.message },
        { status: 500 },
      );
    }

    const client = supabaseAdmin ?? supabase;
    // Who owns this workspace is not `user.id` for a team member, and there is only
    // one place that answers it. Using it here keeps the spine's idea of "my
    // workspace" the same as the wallet's.
    const ownerId = await resolveBillingOwner(client, user.id);
    // The generated database types are stale (see lib/automation/billing.ts), so the
    // row is read loosely rather than fighting column types that do not match reality.
    const profileRow = (profile ?? {}) as Record<string, any>;
    const snapshot = snapshotFromProfile({ ...profileRow, owner_id: ownerId });

    // The offering count and the finished-run count live in other tables, and a
    // failure to read either must not turn the whole answer into "nothing is set
    // up": it is reported as a problem and the step is left OPEN, which is the
    // safe direction (the agent asks rather than assuming).
    const problems: string[] = [];

    const [offerings, runs] = await Promise.all([
      client.from('properties').select('id', { count: 'exact', head: true }).eq('user_id', ownerId),
      client.from('agent_runs').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).eq('status', 'completed'),
    ]);

    let offeringsCount = 0;
    if (offerings.error) {
      problems.push(`could not count offerings: ${offerings.error.message}`);
    } else {
      offeringsCount = offerings.count ?? 0;
    }

    let completedRuns = 0;
    if (runs.error) {
      problems.push(`could not count finished runs: ${runs.error.message}`);
    } else {
      completedRuns = runs.count ?? 0;
    }

    const status = evaluateSpine({ ...snapshot, offeringsCount, completedRuns });

    return NextResponse.json({
      readOnly: true,
      ...status,
      // The owner-facing one-liner and the agent's single question, from the same
      // evaluation, so the two can never drift apart.
      description: describeStatus(status),
      question: nextQuestion(status),
      problems: [...problems, ...status.discrepancies],
      steps: status.steps.map((entry) => ({
        id: entry.step.id,
        order: entry.step.order,
        title: entry.step.title,
        why: entry.step.why,
        href: entry.step.href,
        blocking: entry.step.blocking,
        done: entry.done,
        detail: entry.detail,
      })),
    });
  } catch (error: any) {
    console.error('[onboarding/status] failed:', error?.message || error);
    return NextResponse.json(
      { error: 'Could not read the onboarding status', detail: String(error?.message || error) },
      { status: 500 },
    );
  }
}

function refuseWrite() {
  return NextResponse.json(
    {
      error:
        'This endpoint is read-only. Each step is completed on its own route, so there is no single ' +
        'flag to set here — which is exactly why the flag is not trusted anywhere.',
    },
    { status: 405, headers: { Allow: 'GET' } },
  );
}

export const POST = refuseWrite;
export const PUT = refuseWrite;
export const PATCH = refuseWrite;
export const DELETE = refuseWrite;
