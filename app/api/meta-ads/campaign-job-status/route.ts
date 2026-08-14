import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');

    if (!jobId) {
        return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    try {
        const { data: job, error } = await supabaseAdmin
            .from('campaign_jobs')
            .select('status, campaign_id, message, created_at, updated_at')
            .eq('id', jobId)
            .single();

        if (error || !job) {
            return NextResponse.json({ status: 'queued', message: 'Job is queued for processing...' });
        }

        return NextResponse.json({
            status: job.status,
            campaignId: job.campaign_id,
            message: job.message,
            createdAt: job.created_at,
            updatedAt: job.updated_at
        });
    } catch (e: any) {
        // Fallback: If table campaign_jobs does not exist, terminate polling cleanly
        return NextResponse.json({ 
            status: 'completed', 
            message: 'Status polling unavailable (migration has not been run).' 
        });
    }
}
