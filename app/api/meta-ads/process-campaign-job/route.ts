import { NextResponse } from 'next/server';
import { runCampaignJob } from '@/utils/campaign-processor';

export const maxDuration = 300;

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { jobId, payload } = body;

        if (!jobId) {
            return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
        }

        // Trigger processing asynchronously in the background
        runCampaignJob(jobId, payload).catch(err => {
            console.error("Asynchronous campaign job process crash:", err);
        });

        return NextResponse.json({ success: true, message: 'Processing started.' });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
