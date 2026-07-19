import { NextResponse } from 'next/server';
import { runCampaignJob } from '@/utils/campaign-processor';

// This endpoint does the heavy Meta API work — runs long, doesn't face user-timeout
export const maxDuration = 300;

export async function POST(request: Request) {
    let jobId: string | null = null;

    try {
        const body = await request.json();
        jobId = body.jobId;
        const payload = body.payload;

        if (!jobId) {
            return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
        }

        const result = await runCampaignJob(jobId, payload);
        return NextResponse.json({ success: true, ...result });

    } catch (error: any) {
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
