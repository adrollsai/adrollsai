import { NextResponse } from 'next/server';
import { requireUser, serviceAdmin, canActForUser } from '@/utils/route-auth';

export const dynamic = 'force-dynamic';

/**
 * Poll the status of a campaign-launch job.
 *
 * This route used to (a) have no authentication, (b) read any tenant's job with
 * the service-role client, and (c) return `{ status: 'completed' }` from its
 * catch block — which made the Ads tab announce "Campaign launched
 * successfully!" precisely when the job could not be read. A missing table, a
 * bad row or a thrown error must never look like success.
 */
export async function GET(request: Request) {
    try {
        const caller = await requireUser(request);
        if (!caller) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const jobId = url.searchParams.get('jobId');

        if (!jobId) {
            return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
        }

        const supabaseAdmin = serviceAdmin();

        const { data: job, error } = await supabaseAdmin
            .from('campaign_jobs')
            .select('status, campaign_id, message, created_at, updated_at, user_id')
            .eq('id', jobId)
            .maybeSingle();

        if (error) {
            console.error('[campaign-job-status] lookup failed:', error);
            return NextResponse.json(
                { status: 'unknown', message: 'Job status is currently unavailable.' },
                { status: 503 }
            );
        }

        if (!job) {
            return NextResponse.json(
                { status: 'unknown', message: 'Job not found.' },
                { status: 404 }
            );
        }

        // The job must belong to the caller's workspace.
        if (!(await canActForUser(caller.id, String((job as any).user_id)))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        return NextResponse.json({
            status: job.status,
            campaignId: job.campaign_id,
            message: job.message,
            createdAt: job.created_at,
            updatedAt: job.updated_at
        });
    } catch (e: any) {
        console.error('[campaign-job-status] unexpected error:', e);
        return NextResponse.json(
            { status: 'unknown', message: e?.message || 'Job status is currently unavailable.' },
            { status: 500 }
        );
    }
}
